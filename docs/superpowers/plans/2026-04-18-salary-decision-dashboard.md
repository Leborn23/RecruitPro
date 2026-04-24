# Salary Decision Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn `/salary` into a recruiting salary decision console that combines external market benchmarks, candidate expectations, and position budget signals.

**Architecture:** Add a lightweight `candidate_salary_profiles` table, expose a unified salary decision payload through FastAPI, move the decision rules into a focused view-model module, and rebuild the salary page around overview cards, a candidate-position decision list, and a right-side detail panel. The UI should read one aggregated response rather than stitching tables directly in the browser.

**Tech Stack:** Supabase Postgres, FastAPI (Python), React 19, existing Supabase auth patterns, TypeScript view-model utilities, Node `--experimental-strip-types` smoke tests.

---

## File Structure

- Create: `D:/project/RecruitPro_/supabase/migrations/20260418_candidate_salary_profiles.sql`
  - Add `candidate_salary_profiles`
- Modify: `D:/project/RecruitPro_/backend/models.py`
  - Add salary profile payloads
- Modify: `D:/project/RecruitPro_/backend/main.py`
  - Add salary profile CRUD and salary decision dashboard endpoint
- Create: `D:/project/RecruitPro_/src/lib/salaryDecisionViewModel.ts`
  - Pure mapping and rule evaluation for status, risks, recommended offer range
- Create: `D:/project/RecruitPro_/tests/salary/salaryDecisionViewModel.test.ts`
  - Smoke tests for the three decision states
- Modify: `D:/project/RecruitPro_/src/pages/Salary.tsx`
  - Replace direct `market_salaries` reads with dashboard + detail UI

### Task 1: Create candidate salary profile storage

**Files:**
- Create: `D:/project/RecruitPro_/supabase/migrations/20260418_candidate_salary_profiles.sql`
- Test: `D:/project/RecruitPro_/tests/salary/salaryDecisionViewModel.test.ts`

- [ ] **Step 1: Write the failing schema presence check**

```ts
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const sql = readFileSync('D:/project/RecruitPro_/supabase/migrations/20260418_candidate_salary_profiles.sql', 'utf8');
assert.match(sql.toLowerCase(), /create table if not exists public\.candidate_salary_profiles/);
console.log('candidate_salary_profiles migration exists');
```

- [ ] **Step 2: Run the check to verify it fails**

Run: `node D:/project/RecruitPro_/tests/salary/salaryDecisionViewModel.test.ts`

Expected: FAIL because the migration file does not exist yet.

- [ ] **Step 3: Write the migration**

```sql
create table if not exists public.candidate_salary_profiles (
  id uuid primary key default gen_random_uuid(),
  candidate_id uuid not null references public.candidates(id) on delete cascade,
  position_id uuid references public.active_positions(id) on delete set null,
  expected_salary_min numeric,
  expected_salary_max numeric,
  current_salary numeric,
  budget_min numeric,
  budget_max numeric,
  offer_salary numeric,
  offer_status text default 'draft',
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (candidate_id, position_id)
);
```

- [ ] **Step 4: Run the check to verify it passes**

Run: `node D:/project/RecruitPro_/tests/salary/salaryDecisionViewModel.test.ts`

Expected: PASS for the schema existence check.

- [ ] **Step 5: Commit**

```bash
git add D:/project/RecruitPro_/supabase/migrations/20260418_candidate_salary_profiles.sql D:/project/RecruitPro_/tests/salary/salaryDecisionViewModel.test.ts
git commit -m "feat: add candidate salary profile storage"
```

### Task 2: Add salary decision rule module

**Files:**
- Create: `D:/project/RecruitPro_/src/lib/salaryDecisionViewModel.ts`
- Test: `D:/project/RecruitPro_/tests/salary/salaryDecisionViewModel.test.ts`

- [ ] **Step 1: Replace the schema-only test with failing rule tests**

```ts
import assert from 'node:assert/strict';
import { evaluateSalaryDecision } from '../../src/lib/salaryDecisionViewModel.ts';

const proceed = evaluateSalaryDecision({
  marketMin: 25000,
  marketMedian: 32000,
  marketMax: 40000,
  expectedMin: 28000,
  expectedMax: 34000,
  budgetMin: 26000,
  budgetMax: 38000,
  interviewStrength: 'strong',
});
assert.equal(proceed.status, 'proceed');

const negotiate = evaluateSalaryDecision({
  marketMin: 25000,
  marketMedian: 32000,
  marketMax: 40000,
  expectedMin: 39000,
  expectedMax: 45000,
  budgetMin: 30000,
  budgetMax: 42000,
  interviewStrength: 'strong',
});
assert.equal(negotiate.status, 'negotiate');

const hold = evaluateSalaryDecision({
  marketMin: 25000,
  marketMedian: 32000,
  marketMax: 40000,
  expectedMin: 48000,
  expectedMax: 55000,
  budgetMin: 28000,
  budgetMax: 36000,
  interviewStrength: 'mixed',
});
assert.equal(hold.status, 'hold');

console.log('salaryDecisionViewModel tests passed');
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --experimental-strip-types D:/project/RecruitPro_/tests/salary/salaryDecisionViewModel.test.ts`

Expected: FAIL with missing `salaryDecisionViewModel.ts`

- [ ] **Step 3: Implement the minimal rule evaluator**

```ts
export type SalaryDecisionStatus = 'proceed' | 'negotiate' | 'hold';

export function evaluateSalaryDecision(input: {
  marketMin: number;
  marketMedian: number;
  marketMax: number;
  expectedMin?: number | null;
  expectedMax?: number | null;
  budgetMin?: number | null;
  budgetMax?: number | null;
  interviewStrength?: 'strong' | 'mixed' | 'weak';
}) {
  const expectedTop = Number(input.expectedMax ?? input.expectedMin ?? 0);
  const budgetTop = Number(input.budgetMax ?? input.budgetMin ?? 0);
  const overMarketRatio = input.marketMax > 0 ? expectedTop / input.marketMax : 0;

  if (expectedTop <= input.marketMax && (!budgetTop || expectedTop <= budgetTop)) {
    return { status: 'proceed' as const, recommendedMin: input.marketMedian, recommendedMax: input.marketMax, risks: [] };
  }

  if (overMarketRatio <= 1.12 || (input.interviewStrength === 'strong' and budgetTop >= input.marketMax)) {
    return { status: 'negotiate' as const, recommendedMin: input.marketMedian, recommendedMax: Math.max(input.marketMax, budgetTop), risks: ['expectation_above_market'] };
  }

  return { status: 'hold' as const, recommendedMin: input.marketMedian, recommendedMax: input.marketMax, risks: ['budget_gap'] };
}
```

- [ ] **Step 4: Fix the TypeScript syntax and rerun until green**

Replace `and` with `&&`, then run:

`node --experimental-strip-types D:/project/RecruitPro_/tests/salary/salaryDecisionViewModel.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add D:/project/RecruitPro_/src/lib/salaryDecisionViewModel.ts D:/project/RecruitPro_/tests/salary/salaryDecisionViewModel.test.ts
git commit -m "feat: add salary decision rule module"
```

### Task 3: Add FastAPI salary decision dashboard API

**Files:**
- Modify: `D:/project/RecruitPro_/backend/models.py`
- Modify: `D:/project/RecruitPro_/backend/main.py`
- Test: `D:/project/RecruitPro_/tests/backend/test_salary_market_pipeline.py`

- [ ] **Step 1: Add a failing backend shape test**

```python
class SalaryDecisionDashboardShapeTest(unittest.TestCase):
    def test_builds_salary_decision_dashboard_summary(self) -> None:
        payload = main.build_salary_decision_dashboard_payload(
            rows=[
                {"status": "proceed"},
                {"status": "negotiate"},
                {"status": "hold"},
            ]
        )
        self.assertEqual(payload["summary"]["proceed_count"], 1)
        self.assertEqual(payload["summary"]["negotiate_count"], 1)
        self.assertEqual(payload["summary"]["hold_count"], 1)
```

- [ ] **Step 2: Run the backend test to verify it fails**

Run: `python -m unittest D:/project/RecruitPro_/tests/backend/test_salary_market_pipeline.py -v`

Expected: FAIL with missing `build_salary_decision_dashboard_payload`

- [ ] **Step 3: Implement the backend response builder and endpoint**

```python
def build_salary_decision_dashboard_payload(rows: list[dict[str, Any]]) -> dict[str, Any]:
    return {
        "summary": {
            "proceed_count": sum(1 for row in rows if normalize_text(row.get("status")) == "proceed"),
            "negotiate_count": sum(1 for row in rows if normalize_text(row.get("status")) == "negotiate"),
            "hold_count": sum(1 for row in rows if normalize_text(row.get("status")) == "hold"),
            "total_count": len(rows),
        },
        "items": rows,
    }

@app.get("/api/salary/decision-dashboard")
def get_salary_decision_dashboard(authorization: str | None = Header(default=None)) -> dict[str, Any]:
    require_user(authorization)
    client = db.get_client()
    benchmarks = db.many(client.table("market_salary_benchmarks").select("*").execute())
    profiles = db.many(client.table("candidate_salary_profiles").select("*").execute())
    candidates = db.many(client.table("candidates").select("id,name,p_id").execute())
    positions = db.many(client.table("active_positions").select("id,title,location").execute())
    rows = build_salary_decision_rows(candidates, positions, benchmarks, profiles)
    return build_salary_decision_dashboard_payload(rows)
```

- [ ] **Step 4: Run the backend test to verify it passes**

Run: `python -m unittest D:/project/RecruitPro_/tests/backend/test_salary_market_pipeline.py -v`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add D:/project/RecruitPro_/backend/main.py D:/project/RecruitPro_/backend/models.py D:/project/RecruitPro_/tests/backend/test_salary_market_pipeline.py
git commit -m "feat: add salary decision dashboard api"
```

### Task 4: Rebuild the salary page against the aggregated API

**Files:**
- Modify: `D:/project/RecruitPro_/src/pages/Salary.tsx`
- Modify: `D:/project/RecruitPro_/src/lib/supabase.ts` (only if a helper is strictly necessary)
- Test: `D:/project/RecruitPro_/tests/salary/salaryDecisionViewModel.test.ts`

- [ ] **Step 1: Extend the failing test with a UI-oriented row expectation**

```ts
import { mapSalaryDecisionRow } from '../../src/lib/salaryDecisionViewModel.ts';

const row = mapSalaryDecisionRow({
  candidateName: '吕德佳',
  positionTitle: '计算机视觉算法工程师',
  status: 'negotiate',
  expectedMin: 38000,
  expectedMax: 45000,
  marketMin: 26000,
  marketMedian: 34000,
  marketMax: 42000,
});
assert.equal(row.statusLabel, '需谈判');
assert.match(row.marketRangeLabel, /26000/);
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --experimental-strip-types D:/project/RecruitPro_/tests/salary/salaryDecisionViewModel.test.ts`

Expected: FAIL with missing `mapSalaryDecisionRow`

- [ ] **Step 3: Implement the mapping helper and rebuild `Salary.tsx`**

```ts
export function mapSalaryDecisionRow(input: {
  candidateName: string;
  positionTitle: string;
  status: SalaryDecisionStatus;
  expectedMin?: number | null;
  expectedMax?: number | null;
  marketMin: number;
  marketMedian: number;
  marketMax: number;
}) {
  const statusLabelMap = {
    proceed: '可推进',
    negotiate: '需谈判',
    hold: '暂缓',
  } as const;

  return {
    ...input,
    statusLabel: statusLabelMap[input.status],
    marketRangeLabel: `${input.marketMin} - ${input.marketMax}`,
  };
}
```

In `D:/project/RecruitPro_/src/pages/Salary.tsx`, replace:

```ts
const [activeTab, setActiveTab] = useState<'market' | 'internal'>('market');
const [salaries, setSalaries] = useState<any[]>([]);
```

with:

```ts
const [dashboard, setDashboard] = useState<any>(null);
const [selectedId, setSelectedId] = useState<string | null>(null);
const [loading, setLoading] = useState(true);
```

and load from:

```ts
const response = await fetch(`${import.meta.env.VITE_FASTAPI_BASE_URL}/api/salary/decision-dashboard`, {
  headers: { Authorization: `Bearer ${(await supabase.auth.getSession()).data.session?.access_token ?? ''}` },
});
const data = await response.json();
setDashboard(data);
```

- [ ] **Step 4: Run the test and build to verify they pass**

Run: `node --experimental-strip-types D:/project/RecruitPro_/tests/salary/salaryDecisionViewModel.test.ts`

Expected: PASS

Run: `npm run build`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add D:/project/RecruitPro_/src/lib/salaryDecisionViewModel.ts D:/project/RecruitPro_/src/pages/Salary.tsx D:/project/RecruitPro_/tests/salary/salaryDecisionViewModel.test.ts
git commit -m "feat: rebuild salary page as recruiting decision dashboard"
```

### Task 5: Add lightweight offer note updates

**Files:**
- Modify: `D:/project/RecruitPro_/backend/main.py`
- Modify: `D:/project/RecruitPro_/backend/models.py`
- Modify: `D:/project/RecruitPro_/src/pages/Salary.tsx`

- [ ] **Step 1: Add a failing backend payload test**

```python
class SalaryProfilePatchShapeTest(unittest.TestCase):
    def test_accepts_offer_note_patch_fields(self) -> None:
        payload = main.normalize_salary_profile_patch(
            {
                "offer_salary": 38000,
                "offer_status": "draft",
                "notes": "候选人可接受期权补偿",
            }
        )
        self.assertEqual(payload["offer_salary"], 38000)
        self.assertEqual(payload["offer_status"], "draft")
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `python -m unittest D:/project/RecruitPro_/tests/backend/test_salary_market_pipeline.py -v`

Expected: FAIL with missing `normalize_salary_profile_patch`

- [ ] **Step 3: Implement the patch normalizer and update endpoint**

```python
def normalize_salary_profile_patch(payload: dict[str, Any]) -> dict[str, Any]:
    return {
        "offer_salary": payload.get("offer_salary"),
        "offer_status": normalize_text(payload.get("offer_status")) or "draft",
        "notes": normalize_text(payload.get("notes")),
        "updated_at": now_iso(),
    }

@app.patch("/api/salary/candidate-profile/{profile_id}")
def patch_salary_candidate_profile(profile_id: str, payload: dict[str, Any], authorization: str | None = Header(default=None)) -> dict[str, Any]:
    require_user(authorization)
    client = db.get_client()
    patch = normalize_salary_profile_patch(payload)
    row = db.first(
        client.table("candidate_salary_profiles")
        .update(patch)
        .eq("id", profile_id)
        .execute()
    )
    if not row:
        raise HTTPException(status_code=404, detail="Salary profile not found")
    return row
```

- [ ] **Step 4: Wire the right-side detail panel save action and verify**

In `D:/project/RecruitPro_/src/pages/Salary.tsx`, call the patch endpoint from the detail panel save button and then refresh the selected row from the dashboard payload.

Run: `npm run build`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add D:/project/RecruitPro_/backend/main.py D:/project/RecruitPro_/backend/models.py D:/project/RecruitPro_/src/pages/Salary.tsx
git commit -m "feat: add lightweight salary offer note updates"
```
