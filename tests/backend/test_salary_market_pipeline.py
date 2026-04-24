from __future__ import annotations

import pathlib
import sys
import unittest
from types import SimpleNamespace
from unittest.mock import patch

ROOT = pathlib.Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))
BACKEND_DIR = ROOT / "backend"
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

MIGRATION = ROOT / "supabase" / "migrations" / "20260418_salary_market_foundation.sql"

from backend import main  # noqa: E402


class _FakeQuery:
    def __init__(self, rows: list[dict[str, object]], table_name: str | None = None, tables: dict[str, list[dict[str, object]]] | None = None) -> None:
        self._rows = rows
        self._table_name = table_name
        self._tables = tables
        self._filters: list[tuple[str, str, object]] = []
        self._order_field: str | None = None
        self._order_desc = False
        self._limit: int | None = None
        self._update_payload: dict[str, object] | None = None
        self._insert_payload: list[dict[str, object]] | None = None
        self._upsert_payload: list[dict[str, object]] | None = None
        self._delete_mode = False

    def select(self, *_args: object, **_kwargs: object) -> "_FakeQuery":
        return self

    def order(self, *_args: object, **_kwargs: object) -> "_FakeQuery":
        if _args:
            self._order_field = str(_args[0])
        self._order_desc = bool(_kwargs.get("desc", False))
        return self

    def limit(self, *_args: object, **_kwargs: object) -> "_FakeQuery":
        if _args:
            self._limit = int(_args[0])
        return self

    def eq(self, *_args: object, **_kwargs: object) -> "_FakeQuery":
        if len(_args) >= 2:
            self._filters.append(("eq", str(_args[0]), _args[1]))
        return self

    def in_(self, *_args: object, **_kwargs: object) -> "_FakeQuery":
        if len(_args) >= 2:
            self._filters.append(("in", str(_args[0]), _args[1]))
        return self

    def update(self, payload: dict[str, object]) -> "_FakeQuery":
        self._update_payload = payload
        return self

    def insert(self, payload: object) -> "_FakeQuery":
        if isinstance(payload, list):
            self._insert_payload = [dict(item) for item in payload if isinstance(item, dict)]
        elif isinstance(payload, dict):
            self._insert_payload = [dict(payload)]
        else:
            self._insert_payload = []
        return self

    def upsert(self, payload: object, **_kwargs: object) -> "_FakeQuery":
        if isinstance(payload, list):
            self._upsert_payload = [dict(item) for item in payload if isinstance(item, dict)]
        elif isinstance(payload, dict):
            self._upsert_payload = [dict(payload)]
        else:
            self._upsert_payload = []
        return self

    def delete(self) -> "_FakeQuery":
        self._delete_mode = True
        return self

    def execute(self) -> SimpleNamespace:
        rows = [dict(row) for row in self._rows]
        for kind, field, expected in self._filters:
            if kind == "eq":
                rows = [row for row in rows if row.get(field) == expected]
            elif kind == "in":
                values = list(expected) if isinstance(expected, list) else []
                rows = [row for row in rows if row.get(field) in values]
        if self._order_field:
            rows.sort(key=lambda row: row.get(self._order_field), reverse=self._order_desc)
        if self._limit is not None:
            rows = rows[: self._limit]
        if self._insert_payload is not None and self._table_name and self._tables is not None:
            table_rows = self._tables.setdefault(self._table_name, [])
            inserted_rows: list[dict[str, object]] = []
            for item in self._insert_payload:
                new_row = dict(item)
                new_row.setdefault("id", f"{self._table_name}-{len(table_rows) + len(inserted_rows) + 1}")
                table_rows.append(new_row)
                inserted_rows.append(new_row)
            return SimpleNamespace(data=inserted_rows)
        if self._upsert_payload is not None and self._table_name and self._tables is not None:
            table_rows = self._tables.setdefault(self._table_name, [])
            upserted_rows: list[dict[str, object]] = []
            for item in self._upsert_payload:
                new_row = dict(item)
                conflict_fields: list[str] = []
                if self._table_name == "market_salary_raw_records":
                    conflict_fields = ["hash_key"]
                elif self._table_name == "market_salary_normalized_records":
                    conflict_fields = ["raw_record_id"]
                elif self._table_name == "market_salary_benchmarks":
                    conflict_fields = ["role_key", "city_key", "level_key"]
                matched_index = None
                for index, row in enumerate(table_rows):
                    if conflict_fields and all(row.get(field) == new_row.get(field) for field in conflict_fields):
                        matched_index = index
                        break
                if matched_index is None:
                    new_row.setdefault("id", f"{self._table_name}-{len(table_rows) + 1}")
                    table_rows.append(new_row)
                else:
                    preserved_id = table_rows[matched_index].get("id")
                    merged_row = {**table_rows[matched_index], **new_row}
                    if preserved_id is not None:
                        merged_row["id"] = preserved_id
                    table_rows[matched_index] = merged_row
                upserted_rows.append(new_row)
            return SimpleNamespace(data=upserted_rows)
        if self._delete_mode and self._table_name and self._tables is not None:
            table_rows = self._tables.setdefault(self._table_name, [])
            remaining_rows = []
            deleted_rows = []
            for row in table_rows:
                matched = all(
                    row.get(field) == value
                    for kind, field, value in self._filters
                    if kind == "eq"
                )
                if matched:
                    deleted_rows.append(row)
                else:
                    remaining_rows.append(row)
            self._tables[self._table_name] = remaining_rows
            return SimpleNamespace(data=deleted_rows)
        if self._update_payload is not None and rows and self._table_name and self._tables is not None:
            target_row = dict(rows[0])
            target_row.update(self._update_payload)
            table_rows = self._tables.setdefault(self._table_name, [])
            for index, row in enumerate(table_rows):
                if all(row.get(field) == value for kind, field, value in self._filters if kind == "eq"):
                    table_rows[index] = target_row
                    break
            return SimpleNamespace(data=[target_row])
        return SimpleNamespace(data=rows)


class _FakeClient:
    def __init__(self, tables: dict[str, list[dict[str, object]]]) -> None:
        self._tables = tables

    def table(self, name: str) -> _FakeQuery:
        return _FakeQuery(self._tables.get(name, []), name, self._tables)


class _FakeDB:
    def __init__(self, tables: dict[str, list[dict[str, object]]]) -> None:
        self._client = _FakeClient(tables)

    def get_client(self) -> _FakeClient:
        return self._client

    @staticmethod
    def many(response: SimpleNamespace) -> list[dict[str, object]]:
        data = getattr(response, "data", None) or []
        return data if isinstance(data, list) else []

    @staticmethod
    def first(response: SimpleNamespace) -> dict[str, object] | None:
        data = getattr(response, "data", None) or []
        if isinstance(data, list):
            return data[0] if data else None
        return data if isinstance(data, dict) else None


class SalaryMarketSchemaTest(unittest.TestCase):
    def test_migration_defines_all_salary_market_tables(self) -> None:
        sql = MIGRATION.read_text(encoding="utf-8").lower()
        self.assertIn("create table if not exists public.market_salary_raw_records", sql)
        self.assertIn("create table if not exists public.market_salary_normalized_records", sql)
        self.assertIn("create table if not exists public.market_salary_benchmarks", sql)
        self.assertIn("create table if not exists public.market_salary_crawl_jobs", sql)


class SalaryMarketNormalizationTest(unittest.TestCase):
    def test_normalizes_role_city_level_and_monthly_salary(self) -> None:
        raw = {
            "source_job_title": "Computer Vision Algorithm Engineer",
            "source_city": "Beijing",
            "salary_min": 25000,
            "salary_max": 45000,
            "salary_period": "monthly",
            "experience_text": "3-5 years",
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
            "source_job_title": "Computer Vision Algorithm Engineer",
            "source_city": "Shanghai",
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


class SalaryMarketPipelineTest(unittest.TestCase):
    def test_imports_raw_records_and_refreshes_benchmarks(self) -> None:
        fake_db = _FakeDB(
            {
                "market_salary_raw_records": [],
                "market_salary_normalized_records": [],
                "market_salary_benchmarks": [],
            }
        )
        payload = main.SalaryMarketImportPayload(
            source="demo-source",
            records=[
                main.SalaryMarketRawRecordPayload(
                    source_job_title="Computer Vision Algorithm Engineer",
                    source_city="Beijing",
                    source_salary_text="25k-45k",
                    salary_min=25000,
                    salary_max=45000,
                    salary_period="monthly",
                    experience_text="3-5 years",
                    education_text="Master",
                    company_name="Demo AI",
                    captured_at="2026-04-18T00:00:00Z",
                    raw_payload={"url": "https://example.com/1"},
                ),
                main.SalaryMarketRawRecordPayload(
                    source_job_title="Computer Vision Algorithm Engineer",
                    source_city="Beijing",
                    source_salary_text="28k-46k",
                    salary_min=28000,
                    salary_max=46000,
                    salary_period="monthly",
                    experience_text="3-5 years",
                    education_text="Master",
                    company_name="Demo AI",
                    captured_at="2026-04-19T00:00:00Z",
                    raw_payload={"url": "https://example.com/2"},
                ),
            ],
        )

        with patch.object(main, "require_user", return_value={"id": "user-1"}), patch.object(main, "db", fake_db):
            response = main.import_salary_market_records(payload, "Bearer token")

        self.assertTrue(response["ok"])
        self.assertEqual(response["summary"]["raw_inserted"], 2)
        self.assertEqual(response["summary"]["normalized_written"], 2)
        self.assertEqual(response["summary"]["benchmark_count"], 1)
        self.assertEqual(len(fake_db._client._tables["market_salary_raw_records"]), 2)
        self.assertEqual(len(fake_db._client._tables["market_salary_normalized_records"]), 2)
        self.assertEqual(len(fake_db._client._tables["market_salary_benchmarks"]), 1)
        benchmark = fake_db._client._tables["market_salary_benchmarks"][0]
        self.assertEqual(benchmark["role_key"], "cv_algorithm_engineer")
        self.assertEqual(benchmark["city_key"], "beijing")
        self.assertEqual(benchmark["level_key"], "mid")
        self.assertEqual(benchmark["sample_size"], 2)

    def test_refresh_rebuilds_benchmarks_and_removes_stale_rows(self) -> None:
        fake_db = _FakeDB(
            {
                "market_salary_raw_records": [
                    {
                        "id": "raw-1",
                        "source": "demo-source",
                        "source_job_title": "Computer Vision Algorithm Engineer",
                        "source_city": "Beijing",
                        "source_salary_text": "25k-45k",
                        "salary_min": 25000,
                        "salary_max": 45000,
                        "salary_period": "monthly",
                        "currency": "CNY",
                        "experience_text": "3-5 years",
                        "education_text": "Master",
                        "company_name": "Demo AI",
                        "captured_at": "2026-04-18T00:00:00Z",
                        "raw_payload": {"url": "https://example.com/1"},
                        "hash_key": "hash-1",
                        "created_at": "2026-04-18T00:00:00Z",
                    }
                ],
                "market_salary_normalized_records": [
                    {
                        "id": "norm-1",
                        "raw_record_id": "raw-1",
                        "normalized_role": "cv_algorithm_engineer",
                        "normalized_city": "beijing",
                        "normalized_level": "mid",
                        "salary_min_monthly": 25000,
                        "salary_median_monthly": 35000,
                        "salary_max_monthly": 45000,
                        "source": "demo-source",
                        "captured_at": "2026-04-18T00:00:00Z",
                        "is_valid": True,
                        "invalid_reason": None,
                        "created_at": "2026-04-18T00:00:00Z",
                    }
                ],
                "market_salary_benchmarks": [
                    {
                        "id": "old-1",
                        "role_key": "backend_engineer",
                        "city_key": "shanghai",
                        "level_key": "senior",
                        "min_salary": 30000,
                        "median_salary": 40000,
                        "max_salary": 50000,
                        "sample_size": 3,
                        "source_count": 1,
                        "latest_source_at": "2026-04-16T00:00:00Z",
                        "updated_at": "2026-04-16T00:00:00Z",
                    }
                ],
            }
        )

        payload = main.SalaryMarketRefreshPayload(min_samples=1)

        with patch.object(main, "require_user", return_value={"id": "user-1"}), patch.object(main, "db", fake_db):
            response = main.refresh_salary_market_foundation(payload, "Bearer token")

        self.assertTrue(response["ok"])
        self.assertEqual(response["summary"]["normalized_records"], 1)
        self.assertEqual(response["summary"]["benchmark_count"], 1)
        self.assertEqual(len(fake_db._client._tables["market_salary_benchmarks"]), 1)
        benchmark = fake_db._client._tables["market_salary_benchmarks"][0]
        self.assertEqual(benchmark["role_key"], "cv_algorithm_engineer")
        self.assertEqual(benchmark["city_key"], "beijing")
        self.assertEqual(benchmark["level_key"], "mid")
        self.assertEqual(benchmark["sample_size"], 1)


class SalaryDashboardShapeTest(unittest.TestCase):
    def test_maps_dashboard_payload_shape(self) -> None:
        fake_db = _FakeDB(
            {
                "market_salary_benchmarks": [
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
                        "updated_at": "2026-04-18T12:00:00Z",
                    }
                ],
                "market_salary_crawl_jobs": [
                    {
                        "source": "job-a",
                        "status": "running",
                        "created_at": "2026-04-19T00:00:00Z",
                    },
                    {
                        "source": "job-b",
                        "status": "success",
                        "created_at": "2026-04-18T00:00:00Z",
                    },
                ],
            }
        )

        with patch.object(main, "require_user", return_value={"id": "user-1"}), patch.object(main, "db", fake_db):
            payload = main.get_salary_dashboard("Bearer token")

        self.assertIn("benchmarks", payload)
        self.assertIn("crawl_jobs", payload)
        self.assertIn("summary", payload)
        self.assertEqual(payload["summary"]["benchmark_count"], 1)
        self.assertEqual(payload["summary"]["successful_crawl_jobs"], 1)
        self.assertEqual(payload["summary"]["latest_crawl_status"], "running")


class SalaryDecisionDashboardTest(unittest.TestCase):
    def test_builds_enriched_decision_dashboard(self) -> None:
        fake_db = _FakeDB(
            {
                "candidate_salary_profiles": [
                    {
                        "id": "profile-1",
                        "candidate_id": "candidate-1",
                        "position_id": "position-1",
                        "expected_salary_min": 30000,
                        "expected_salary_max": 40000,
                        "current_salary": 28000,
                        "budget_min": 32000,
                        "budget_max": 43000,
                        "offer_salary": 36000,
                        "offer_status": "draft",
                        "notes": "Need approval",
                        "created_at": "2026-04-18T08:00:00Z",
                        "updated_at": "2026-04-18T10:00:00Z",
                    }
                ],
                "candidates": [
                    {
                        "id": "candidate-1",
                        "name": "Alice Zhang",
                        "title": "Computer Vision Algorithm Engineer",
                        "department": "R&D",
                        "location": "Beijing",
                        "edu": "Master",
                        "exp": "4 years",
                        "prev_company": "Vision Lab",
                        "highlight": "Strong CV background",
                    }
                ],
                "active_positions": [
                    {
                        "id": "position-1",
                        "title": "Computer Vision Algorithm Engineer",
                        "department": "R&D",
                        "location": "Beijing",
                        "status": "open",
                        "min_exp": 4,
                        "min_edu": "Master",
                    }
                ],
                "market_salary_benchmarks": [
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
                        "updated_at": "2026-04-18T12:00:00Z",
                    }
                ],
            }
        )

        with patch.object(main, "require_user", return_value={"id": "user-1"}), patch.object(main, "db", fake_db):
            payload = main.get_salary_decision_dashboard("Bearer token")

        self.assertEqual(payload["summary"]["profile_count"], 1)
        self.assertEqual(payload["summary"]["benchmark_count"], 1)
        self.assertEqual(payload["summary"]["offer_status_counts"]["draft"], 1)
        self.assertEqual(payload["summary"]["market_position_counts"]["within_market"], 1)
        self.assertEqual(payload["profiles"][0]["candidate"]["name"], "Alice Zhang")
        self.assertEqual(payload["profiles"][0]["position"]["id"], "position-1")
        self.assertEqual(payload["profiles"][0]["market_benchmark"]["median_salary"], 34000)
        self.assertEqual(payload["profiles"][0]["offer_vs_market"]["delta_to_median"], 2000)

    def test_updates_only_patchable_salary_profile_fields(self) -> None:
        fake_db = _FakeDB(
            {
                "candidate_salary_profiles": [
                    {
                        "id": "profile-1",
                        "candidate_id": "candidate-1",
                        "position_id": "position-1",
                        "expected_salary_min": 30000,
                        "expected_salary_max": 40000,
                        "current_salary": 28000,
                        "budget_min": 32000,
                        "budget_max": 43000,
                        "offer_salary": 36000,
                        "offer_status": "draft",
                        "notes": "Need approval",
                        "created_at": "2026-04-18T08:00:00Z",
                        "updated_at": "2026-04-18T10:00:00Z",
                    }
                ],
                "candidates": [
                    {
                        "id": "candidate-1",
                        "name": "Alice Zhang",
                        "title": "Computer Vision Algorithm Engineer",
                        "department": "R&D",
                        "location": "Beijing",
                        "edu": "Master",
                        "exp": "4 years",
                        "prev_company": "Vision Lab",
                        "highlight": "Strong CV background",
                    }
                ],
                "active_positions": [
                    {
                        "id": "position-1",
                        "title": "Computer Vision Algorithm Engineer",
                        "department": "R&D",
                        "location": "Beijing",
                        "status": "open",
                        "min_exp": 4,
                        "min_edu": "Master",
                    }
                ],
                "market_salary_benchmarks": [
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
                        "updated_at": "2026-04-18T12:00:00Z",
                    }
                ],
            }
        )

        payload = main.CandidateSalaryProfilePatchPayload(offer_salary=37000, offer_status="offered")

        with patch.object(main, "require_user", return_value={"id": "user-1"}), patch.object(main, "db", fake_db):
            response = main.patch_candidate_salary_profile("profile-1", payload, "Bearer token")

        self.assertTrue(response["ok"])
        self.assertEqual(response["updated_fields"], ["offer_salary", "offer_status"])
        self.assertEqual(response["profile"]["offer_salary"], 37000)
        self.assertEqual(response["profile"]["offer_status"], "offered")
        self.assertEqual(response["profile"]["notes"], "Need approval")
        self.assertEqual(response["profile"]["offer_vs_market"]["position"], "within_market")
        self.assertEqual(fake_db._client._tables["candidate_salary_profiles"][0]["offer_salary"], 37000)
        self.assertEqual(fake_db._client._tables["candidate_salary_profiles"][0]["offer_status"], "offered")


if __name__ == "__main__":
    unittest.main()
