# Salary Market Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the external market salary ingestion and benchmark pipeline that feeds the recruiting salary decision features.

**Architecture:** Add three Supabase tables for raw, normalized, and benchmark salary data; implement a focused Python normalization and aggregation pipeline in `backend/main.py`; expose one FastAPI dashboard endpoint that returns benchmark data and crawl status for the UI. Keep scraping/insertion logic separate from normalization and benchmark generation so raw captures remain auditable and re-processable.

**Tech Stack:** Supabase Postgres, FastAPI (Python), existing backend utility patterns in `backend/main.py`, lightweight Python `unittest` smoke coverage, React/Vite consumer reads.

---

## File Structure

- Create: `D:/project/RecruitPro_/supabase/migrations/20260418_salary_market_foundation.sql`
  - Create `market_salary_raw_records`, `market_salary_normalized_records`, `market_salary_benchmarks`, `market_salary_crawl_jobs`
- Modify: `D:/project/RecruitPro_/backend/models.py`
  - Add payload types for benchmark regeneration and profile upsert if needed by the API layer
- Modify: `D:/project/RecruitPro_/backend/main.py`
  - Add normalization helpers, aggregation helpers, crawl job helpers, and `GET /api/salary/dashboard`
- Create: `D:/project/RecruitPro_/tests/backend/test_salary_market_pipeline.py`
  - Validate normalization, invalid salary filtering, and benchmark aggregation using `unittest`
- Create: `D:/project/RecruitPro_/docs/salary-market-ops.md`
  - Operational notes for ingest, refresh, and troubleshooting

### Task 1: Create the market salary schema

**Files:**
- Create: `D:/project/RecruitPro_/supabase/migrations/20260418_salary_market_foundation.sql`
- Test: `D:/project/RecruitPro_/tests/backend/test_salary_market_pipeline.py`

- [ ] **Step 1: Write the failing schema expectation test**

```python
import pathlib
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[2]
MIGRATION = ROOT / "supabase" / "migrations" / "20260418_salary_market_foundation.sql"


class SalaryMarketSchemaTest(unittest.TestCase):
    def test_migration_defines_all_salary_market_tables(self) -> None:
        sql = MIGRATION.read_text(encoding="utf-8")
        self.assertIn("create table if not exists public.market_salary_raw_records", sql.lower())
        self.assertIn("create table if not exists public.market_salary_normalized_records", sql.lower())
        self.assertIn("create table if not exists public.market_salary_benchmarks", sql.lower())
        self.assertIn("create table if not exists public.market_salary_crawl_jobs", sql.lower())


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `python -m unittest D:/project/RecruitPro_/tests/backend/test_salary_market_pipeline.py -v`

Expected: FAIL with missing migration file or missing table definitions.

- [ ] **Step 3: Write the migration**

```sql
create table if not exists public.market_salary_raw_records (
  id uuid primary key default gen_random_uuid(),
  source text not null,
  source_job_title text not null,
  source_city text,
  source_salary_text text not null,
  salary_min numeric,
  salary_max numeric,
  salary_period text default 'monthly',
  currency text default 'CNY',
  experience_text text,
  education_text text,
  company_name text,
  captured_at timestamptz not null default now(),
  raw_payload jsonb not null default '{}'::jsonb,
  hash_key text not null unique,
  created_at timestamptz not null default now()
);

create table if not exists public.market_salary_normalized_records (
  id uuid primary key default gen_random_uuid(),
  raw_record_id uuid not null references public.market_salary_raw_records(id) on delete cascade,
  normalized_role text,
  normalized_city text,
  normalized_level text,
  salary_min_monthly numeric,
  salary_median_monthly numeric,
  salary_max_monthly numeric,
  source text not null,
  captured_at timestamptz not null,
  is_valid boolean not null default false,
  invalid_reason text,
  created_at timestamptz not null default now()
);

create table if not exists public.market_salary_benchmarks (
  id uuid primary key default gen_random_uuid(),
  role_key text not null,
  city_key text not null,
  level_key text not null,
  min_salary numeric not null,
  median_salary numeric not null,
  max_salary numeric not null,
  sample_size integer not null default 0,
  source_count integer not null default 0,
  latest_source_at timestamptz,
  updated_at timestamptz not null default now(),
  unique (role_key, city_key, level_key)
);

create table if not exists public.market_salary_crawl_jobs (
  id uuid primary key default gen_random_uuid(),
  source text not null,
  status text not null default 'pending',
  started_at timestamptz,
  finished_at timestamptz,
  records_fetched integer not null default 0,
  records_valid integer not null default 0,
  error_message text,
  created_at timestamptz not null default now()
);
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `python -m unittest D:/project/RecruitPro_/tests/backend/test_salary_market_pipeline.py -v`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add D:/project/RecruitPro_/supabase/migrations/20260418_salary_market_foundation.sql D:/project/RecruitPro_/tests/backend/test_salary_market_pipeline.py
git commit -m "feat: add salary market schema foundation"
```

### Task 2: Add normalization helpers in FastAPI

**Files:**
- Modify: `D:/project/RecruitPro_/backend/main.py`
- Test: `D:/project/RecruitPro_/tests/backend/test_salary_market_pipeline.py`

- [ ] **Step 1: Extend the failing test with normalization expectations**

```python
from backend import main

class SalaryMarketNormalizationTest(unittest.TestCase):
    def test_normalizes_role_city_level_and_monthly_salary(self) -> None:
        raw = {
            "source_job_title": "计算机视觉算法工程师",
            "source_city": "北京市",
            "salary_min": 25000,
            "salary_max": 45000,
            "salary_period": "monthly",
            "experience_text": "3-5年",
            "source": "demo",
            "captured_at": "2026-04-18T00:00:00Z",
        }
        normalized = main.normalize_market_salary_record(raw)
        self.assertEqual(normalized["normalized_role"], "cv_algorithm_engineer")
        self.assertEqual(normalized["normalized_city"], "beijing")
        self.assertEqual(normalized["normalized_level"], "mid")
        self.assertEqual(normalized["salary_median_monthly"], 35000)
        self.assertTrue(normalized["is_valid"])

    def test_marks_unparseable_salary_record_invalid(self) -> None:
        raw = {
            "source_job_title": "算法工程师",
            "source_city": "上海",
            "salary_min": None,
            "salary_max": None,
            "salary_period": "negotiable",
            "experience_text": "不限",
            "source": "demo",
            "captured_at": "2026-04-18T00:00:00Z",
        }
        normalized = main.normalize_market_salary_record(raw)
        self.assertFalse(normalized["is_valid"])
        self.assertEqual(normalized["invalid_reason"], "missing_salary_range")
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `python -m unittest D:/project/RecruitPro_/tests/backend/test_salary_market_pipeline.py -v`

Expected: FAIL with `AttributeError: module 'backend.main' has no attribute 'normalize_market_salary_record'`

- [ ] **Step 3: Add minimal normalization helpers**

```python
ROLE_ALIASES = {
    "计算机视觉算法工程师": "cv_algorithm_engineer",
    "视觉算法工程师": "cv_algorithm_engineer",
    "cv算法工程师": "cv_algorithm_engineer",
}

CITY_ALIASES = {
    "北京": "beijing",
    "北京市": "beijing",
    "上海": "shanghai",
    "上海市": "shanghai",
}

def infer_level_from_experience(text: str) -> str:
    normalized = normalize_text(text)
    if "0-3" in normalized or "1-3" in normalized:
        return "junior"
    if "3-5" in normalized:
        return "mid"
    if "5-8" in normalized:
        return "senior"
    if "8" in normalized or "负责人" in normalized:
        return "lead"
    return "unknown"

def normalize_market_salary_record(raw: dict[str, Any]) -> dict[str, Any]:
    salary_min = raw.get("salary_min")
    salary_max = raw.get("salary_max")
    if salary_min is None or salary_max is None:
        return {
            "normalized_role": None,
            "normalized_city": None,
            "normalized_level": infer_level_from_experience(normalize_text(raw.get("experience_text"))),
            "salary_min_monthly": None,
            "salary_median_monthly": None,
            "salary_max_monthly": None,
            "source": normalize_text(raw.get("source")),
            "captured_at": raw.get("captured_at"),
            "is_valid": False,
            "invalid_reason": "missing_salary_range",
        }

    monthly_min = int(salary_min)
    monthly_max = int(salary_max)
    return {
        "normalized_role": ROLE_ALIASES.get(normalize_text(raw.get("source_job_title")), "unknown"),
        "normalized_city": CITY_ALIASES.get(normalize_text(raw.get("source_city")), "unknown"),
        "normalized_level": infer_level_from_experience(normalize_text(raw.get("experience_text"))),
        "salary_min_monthly": monthly_min,
        "salary_median_monthly": int((monthly_min + monthly_max) / 2),
        "salary_max_monthly": monthly_max,
        "source": normalize_text(raw.get("source")),
        "captured_at": raw.get("captured_at"),
        "is_valid": True,
        "invalid_reason": None,
    }
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `python -m unittest D:/project/RecruitPro_/tests/backend/test_salary_market_pipeline.py -v`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add D:/project/RecruitPro_/backend/main.py D:/project/RecruitPro_/tests/backend/test_salary_market_pipeline.py
git commit -m "feat: add salary market normalization helpers"
```

### Task 3: Add benchmark aggregation logic

**Files:**
- Modify: `D:/project/RecruitPro_/backend/main.py`
- Test: `D:/project/RecruitPro_/tests/backend/test_salary_market_pipeline.py`

- [ ] **Step 1: Extend the failing test with aggregation coverage**

```python
class SalaryMarketAggregationTest(unittest.TestCase):
    def test_aggregates_benchmark_by_role_city_level(self) -> None:
        records = [
            {
                "normalized_role": "cv_algorithm_engineer",
                "normalized_city": "beijing",
                "normalized_level": "mid",
                "salary_min_monthly": 25000,
                "salary_median_monthly": 32000,
                "salary_max_monthly": 42000,
                "source": "a",
                "captured_at": "2026-04-18T00:00:00Z",
                "is_valid": True,
            },
            {
                "normalized_role": "cv_algorithm_engineer",
                "normalized_city": "beijing",
                "normalized_level": "mid",
                "salary_min_monthly": 28000,
                "salary_median_monthly": 35000,
                "salary_max_monthly": 45000,
                "source": "b",
                "captured_at": "2026-04-19T00:00:00Z",
                "is_valid": True,
            },
        ]
        rows = main.build_market_salary_benchmarks(records, min_samples=2)
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["role_key"], "cv_algorithm_engineer")
        self.assertEqual(rows[0]["sample_size"], 2)
        self.assertEqual(rows[0]["median_salary"], 33500)
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `python -m unittest D:/project/RecruitPro_/tests/backend/test_salary_market_pipeline.py -v`

Expected: FAIL with missing `build_market_salary_benchmarks`

- [ ] **Step 3: Implement aggregation**

```python
def build_market_salary_benchmarks(records: list[dict[str, Any]], min_samples: int = 2) -> list[dict[str, Any]]:
    buckets: dict[tuple[str, str, str], list[dict[str, Any]]] = {}
    for item in records:
        if not item.get("is_valid"):
            continue
        key = (
            normalize_text(item.get("normalized_role")),
            normalize_text(item.get("normalized_city")),
            normalize_text(item.get("normalized_level")),
        )
        buckets.setdefault(key, []).append(item)

    output: list[dict[str, Any]] = []
    for (role_key, city_key, level_key), items in buckets.items():
        if len(items) < min_samples:
            continue
        output.append(
            {
                "role_key": role_key,
                "city_key": city_key,
                "level_key": level_key,
                "min_salary": int(sum(int(x["salary_min_monthly"]) for x in items) / len(items)),
                "median_salary": int(sum(int(x["salary_median_monthly"]) for x in items) / len(items)),
                "max_salary": int(sum(int(x["salary_max_monthly"]) for x in items) / len(items)),
                "sample_size": len(items),
                "source_count": len({normalize_text(x.get("source")) for x in items}),
                "latest_source_at": max(x.get("captured_at") for x in items),
            }
        )
    return output
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `python -m unittest D:/project/RecruitPro_/tests/backend/test_salary_market_pipeline.py -v`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add D:/project/RecruitPro_/backend/main.py D:/project/RecruitPro_/tests/backend/test_salary_market_pipeline.py
git commit -m "feat: add salary market benchmark aggregation"
```

### Task 4: Expose salary dashboard data through FastAPI

**Files:**
- Modify: `D:/project/RecruitPro_/backend/main.py`
- Modify: `D:/project/RecruitPro_/backend/models.py`
- Test: `D:/project/RecruitPro_/tests/backend/test_salary_market_pipeline.py`

- [ ] **Step 1: Extend the failing test with response mapping**

```python
class SalaryDashboardShapeTest(unittest.TestCase):
    def test_maps_dashboard_payload_shape(self) -> None:
        payload = main.build_salary_dashboard_payload(
            benchmarks=[
                {
                    "role_key": "cv_algorithm_engineer",
                    "city_key": "beijing",
                    "level_key": "mid",
                    "min_salary": 26000,
                    "median_salary": 34000,
                    "max_salary": 43000,
                    "sample_size": 8,
                    "source_count": 2,
                    "latest_source_at": "2026-04-18T00:00:00Z",
                }
            ],
            crawl_jobs=[{"status": "success"}],
        )
        self.assertIn("benchmarks", payload)
        self.assertIn("summary", payload)
        self.assertEqual(payload["summary"]["benchmark_count"], 1)
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `python -m unittest D:/project/RecruitPro_/tests/backend/test_salary_market_pipeline.py -v`

Expected: FAIL with missing `build_salary_dashboard_payload`

- [ ] **Step 3: Implement the dashboard payload helper and endpoint**

```python
def build_salary_dashboard_payload(benchmarks: list[dict[str, Any]], crawl_jobs: list[dict[str, Any]]) -> dict[str, Any]:
    return {
        "summary": {
            "benchmark_count": len(benchmarks),
            "successful_crawl_jobs": sum(1 for item in crawl_jobs if normalize_text(item.get("status")) == "success"),
        },
        "benchmarks": benchmarks,
        "crawl_jobs": crawl_jobs[:10],
    }

@app.get("/api/salary/dashboard")
def get_salary_dashboard(authorization: str | None = Header(default=None)) -> dict[str, Any]:
    require_user(authorization)
    client = db.get_client()
    benchmarks = db.many(
        client.table("market_salary_benchmarks")
        .select("*")
        .order("updated_at", desc=True)
        .execute()
    )
    crawl_jobs = db.many(
        client.table("market_salary_crawl_jobs")
        .select("*")
        .order("created_at", desc=True)
        .limit(10)
        .execute()
    )
    return build_salary_dashboard_payload(benchmarks, crawl_jobs)
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `python -m unittest D:/project/RecruitPro_/tests/backend/test_salary_market_pipeline.py -v`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add D:/project/RecruitPro_/backend/main.py D:/project/RecruitPro_/backend/models.py D:/project/RecruitPro_/tests/backend/test_salary_market_pipeline.py
git commit -m "feat: expose salary market dashboard api"
```

### Task 5: Document market ingest operations

**Files:**
- Create: `D:/project/RecruitPro_/docs/salary-market-ops.md`

- [ ] **Step 1: Write the operations document**

```md
# Salary Market Operations

## Refresh flow

1. Insert raw crawl records into `market_salary_raw_records`
2. Run normalization to produce `market_salary_normalized_records`
3. Run aggregation to refresh `market_salary_benchmarks`
4. Inspect `market_salary_crawl_jobs` for failures

## Failure handling

- Missing salary range: keep raw record, do not aggregate
- Unknown role or city: keep normalized row invalid until alias map is updated
- Low sample benchmark: do not publish into decision UI
```

- [ ] **Step 2: Sanity-check the document exists and is readable**

Run: `Get-Content 'D:/project/RecruitPro_/docs/salary-market-ops.md'`

Expected: Markdown file renders the refresh flow and failure handling sections.

- [ ] **Step 3: Commit**

```bash
git add D:/project/RecruitPro_/docs/salary-market-ops.md
git commit -m "docs: add salary market operations notes"
```
