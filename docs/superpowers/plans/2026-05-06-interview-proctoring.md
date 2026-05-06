# Interview Proctoring Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build medium-strength interview proctoring that detects camera and attention risk events locally, stores only structured events and abnormal keyframes, and merges a human-reviewable risk summary into interview reports.

**Architecture:** The browser owns real-time camera access and event detection. Supabase stores normalized proctoring events and keyframe image paths; FastAPI accepts event batches and folds event summaries into the existing scoring flow. The AI agent may summarize structured risk data, but it never watches video or decides cheating.

**Tech Stack:** React 19, TypeScript, Vite, Supabase Database and Storage, FastAPI, Pydantic, Python unittest, browser `MediaDevices`, `visibilitychange`, and a lightweight face detector package such as `@tensorflow-models/face-detection` with `@tensorflow/tfjs-backend-webgl`.

---

## Scope

This plan implements the first version only:

- Camera consent and readiness gate before starting an interview.
- Local browser detection for camera disabled, no face, multiple faces, sustained off-screen attention, page hidden, and window blur.
- Abnormal event batching to FastAPI and Supabase.
- Keyframe upload only when an abnormal event is recorded.
- Risk aggregation into `interview_reports.risks`, `interview_reports.evidence`, and `interview_reports.risk_score`.
- HR-facing report display of risk events and keyframe links.

This plan does not implement full-session video recording, browser lockdown, identity verification, microphone/audio analysis, device fingerprinting, or automatic cheating decisions.

## File Structure

- Create `supabase/migrations/202605060001_interview_proctoring_events.sql`
  - Creates the `interview-proctoring` storage bucket.
  - Creates `public.interview_proctoring_events`.
  - Adds RLS policies consistent with interview runtime tables.

- Modify `backend/models.py`
  - Adds Pydantic models for proctoring event ingestion.

- Modify `backend/main.py`
  - Adds event validation, event insertion, snapshot metadata handling, risk aggregation helpers, and scoring merge.

- Create `src/lib/interviewProctoring.ts`
  - Defines event types, thresholds, pure aggregation helpers, snapshot naming helpers, and API calls.

- Create `src/hooks/useInterviewProctoring.ts`
  - Owns camera lifecycle, local detector lifecycle, page visibility detection, event debouncing, and event flush scheduling.

- Modify `src/lib/interviewRuntime.ts`
  - Adds typed APIs for proctoring event ingestion and event fetch.

- Modify `src/pages/InterviewRoom.tsx`
  - Adds consent gate, camera preview/status panel, start blocking when camera is unavailable, and report display of proctoring risk evidence.

- Create `tests/interview/interviewProctoring.test.ts`
  - Tests pure event classification, severity mapping, risk aggregation, and snapshot path creation.

- Modify `tests/backend/test_interview_scoring.py`
  - Adds backend unit tests for proctoring event ingestion and risk merge into scoring.

- Modify `package.json`
  - Adds browser detection dependencies and a TypeScript test script if the implementation chooses Node-executed TS tests.

---

### Task 1: Database Schema and Storage Bucket

**Files:**
- Create: `supabase/migrations/202605060001_interview_proctoring_events.sql`

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/202605060001_interview_proctoring_events.sql` with this content:

```sql
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'interview-proctoring',
  'interview-proctoring',
  false,
  1048576,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create table if not exists public.interview_proctoring_events (
  id uuid primary key default gen_random_uuid(),
  interview_id uuid not null references public.upcoming_interviews(id) on delete cascade,
  session_id uuid not null references public.interview_sessions(id) on delete cascade,
  event_type text not null,
  severity text not null,
  confidence numeric(4,3) not null default 0.500 check (confidence >= 0 and confidence <= 1),
  started_at timestamptz not null,
  ended_at timestamptz,
  duration_ms integer not null default 0 check (duration_ms >= 0),
  snapshot_paths jsonb not null default '[]'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid not null default auth.uid() references auth.users(id),
  created_at timestamptz not null default timezone('utc', now())
);

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'interview_proctoring_events_type_check'
  ) then
    alter table public.interview_proctoring_events
      add constraint interview_proctoring_events_type_check
      check (event_type in (
        'camera_denied',
        'camera_closed',
        'no_face',
        'multiple_faces',
        'off_screen_attention',
        'page_hidden',
        'window_blur'
      ));
  end if;
end;
$$;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'interview_proctoring_events_severity_check'
  ) then
    alter table public.interview_proctoring_events
      add constraint interview_proctoring_events_severity_check
      check (severity in ('low', 'medium', 'high'));
  end if;
end;
$$;

create index if not exists idx_interview_proctoring_events_interview_id
  on public.interview_proctoring_events (interview_id, created_at desc);

create index if not exists idx_interview_proctoring_events_session_id
  on public.interview_proctoring_events (session_id, created_at desc);

create index if not exists idx_interview_proctoring_events_type
  on public.interview_proctoring_events (event_type);

alter table public.interview_proctoring_events enable row level security;

drop policy if exists interview_proctoring_events_select on public.interview_proctoring_events;
create policy interview_proctoring_events_select
on public.interview_proctoring_events
for select
to authenticated
using (
  public.user_has_permission('VIEW_DASHBOARD')
  or public.user_has_permission('VIEW_CANDIDATES')
  or public.user_has_permission('MANAGE_INTERVIEWS')
);

drop policy if exists interview_proctoring_events_insert on public.interview_proctoring_events;
create policy interview_proctoring_events_insert
on public.interview_proctoring_events
for insert
to authenticated
with check (
  public.user_has_permission('MANAGE_INTERVIEWS')
  and created_by = auth.uid()
  and exists (
    select 1
    from public.interview_sessions s
    where s.id = interview_proctoring_events.session_id
      and s.interview_id = interview_proctoring_events.interview_id
  )
);

drop policy if exists interview_proctoring_events_update on public.interview_proctoring_events;
create policy interview_proctoring_events_update
on public.interview_proctoring_events
for update
to authenticated
using (public.user_has_permission('MANAGE_INTERVIEWS'))
with check (public.user_has_permission('MANAGE_INTERVIEWS'));

drop policy if exists interview_proctoring_events_delete on public.interview_proctoring_events;
create policy interview_proctoring_events_delete
on public.interview_proctoring_events
for delete
to authenticated
using (public.user_has_permission('MANAGE_INTERVIEWS'));

drop policy if exists interview_proctoring_objects_select on storage.objects;
create policy interview_proctoring_objects_select
on storage.objects
for select
to authenticated
using (
  bucket_id = 'interview-proctoring'
  and (
    public.user_has_permission('VIEW_DASHBOARD')
    or public.user_has_permission('VIEW_CANDIDATES')
    or public.user_has_permission('MANAGE_INTERVIEWS')
  )
);

drop policy if exists interview_proctoring_objects_insert on storage.objects;
create policy interview_proctoring_objects_insert
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'interview-proctoring'
  and public.user_has_permission('MANAGE_INTERVIEWS')
);
```

- [ ] **Step 2: Apply the migration locally**

Run:

```bash
supabase db reset
```

Expected: command exits successfully and includes the new migration in the applied migration list.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/202605060001_interview_proctoring_events.sql
git commit -m "feat: add interview proctoring schema"
```

---

### Task 2: Frontend Proctoring Domain Helpers

**Files:**
- Create: `src/lib/interviewProctoring.ts`
- Create: `tests/interview/interviewProctoring.test.ts`
- Modify: `package.json`

- [ ] **Step 1: Add a TypeScript test script**

Modify `package.json` scripts to include:

```json
{
  "scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build",
    "lint": "eslint .",
    "preview": "vite preview",
    "test:interview": "tsx tests/interview/*.test.ts"
  }
}
```

If `tsx` is not already installed, add it:

```bash
npm install -D tsx
```

Expected: `package.json` and `package-lock.json` update.

- [ ] **Step 2: Write failing tests**

Create `tests/interview/interviewProctoring.test.ts`:

```ts
import assert from 'node:assert/strict';
import {
  buildSnapshotPath,
  deriveProctoringSeverity,
  summarizeProctoringEvents,
  shouldOpenTimedEvent
} from '../../src/lib/interviewProctoring.ts';

assert.equal(deriveProctoringSeverity('camera_closed', 100), 'high');
assert.equal(deriveProctoringSeverity('multiple_faces', 3500), 'high');
assert.equal(deriveProctoringSeverity('no_face', 5200), 'medium');
assert.equal(deriveProctoringSeverity('off_screen_attention', 9000), 'medium');
assert.equal(deriveProctoringSeverity('page_hidden', 12000), 'medium');
assert.equal(deriveProctoringSeverity('window_blur', 1200), 'low');

assert.equal(shouldOpenTimedEvent('no_face', 4999), false);
assert.equal(shouldOpenTimedEvent('no_face', 5000), true);
assert.equal(shouldOpenTimedEvent('multiple_faces', 2999), false);
assert.equal(shouldOpenTimedEvent('multiple_faces', 3000), true);
assert.equal(shouldOpenTimedEvent('off_screen_attention', 8000), true);
assert.equal(shouldOpenTimedEvent('page_hidden', 10000), true);

assert.equal(
  buildSnapshotPath({
    interviewId: 'interview-1',
    sessionId: 'session-1',
    eventType: 'multiple_faces',
    timestampMs: Date.parse('2026-05-06T10:11:12.000Z')
  }),
  'interview-1/session-1/multiple_faces-2026-05-06T10-11-12-000Z.webp'
);

const summary = summarizeProctoringEvents([
  {
    event_type: 'multiple_faces',
    severity: 'high',
    confidence: 0.91,
    duration_ms: 4200,
    snapshot_paths: ['a.webp'],
    started_at: '2026-05-06T10:00:00Z'
  },
  {
    event_type: 'page_hidden',
    severity: 'medium',
    confidence: 1,
    duration_ms: 12000,
    snapshot_paths: [],
    started_at: '2026-05-06T10:03:00Z'
  }
]);

assert.equal(summary.eventCount, 2);
assert.equal(summary.highCount, 1);
assert.equal(summary.mediumCount, 1);
assert.equal(summary.riskScore, 45);
assert.match(summary.summaryText, /多人入镜/);
assert.match(summary.summaryText, /页面离开/);

console.log('interviewProctoring tests passed');
```

- [ ] **Step 3: Run test to verify it fails**

Run:

```bash
npm run test:interview -- tests/interview/interviewProctoring.test.ts
```

Expected: fails because `src/lib/interviewProctoring.ts` does not exist.

- [ ] **Step 4: Implement domain helpers**

Create `src/lib/interviewProctoring.ts`:

```ts
import { supabase } from './supabase';

export type ProctoringEventType =
  | 'camera_denied'
  | 'camera_closed'
  | 'no_face'
  | 'multiple_faces'
  | 'off_screen_attention'
  | 'page_hidden'
  | 'window_blur';

export type ProctoringSeverity = 'low' | 'medium' | 'high';

export type ProctoringEventInput = {
  interview_id: string;
  session_id: string;
  event_type: ProctoringEventType;
  severity: ProctoringSeverity;
  confidence: number;
  started_at: string;
  ended_at?: string | null;
  duration_ms: number;
  snapshot_paths: string[];
  metadata: Record<string, unknown>;
};

export type ProctoringEventRow = Omit<ProctoringEventInput, 'interview_id' | 'session_id'> & {
  id?: string;
  interview_id?: string;
  session_id?: string;
  created_at?: string;
};

const THRESHOLDS_MS: Record<ProctoringEventType, number> = {
  camera_denied: 0,
  camera_closed: 0,
  no_face: 5000,
  multiple_faces: 3000,
  off_screen_attention: 8000,
  page_hidden: 10000,
  window_blur: 1000
};

const EVENT_LABELS: Record<ProctoringEventType, string> = {
  camera_denied: '摄像头未授权',
  camera_closed: '摄像头关闭',
  no_face: '无人入镜',
  multiple_faces: '多人入镜',
  off_screen_attention: '长时间看向屏幕外',
  page_hidden: '页面离开',
  window_blur: '窗口失焦'
};

export function shouldOpenTimedEvent(eventType: ProctoringEventType, durationMs: number): boolean {
  return durationMs >= THRESHOLDS_MS[eventType];
}

export function deriveProctoringSeverity(eventType: ProctoringEventType, durationMs: number): ProctoringSeverity {
  if (eventType === 'camera_denied' || eventType === 'camera_closed' || eventType === 'multiple_faces') {
    return 'high';
  }
  if (eventType === 'no_face' && durationMs >= 5000) return 'medium';
  if (eventType === 'off_screen_attention' && durationMs >= 8000) return 'medium';
  if (eventType === 'page_hidden' && durationMs >= 10000) return 'medium';
  return 'low';
}

export function buildSnapshotPath(params: {
  interviewId: string;
  sessionId: string;
  eventType: ProctoringEventType;
  timestampMs: number;
}): string {
  const stamp = new Date(params.timestampMs).toISOString().replace(/[:.]/g, '-');
  return `${params.interviewId}/${params.sessionId}/${params.eventType}-${stamp}.webp`;
}

export function summarizeProctoringEvents(events: ProctoringEventRow[]): {
  eventCount: number;
  highCount: number;
  mediumCount: number;
  lowCount: number;
  riskScore: number;
  summaryText: string;
} {
  const highCount = events.filter((event) => event.severity === 'high').length;
  const mediumCount = events.filter((event) => event.severity === 'medium').length;
  const lowCount = events.filter((event) => event.severity === 'low').length;
  const weighted = highCount * 25 + mediumCount * 10 + lowCount * 3;
  const riskScore = Math.min(100, weighted);
  const grouped = new Map<ProctoringEventType, number>();
  events.forEach((event) => grouped.set(event.event_type, (grouped.get(event.event_type) ?? 0) + 1));
  const summaryText =
    events.length === 0
      ? '本场未记录摄像头风控异常。'
      : Array.from(grouped.entries())
          .map(([type, count]) => `${EVENT_LABELS[type]} ${count} 次`)
          .join('，');
  return { eventCount: events.length, highCount, mediumCount, lowCount, riskScore, summaryText };
}

export async function uploadProctoringSnapshot(path: string, blob: Blob): Promise<string> {
  const { error } = await supabase.storage.from('interview-proctoring').upload(path, blob, {
    contentType: blob.type || 'image/webp',
    upsert: true
  });
  if (error) throw new Error(error.message);
  return path;
}
```

- [ ] **Step 5: Run test to verify it passes**

Run:

```bash
npm run test:interview
```

Expected: all tests in `tests/interview` pass, including `interviewProctoring tests passed`.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json src/lib/interviewProctoring.ts tests/interview/interviewProctoring.test.ts
git commit -m "feat: add proctoring event helpers"
```

---

### Task 3: Backend Proctoring Event API

**Files:**
- Modify: `backend/models.py`
- Modify: `backend/main.py`
- Modify: `tests/backend/test_interview_scoring.py`

- [ ] **Step 1: Add failing backend tests**

Append these tests to `InterviewHumanConfirmTest` in `tests/backend/test_interview_scoring.py`:

```python
    def test_record_proctoring_events_inserts_valid_events(self) -> None:
        tables: dict[str, list[dict[str, object]]] = {
            "interview_sessions": [{"id": "session-1", "interview_id": "interview-1"}],
            "interview_proctoring_events": [],
        }

        with (
            patch.object(main, "db", _FakeDB(tables)),
            patch.object(main, "require_user", return_value={"id": "user-1"}),
        ):
            result = main.record_proctoring_events(
                main.RecordProctoringEventsPayload(
                    interviewId="interview-1",
                    sessionId="session-1",
                    events=[
                        main.ProctoringEventPayload(
                            eventType="multiple_faces",
                            severity="high",
                            confidence=0.92,
                            startedAt="2026-05-06T10:00:00+00:00",
                            endedAt="2026-05-06T10:00:04+00:00",
                            durationMs=4200,
                            snapshotPaths=["interview-1/session-1/multiple_faces.webp"],
                            metadata={"face_count": 2},
                        )
                    ],
                ),
                authorization="Bearer token",
            )

        self.assertTrue(result["ok"])
        self.assertEqual(result["inserted_count"], 1)
        self.assertEqual(tables["interview_proctoring_events"][0]["event_type"], "multiple_faces")
        self.assertEqual(tables["interview_proctoring_events"][0]["created_by"], "user-1")

    def test_record_proctoring_events_rejects_session_mismatch(self) -> None:
        tables: dict[str, list[dict[str, object]]] = {
            "interview_sessions": [{"id": "session-1", "interview_id": "interview-2"}],
            "interview_proctoring_events": [],
        }

        with (
            patch.object(main, "db", _FakeDB(tables)),
            patch.object(main, "require_user", return_value={"id": "user-1"}),
        ):
            with self.assertRaises(main.HTTPException) as raised:
                main.record_proctoring_events(
                    main.RecordProctoringEventsPayload(
                        interviewId="interview-1",
                        sessionId="session-1",
                        events=[],
                    ),
                    authorization="Bearer token",
                )

        self.assertEqual(raised.exception.status_code, 400)
        self.assertEqual(tables["interview_proctoring_events"], [])
```

- [ ] **Step 2: Run tests to verify failure**

Run:

```bash
python -m unittest tests.backend.test_interview_scoring.InterviewHumanConfirmTest.test_record_proctoring_events_inserts_valid_events tests.backend.test_interview_scoring.InterviewHumanConfirmTest.test_record_proctoring_events_rejects_session_mismatch
```

Expected: fails because `RecordProctoringEventsPayload` and `record_proctoring_events` do not exist.

- [ ] **Step 3: Add Pydantic models**

Modify `backend/models.py` by adding these classes after `RoomPasswordPayload`:

```python
class ProctoringEventPayload(BaseModel):
    eventType: str
    severity: str
    confidence: float = 0.5
    startedAt: str
    endedAt: str | None = None
    durationMs: int = 0
    snapshotPaths: list[str] = []
    metadata: dict[str, Any] | None = None


class RecordProctoringEventsPayload(BaseModel):
    interviewId: str
    sessionId: str
    events: list[ProctoringEventPayload]
```

Modify the `from models import (...)` block in `backend/main.py` to include:

```python
    ProctoringEventPayload,
    RecordProctoringEventsPayload,
```

- [ ] **Step 4: Implement event API**

Add these constants and helpers near other interview helper functions in `backend/main.py`:

```python
PROCTORING_EVENT_TYPES = {
    "camera_denied",
    "camera_closed",
    "no_face",
    "multiple_faces",
    "off_screen_attention",
    "page_hidden",
    "window_blur",
}

PROCTORING_SEVERITIES = {"low", "medium", "high"}


def normalize_proctoring_event(event: ProctoringEventPayload, interview_id: str, session_id: str, user_id: str) -> dict[str, Any]:
    event_type = normalize_text(event.eventType)
    severity = normalize_text(event.severity)
    if event_type not in PROCTORING_EVENT_TYPES:
        raise HTTPException(status_code=400, detail=f"Unsupported proctoring event type: {event_type}")
    if severity not in PROCTORING_SEVERITIES:
        raise HTTPException(status_code=400, detail=f"Unsupported proctoring severity: {severity}")
    confidence = max(0.0, min(1.0, float(event.confidence)))
    duration_ms = max(0, int(event.durationMs))
    snapshot_paths = [path for path in event.snapshotPaths if isinstance(path, str) and path.strip()]
    return {
        "interview_id": interview_id,
        "session_id": session_id,
        "event_type": event_type,
        "severity": severity,
        "confidence": confidence,
        "started_at": event.startedAt,
        "ended_at": event.endedAt,
        "duration_ms": duration_ms,
        "snapshot_paths": snapshot_paths[:3],
        "metadata": event.metadata or {},
        "created_by": user_id,
    }
```

Add this route before `/api/interviews/score`:

```python
@app.post("/api/interviews/proctoring-events")
def record_proctoring_events(payload: RecordProctoringEventsPayload, authorization: str | None = Header(default=None)) -> dict[str, Any]:
    user = require_user(authorization)
    client = db.get_client()

    session = db.first(
        client.table("interview_sessions")
        .select("id,interview_id")
        .eq("id", payload.sessionId)
        .limit(1)
        .execute()
    )
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    if str(session.get("interview_id")) != payload.interviewId:
        raise HTTPException(status_code=400, detail="Session and interview mismatch")

    normalized_events = [
        normalize_proctoring_event(event, payload.interviewId, payload.sessionId, user["id"])
        for event in payload.events[:20]
    ]
    if not normalized_events:
        return {"ok": True, "interview_id": payload.interviewId, "session_id": payload.sessionId, "inserted_count": 0}

    inserted = db.many(client.table("interview_proctoring_events").insert(normalized_events).execute())
    return {
        "ok": True,
        "interview_id": payload.interviewId,
        "session_id": payload.sessionId,
        "inserted_count": len(inserted),
    }
```

- [ ] **Step 5: Run backend tests**

Run:

```bash
python -m unittest tests.backend.test_interview_scoring
```

Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add backend/models.py backend/main.py tests/backend/test_interview_scoring.py
git commit -m "feat: record interview proctoring events"
```

---

### Task 4: Backend Risk Aggregation During Scoring

**Files:**
- Modify: `backend/main.py`
- Modify: `tests/backend/test_interview_scoring.py`

- [ ] **Step 1: Add failing scoring merge test**

Append this test to `InterviewHumanConfirmTest`:

```python
    def test_score_merges_proctoring_risk_into_report(self) -> None:
        tables: dict[str, list[dict[str, object]]] = {
            "interview_sessions": [
                {
                    "id": "session-1",
                    "interview_id": "interview-1",
                    "candidate_id": "candidate-1",
                    "status": "scoring",
                }
            ],
            "interview_reports": [],
            "interview_proctoring_events": [
                {
                    "id": "event-1",
                    "session_id": "session-1",
                    "interview_id": "interview-1",
                    "event_type": "multiple_faces",
                    "severity": "high",
                    "confidence": 0.91,
                    "duration_ms": 4200,
                    "snapshot_paths": ["interview-1/session-1/multiple_faces.webp"],
                    "started_at": "2026-05-06T10:00:00+00:00",
                },
                {
                    "id": "event-2",
                    "session_id": "session-1",
                    "interview_id": "interview-1",
                    "event_type": "page_hidden",
                    "severity": "medium",
                    "confidence": 1,
                    "duration_ms": 12000,
                    "snapshot_paths": [],
                    "started_at": "2026-05-06T10:03:00+00:00",
                },
            ],
            "upcoming_interviews": [{"id": "interview-1", "status": "completed"}],
        }
        agent_response = {
            "response": {
                "status": "finish",
                "final_report": {
                    "overall_score": 80,
                    "hire_recommendation": "lean hire",
                    "strengths": [{"claim": "Good technical depth"}],
                    "weaknesses": [],
                    "detailed_evaluations": [],
                },
            },
            "state_snapshot": {},
        }

        with (
            patch.object(main, "db", _FakeDB(tables)),
            patch.object(main, "require_user", return_value={"id": "user-1"}),
            patch.object(main, "now_iso", return_value="2026-05-06T10:30:00+00:00"),
            patch.object(main, "agent_fetch", return_value=agent_response),
        ):
            result = main.score_interview(
                main.ScoreInterviewPayload(interviewId="interview-1", sessionId="session-1"),
                authorization="Bearer token",
            )

        report = result["report"]
        self.assertEqual(report["recommendation"], "needs_review")
        self.assertGreaterEqual(report["risk_score"], 45)
        self.assertTrue(any("多人入镜" in str(item) for item in report["risks"]))
        self.assertTrue(any(item.get("type") == "proctoring" for item in report["evidence"]))
```

- [ ] **Step 2: Run test to verify failure**

Run:

```bash
python -m unittest tests.backend.test_interview_scoring.InterviewHumanConfirmTest.test_score_merges_proctoring_risk_into_report
```

Expected: fails because scoring does not merge proctoring events.

- [ ] **Step 3: Implement aggregation helpers**

Add this helper block to `backend/main.py`:

```python
PROCTORING_EVENT_LABELS = {
    "camera_denied": "摄像头未授权",
    "camera_closed": "摄像头关闭",
    "no_face": "无人入镜",
    "multiple_faces": "多人入镜",
    "off_screen_attention": "长时间看向屏幕外",
    "page_hidden": "页面离开",
    "window_blur": "窗口失焦",
}


def build_proctoring_summary(events: list[dict[str, Any]]) -> dict[str, Any]:
    high_count = len([event for event in events if event.get("severity") == "high"])
    medium_count = len([event for event in events if event.get("severity") == "medium"])
    low_count = len([event for event in events if event.get("severity") == "low"])
    risk_score = min(100, high_count * 25 + medium_count * 10 + low_count * 3)
    grouped: dict[str, int] = {}
    for event in events:
        event_type = normalize_text(event.get("event_type"))
        grouped[event_type] = grouped.get(event_type, 0) + 1
    event_summary = [
        f"{PROCTORING_EVENT_LABELS.get(event_type, event_type)} {count} 次"
        for event_type, count in grouped.items()
        if event_type
    ]
    snapshots: list[str] = []
    for event in events:
        paths = event.get("snapshot_paths") if isinstance(event.get("snapshot_paths"), list) else []
        snapshots.extend([path for path in paths if isinstance(path, str) and path.strip()])
    return {
        "event_count": len(events),
        "high_count": high_count,
        "medium_count": medium_count,
        "low_count": low_count,
        "risk_score": risk_score,
        "summary": "，".join(event_summary),
        "snapshot_paths": snapshots[:12],
    }


def merge_proctoring_into_report(mapped: dict[str, Any], summary: dict[str, Any]) -> dict[str, Any]:
    if int(summary.get("event_count") or 0) <= 0:
        return mapped
    risk_score = max(int(mapped.get("risk_score") or 0), int(summary.get("risk_score") or 0))
    risks = list(mapped.get("risks") or [])
    risks.append(
        {
            "type": "proctoring",
            "severity": "high" if summary.get("high_count") else "medium",
            "message": f"摄像头风控需人工复核：{summary.get('summary')}",
            "event_count": summary.get("event_count"),
        }
    )
    evidence = list(mapped.get("evidence") or [])
    evidence.append(
        {
            "type": "proctoring",
            "summary": summary.get("summary"),
            "event_count": summary.get("event_count"),
            "risk_score": summary.get("risk_score"),
            "snapshot_paths": summary.get("snapshot_paths") or [],
        }
    )
    recommendation = mapped.get("recommendation")
    if summary.get("high_count") or risk_score >= 40:
        recommendation = "needs_review"
    return {
        **mapped,
        "risks": risks,
        "evidence": evidence,
        "risk_score": risk_score,
        "recommendation": recommendation,
    }
```

- [ ] **Step 4: Call aggregation from scoring**

In `score_interview`, after:

```python
    mapped = map_agent_report_to_interview_report(final_report)
```

insert:

```python
    proctoring_events = db.many(
        client.table("interview_proctoring_events")
        .select("id,event_type,severity,confidence,duration_ms,snapshot_paths,started_at")
        .eq("session_id", payload.sessionId)
        .order("created_at")
        .execute()
    )
    mapped = merge_proctoring_into_report(mapped, build_proctoring_summary(proctoring_events))
```

- [ ] **Step 5: Run backend tests**

Run:

```bash
python -m unittest tests.backend.test_interview_scoring
```

Expected: all backend interview scoring tests pass.

- [ ] **Step 6: Commit**

```bash
git add backend/main.py tests/backend/test_interview_scoring.py
git commit -m "feat: merge proctoring risk into interview reports"
```

---

### Task 5: Frontend Runtime API Wiring

**Files:**
- Modify: `src/lib/interviewRuntime.ts`

- [ ] **Step 1: Add proctoring types and payloads**

Add these exports near the existing interview runtime types:

```ts
export interface RecordProctoringEventsPayload {
  interviewId: string;
  sessionId: string;
  events: Array<{
    eventType: string;
    severity: string;
    confidence: number;
    startedAt: string;
    endedAt?: string | null;
    durationMs: number;
    snapshotPaths: string[];
    metadata?: Record<string, unknown>;
  }>;
}
```

- [ ] **Step 2: Add FastAPI route mapping**

In `invokeEdgeFunction`, add:

```ts
    'interview-proctoring-events': '/api/interviews/proctoring-events',
```

to `fastApiRoutes`.

- [ ] **Step 3: Add runtime method**

Add this method to `interviewRuntimeEdge`:

```ts
  recordProctoringEvents: <T = unknown>(payload: RecordProctoringEventsPayload) =>
    invokeEdgeFunction<T>('interview-proctoring-events', payload)
```

The final object should keep commas valid:

```ts
export const interviewRuntimeEdge = {
  prepareInterview: <T = unknown>(payload: PrepareInterviewPayload) =>
    invokeEdgeFunction<T>('interview-prepare', payload),
  startInterview: <T = unknown>(payload: StartInterviewPayload) =>
    invokeEdgeFunction<T>('interview-start', payload),
  appendTurn: <T = unknown>(payload: AppendTurnPayload) =>
    invokeEdgeFunction<T>('interview-turn', payload),
  finishInterview: <T = unknown>(payload: FinishInterviewPayload) =>
    invokeEdgeFunction<T>('interview-finish', payload),
  scoreInterview: <T = unknown>(payload: ScoreInterviewPayload) =>
    invokeEdgeFunction<T>('interview-score', payload),
  humanConfirm: <T = unknown>(payload: HumanConfirmPayload) =>
    invokeEdgeFunction<T>('interview-human-confirm', payload),
  recordProctoringEvents: <T = unknown>(payload: RecordProctoringEventsPayload) =>
    invokeEdgeFunction<T>('interview-proctoring-events', payload)
};
```

- [ ] **Step 4: Verify TypeScript build**

Run:

```bash
npm run build
```

Expected: TypeScript and Vite build complete successfully.

- [ ] **Step 5: Commit**

```bash
git add src/lib/interviewRuntime.ts
git commit -m "feat: wire proctoring event runtime API"
```

---

### Task 6: Browser Proctoring Hook

**Files:**
- Create: `src/hooks/useInterviewProctoring.ts`
- Modify: `package.json`

- [ ] **Step 1: Install face detection dependencies**

Run:

```bash
npm install @tensorflow/tfjs-backend-webgl @tensorflow-models/face-detection
```

Expected: dependencies appear in `package.json` and `package-lock.json`.

- [ ] **Step 2: Implement the hook**

Create `src/hooks/useInterviewProctoring.ts`:

```ts
import { useCallback, useEffect, useRef, useState } from 'react';
import { interviewRuntimeEdge } from '../lib/interviewRuntime';
import {
  buildSnapshotPath,
  deriveProctoringSeverity,
  ProctoringEventInput,
  ProctoringEventType,
  shouldOpenTimedEvent,
  uploadProctoringSnapshot
} from '../lib/interviewProctoring';

type Detector = {
  estimateFaces: (video: HTMLVideoElement) => Promise<Array<{ box?: { width: number; height: number }; keypoints?: Array<{ x: number; y: number; name?: string }> }>>;
};

type ProctoringStatus = 'idle' | 'requesting' | 'ready' | 'warning' | 'blocked' | 'error';

type ActiveTimedEvent = {
  eventType: ProctoringEventType;
  startedAtMs: number;
  snapshotTaken: boolean;
};

const DETECTION_INTERVAL_MS = 1000;

export function useInterviewProctoring(params: {
  interviewId: string;
  sessionId: string | null;
  enabled: boolean;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const detectorRef = useRef<Detector | null>(null);
  const activeEventsRef = useRef<Map<ProctoringEventType, ActiveTimedEvent>>(new Map());
  const pendingEventsRef = useRef<ProctoringEventInput[]>([]);
  const flushTimerRef = useRef<number | null>(null);
  const [status, setStatus] = useState<ProctoringStatus>('idle');
  const [statusText, setStatusText] = useState('摄像头未启动');
  const [consented, setConsented] = useState(false);

  const captureSnapshot = useCallback(async (eventType: ProctoringEventType): Promise<string[]> => {
    const video = videoRef.current;
    if (!video || !params.sessionId || !video.videoWidth || !video.videoHeight) return [];
    const canvas = document.createElement('canvas');
    canvas.width = Math.min(640, video.videoWidth);
    canvas.height = Math.round((canvas.width / video.videoWidth) * video.videoHeight);
    const ctx = canvas.getContext('2d');
    if (!ctx) return [];
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/webp', 0.72));
    if (!blob) return [];
    const path = buildSnapshotPath({
      interviewId: params.interviewId,
      sessionId: params.sessionId,
      eventType,
      timestampMs: Date.now()
    });
    await uploadProctoringSnapshot(path, blob);
    return [path];
  }, [params.interviewId, params.sessionId]);

  const flushEvents = useCallback(async () => {
    if (!params.sessionId || pendingEventsRef.current.length === 0) return;
    const events = pendingEventsRef.current.splice(0, 20);
    try {
      await interviewRuntimeEdge.recordProctoringEvents({
        interviewId: params.interviewId,
        sessionId: params.sessionId,
        events: events.map((event) => ({
          eventType: event.event_type,
          severity: event.severity,
          confidence: event.confidence,
          startedAt: event.started_at,
          endedAt: event.ended_at,
          durationMs: event.duration_ms,
          snapshotPaths: event.snapshot_paths,
          metadata: event.metadata
        }))
      });
    } catch {
      pendingEventsRef.current.unshift(...events);
    }
  }, [params.interviewId, params.sessionId]);

  const enqueueEvent = useCallback((event: ProctoringEventInput) => {
    pendingEventsRef.current.push(event);
    if (flushTimerRef.current) window.clearTimeout(flushTimerRef.current);
    flushTimerRef.current = window.setTimeout(() => void flushEvents(), 1500);
  }, [flushEvents]);

  const closeTimedEvent = useCallback(async (eventType: ProctoringEventType, confidence: number, metadata: Record<string, unknown>) => {
    const active = activeEventsRef.current.get(eventType);
    if (!active || !params.sessionId) return;
    activeEventsRef.current.delete(eventType);
    const endedAtMs = Date.now();
    const durationMs = endedAtMs - active.startedAtMs;
    if (!shouldOpenTimedEvent(eventType, durationMs)) return;
    const snapshotPaths = active.snapshotTaken ? await captureSnapshot(eventType) : [];
    enqueueEvent({
      interview_id: params.interviewId,
      session_id: params.sessionId,
      event_type: eventType,
      severity: deriveProctoringSeverity(eventType, durationMs),
      confidence,
      started_at: new Date(active.startedAtMs).toISOString(),
      ended_at: new Date(endedAtMs).toISOString(),
      duration_ms: durationMs,
      snapshot_paths: snapshotPaths,
      metadata
    });
  }, [captureSnapshot, enqueueEvent, params.interviewId, params.sessionId]);

  const markTimedEvent = useCallback((eventType: ProctoringEventType) => {
    if (!activeEventsRef.current.has(eventType)) {
      activeEventsRef.current.set(eventType, {
        eventType,
        startedAtMs: Date.now(),
        snapshotTaken: eventType !== 'window_blur' && eventType !== 'page_hidden'
      });
    }
  }, []);

  const start = useCallback(async () => {
    if (!params.enabled) return;
    setStatus('requesting');
    setStatusText('正在请求摄像头权限');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      const tf = await import('@tensorflow/tfjs-backend-webgl');
      await tf.setWebGLContext?.(undefined);
      const faceDetection = await import('@tensorflow-models/face-detection');
      detectorRef.current = await faceDetection.createDetector(faceDetection.SupportedModels.MediaPipeFaceDetector, {
        runtime: 'tfjs',
        maxFaces: 3
      }) as Detector;
      setStatus('ready');
      setStatusText('监考正常');
    } catch {
      setStatus('blocked');
      setStatusText('摄像头不可用，请授权后再开始面试');
      if (params.sessionId) {
        enqueueEvent({
          interview_id: params.interviewId,
          session_id: params.sessionId,
          event_type: 'camera_denied',
          severity: 'high',
          confidence: 1,
          started_at: new Date().toISOString(),
          ended_at: new Date().toISOString(),
          duration_ms: 0,
          snapshot_paths: [],
          metadata: { source: 'getUserMedia' }
        });
      }
    }
  }, [enqueueEvent, params.enabled, params.interviewId, params.sessionId]);

  const stop = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    detectorRef.current = null;
    activeEventsRef.current.clear();
    setStatus('idle');
    setStatusText('摄像头未启动');
  }, []);

  useEffect(() => {
    if (!params.enabled || status !== 'ready') return;
    let cancelled = false;
    const timer = window.setInterval(() => {
      const run = async () => {
        const video = videoRef.current;
        const detector = detectorRef.current;
        if (!video || !detector || cancelled) return;
        const faces = await detector.estimateFaces(video);
        if (faces.length === 0) markTimedEvent('no_face');
        else void closeTimedEvent('no_face', 0.85, { face_count: faces.length });
        if (faces.length > 1) markTimedEvent('multiple_faces');
        else void closeTimedEvent('multiple_faces', 0.9, { face_count: faces.length });
        const trackEnded = streamRef.current?.getVideoTracks().some((track) => track.readyState === 'ended');
        if (trackEnded) markTimedEvent('camera_closed');
        else void closeTimedEvent('camera_closed', 1, {});
        setStatus(faces.length === 1 && !trackEnded ? 'ready' : 'warning');
        setStatusText(faces.length === 1 && !trackEnded ? '监考正常' : '请保持本人在摄像头画面中');
      };
      void run();
    }, DETECTION_INTERVAL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [closeTimedEvent, markTimedEvent, params.enabled, status]);

  useEffect(() => {
    const onVisibility = () => {
      if (document.hidden) markTimedEvent('page_hidden');
      else void closeTimedEvent('page_hidden', 1, { hidden: false });
    };
    const onBlur = () => markTimedEvent('window_blur');
    const onFocus = () => void closeTimedEvent('window_blur', 1, { focused: true });
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('blur', onBlur);
    window.addEventListener('focus', onFocus);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('blur', onBlur);
      window.removeEventListener('focus', onFocus);
    };
  }, [closeTimedEvent, markTimedEvent]);

  useEffect(() => () => {
    stop();
    void flushEvents();
  }, [flushEvents, stop]);

  return {
    videoRef,
    status,
    statusText,
    consented,
    setConsented,
    start,
    stop,
    flushEvents
  };
}
```

- [ ] **Step 3: Build and fix import issues**

Run:

```bash
npm run build
```

Expected: build may fail on the exact TensorFlow import API. If it fails, replace the TensorFlow backend initialization in the hook with:

```ts
await import('@tensorflow/tfjs-backend-webgl');
```

Then run `npm run build` again. Expected final result: build succeeds.

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json src/hooks/useInterviewProctoring.ts
git commit -m "feat: add browser proctoring hook"
```

---

### Task 7: Interview Room UI Integration

**Files:**
- Modify: `src/pages/InterviewRoom.tsx`

- [ ] **Step 1: Import hook and camera icons**

Modify imports:

```ts
import { AlertCircle, AlertTriangle, ArrowLeft, Camera, CameraOff, CheckCircle2, Info, Play, Send, ShieldCheck, Timer } from 'lucide-react';
import { useInterviewProctoring } from '../hooks/useInterviewProctoring';
```

- [ ] **Step 2: Create hook instance**

After `sessionFinalized` is defined, add:

```ts
  const proctoring = useInterviewProctoring({
    interviewId,
    sessionId: interview?.session_id ?? null,
    enabled: accessGranted && !sessionFinalized
  });
```

- [ ] **Step 3: Require consent and ready camera before start**

Modify `canStart` so it includes:

```ts
  const canStart =
    accessGranted &&
    proctoring.consented &&
    proctoring.status === 'ready' &&
    busyAction === null &&
    Boolean(interview?.candidate_id) &&
    !hasInterviewStarted &&
    !isInterviewClosed;
```

If `canStart` already exists with nearby conditions, preserve existing conditions and add `proctoring.consented` plus `proctoring.status === 'ready'`.

- [ ] **Step 4: Start proctoring after password access**

In the branch that renders the pre-start interview card, insert this block before the start buttons:

```tsx
            <div className="rounded-[20px] border border-[#d6e2f1] bg-[#f7fbff] p-4 space-y-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="text-sm font-semibold text-[#16355f] inline-flex items-center gap-2">
                    <ShieldCheck className="w-4 h-4" />
                    摄像头风控
                  </h3>
                  <p className="mt-1 text-xs text-[#6b86a4]">
                    系统仅在异常发生时保存关键帧，用于面试后人工复核，不保存全程录像。
                  </p>
                </div>
                <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-1 text-xs ${
                  proctoring.status === 'ready'
                    ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                    : proctoring.status === 'blocked' || proctoring.status === 'error'
                      ? 'border-[#efc1c8] bg-[#fff4f6] text-[#c43d4b]'
                      : 'border-[#d6e2f1] bg-white text-[#4b6b90]'
                }`}>
                  {proctoring.status === 'ready' ? <Camera className="w-3.5 h-3.5" /> : <CameraOff className="w-3.5 h-3.5" />}
                  {proctoring.statusText}
                </span>
              </div>

              <div className="grid gap-3 md:grid-cols-[220px_minmax(0,1fr)]">
                <video
                  ref={proctoring.videoRef}
                  muted
                  playsInline
                  className="aspect-video w-full rounded-xl border border-[#c7daf6] bg-slate-950 object-cover"
                />
                <div className="space-y-3">
                  <label className="flex items-start gap-2 text-sm text-[#365c85]">
                    <input
                      type="checkbox"
                      checked={proctoring.consented}
                      onChange={(event) => proctoring.setConsented(event.target.checked)}
                      className="mt-1"
                    />
                    <span>我同意在本场面试中开启摄像头风控，并理解异常关键帧会用于人工复核。</span>
                  </label>
                  <button
                    type="button"
                    onClick={() => void proctoring.start()}
                    disabled={!proctoring.consented || proctoring.status === 'requesting' || proctoring.status === 'ready'}
                    className="inline-flex items-center justify-center gap-2 rounded-md bg-surface-container-high text-on-surface px-4 py-2.5 text-sm hover:bg-surface-container-high/80 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
                  >
                    <Camera className="w-4 h-4" />
                    {proctoring.status === 'requesting' ? '检测中...' : proctoring.status === 'ready' ? '摄像头已就绪' : '开启摄像头检测'}
                  </button>
                </div>
              </div>
            </div>
```

- [ ] **Step 5: Flush proctoring before finish scoring**

At the start of `handleFinishAndScore`, after validating `sessionId`, add:

```ts
    await proctoring.flushEvents();
```

- [ ] **Step 6: Show in-room proctoring status**

In the right-side operation panel, add a compact status card above the submit button:

```tsx
              <div className={`rounded-[20px] border px-4 py-3 ${
                proctoring.status === 'ready'
                  ? 'border-emerald-200 bg-emerald-50'
                  : 'border-[#efc1c8] bg-[#fff4f6]'
              }`}>
                <p className="text-[11px] text-[#6b86a4] flex items-center gap-1.5">
                  {proctoring.status === 'ready' ? <Camera className="w-3.5 h-3.5" /> : <CameraOff className="w-3.5 h-3.5" />}
                  摄像头风控
                </p>
                <p className={`text-sm font-semibold ${proctoring.status === 'ready' ? 'text-emerald-700' : 'text-[#c43d4b]'}`}>
                  {proctoring.statusText}
                </p>
              </div>
```

- [ ] **Step 7: Build and inspect UI**

Run:

```bash
npm run build
```

Expected: build succeeds.

Start dev server:

```bash
npm run dev -- --host 127.0.0.1
```

Open the interview room in a browser and verify:

- Pre-start screen shows camera consent and preview.
- Start button stays disabled until consent is checked and camera status is ready.
- In-room right panel shows current camera status.
- Submit still works after `flushEvents`.

- [ ] **Step 8: Commit**

```bash
git add src/pages/InterviewRoom.tsx
git commit -m "feat: require camera proctoring in interview room"
```

---

### Task 8: Report Display of Proctoring Evidence

**Files:**
- Modify: `src/pages/InterviewRoom.tsx`
- Modify: `src/lib/interviewRuntime.ts`

- [ ] **Step 1: Extend report type**

In `InterviewRoom.tsx`, change `RoomReport` to include evidence:

```ts
type RoomReport = {
  overall_score: number | null;
  recommendation: string | null;
  risk_score: number | null;
  summary: string | null;
  dimension_scores: Record<string, number>;
  strengths: string[];
  risks: string[];
  evidence: unknown[];
};
```

In `toReport`, add:

```ts
    evidence: Array.isArray(source.evidence) ? source.evidence : []
```

- [ ] **Step 2: Add evidence parsing helpers**

Add this helper near existing report helpers:

```ts
function getProctoringEvidence(report: RoomReport): Array<{
  summary: string;
  eventCount: number;
  riskScore: number;
  snapshotPaths: string[];
}> {
  return report.evidence
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object')
    .filter((item) => item.type === 'proctoring')
    .map((item) => ({
      summary: typeof item.summary === 'string' ? item.summary : '摄像头风控需人工复核',
      eventCount: Number.isFinite(Number(item.event_count)) ? Number(item.event_count) : 0,
      riskScore: Number.isFinite(Number(item.risk_score)) ? Number(item.risk_score) : 0,
      snapshotPaths: Array.isArray(item.snapshot_paths)
        ? item.snapshot_paths.filter((path): path is string => typeof path === 'string' && path.trim().length > 0)
        : []
    }));
}
```

- [ ] **Step 3: Render proctoring evidence**

Inside the `report && (...)` block, after summary rendering, insert:

```tsx
            {getProctoringEvidence(report).map((item, index) => (
              <div key={`proctoring-evidence-${index}`} className="rounded-[20px] border border-amber-200 bg-amber-50 px-4 py-3 space-y-2">
                <div className="flex items-center justify-between gap-3">
                  <h3 className="text-sm font-semibold text-amber-900">摄像头风控复核</h3>
                  <span className="text-xs font-semibold text-amber-800">风险分 {item.riskScore}</span>
                </div>
                <p className="text-sm text-amber-900">{item.summary}</p>
                <p className="text-xs text-amber-800">异常事件 {item.eventCount} 次；关键帧由 HR 在受控存储中查看。</p>
              </div>
            ))}
```

Do not expose raw storage object paths directly in candidate-facing report views. If HR-only report pages are added later, generate signed URLs on the backend.

- [ ] **Step 4: Build**

Run:

```bash
npm run build
```

Expected: build succeeds.

- [ ] **Step 5: Commit**

```bash
git add src/pages/InterviewRoom.tsx src/lib/interviewRuntime.ts
git commit -m "feat: show proctoring risk in interview report"
```

---

### Task 9: Manual QA and Release Checks

**Files:**
- No source files unless defects are found.

- [ ] **Step 1: Run frontend tests**

Run:

```bash
npm run test:interview
```

Expected: all TypeScript interview tests pass.

- [ ] **Step 2: Run backend tests**

Run:

```bash
python -m unittest tests.backend.test_interview_scoring
```

Expected: all backend tests pass.

- [ ] **Step 3: Run full build**

Run:

```bash
npm run build
```

Expected: TypeScript and Vite build complete successfully.

- [ ] **Step 4: Manual browser check**

Start the backend and frontend using the project’s existing local setup:

```bash
python backend/main.py
npm run dev -- --host 127.0.0.1
```

Expected checks:

- A candidate cannot start without camera consent and ready camera state.
- Denying camera produces a blocked state and does not start the interview.
- Covering the camera for more than 5 seconds creates a `no_face` event.
- Bringing a second face into frame for more than 3 seconds creates a `multiple_faces` event.
- Switching tabs for more than 10 seconds creates a `page_hidden` event.
- Submitting the interview flushes pending events before scoring.
- A high proctoring event changes the final recommendation to `needs_review`.
- The report shows a human-reviewable proctoring risk summary.

- [ ] **Step 5: Commit final fixes**

If QA required fixes, commit them:

```bash
git add backend src tests package.json package-lock.json supabase/migrations
git commit -m "fix: stabilize interview proctoring flow"
```

If no fixes were required, do not create an empty commit.

---

## Implementation Notes

- Camera monitoring must be disclosed before starting. The UI text should say that only abnormal keyframes are retained.
- Never stream raw video to the backend in this version.
- Never display “作弊” in automated output. Use “风险事件” and “建议人工复核”.
- Keep event thresholds in `src/lib/interviewProctoring.ts` so they can be unit tested.
- Keep backend risk scoring deterministic; do not ask the agent to inspect images or infer intent.
- Storage object access should remain private. Candidate-facing UI should not show raw snapshot URLs.

## Self-Review

- Spec coverage: camera gate, local detection, keyframe storage, backend event ingestion, scoring merge, report display, and manual QA are all covered.
- Placeholder scan: no TBD, TODO, “implement later”, or unbounded “handle edge cases” instructions are present.
- Type consistency: frontend event names use snake case for persisted `event_type`, camel case for FastAPI payload fields, and backend normalization maps camel case payloads to snake case database columns.
