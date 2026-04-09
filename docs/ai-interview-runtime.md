# AI Interview Edge Functions

This project now includes a minimal runnable AI interview runtime with 5 Supabase Edge Functions:

- `interview-prepare`
- `interview-start`
- `interview-turn`
- `interview-finish`
- `interview-score`
- `interview-human-confirm`

## Deployment

```bash
npx supabase functions deploy interview-prepare
npx supabase functions deploy interview-start
npx supabase functions deploy interview-turn
npx supabase functions deploy interview-finish
npx supabase functions deploy interview-score
npx supabase functions deploy interview-human-confirm
```

## Agent Gateway

The AI interview flow now depends on an external FastAPI gateway backed by the Python agent.

Required function secrets:

```text
AGENT_BASE_URL=http://<agent-host>:8000
AGENT_SHARED_SECRET=<same-secret-as-agent>
AGENT_TIMEOUT_MS=20000
```

See:

- `docs/agent-integration-runtime.md`
- `D:\project\agent\recruitment-agent\docs\FASTAPI_GATEWAY_SETUP.md`

## Required Database Migration

Run migration:

- `supabase/migrations/202604020017_ai_interview_runtime.sql`

It creates:

- interview status fields in `upcoming_interviews`
- `interview_sessions`
- `interview_turns`
- `interview_reports`

## Request Contracts

All endpoints are `POST` and require bearer auth.

### 1) interview-prepare

Request body:

```json
{
  "interviewId": "<uuid>",
  "candidateId": "<uuid>",
  "positionId": "<uuid>",
  "mode": "async_qa"
}
```

Response highlights:

- `session_id`
- `question_plan`
- interview moves to `ready`

### 2) interview-start

Request body:

```json
{
  "interviewId": "<uuid>",
  "sessionId": "<uuid>"
}
```

Response highlights:

- first AI question inserted when missing
- session moves to `running`
- interview moves to `in_progress`

### 3) interview-turn

Request body:

```json
{
  "sessionId": "<uuid>",
  "speaker": "candidate",
  "content": "...",
  "inputMode": "text",
  "metadata": {}
}
```

Response highlights:

- user turn inserted
- AI follow-up / next question inserted (when speaker is candidate)

### 4) interview-finish

Request body:

```json
{
  "interviewId": "<uuid>",
  "sessionId": "<uuid>"
}
```

Response highlights:

- session moves to `scoring`
- interview marked `completed` with `ended_at`

### 5) interview-score

Request body:

```json
{
  "interviewId": "<uuid>",
  "sessionId": "<uuid>"
}
```

Response highlights:

- computes structured rubric scores
- upserts `interview_reports`
- session moves to `done`
- interview `ai_report_id` is linked

## Rubric (Rule-Based V1)

Current scoring is deterministic rule-based (safe MVP), covering dimensions:

- `role_fit`
- `technical_depth`
- `project_evidence`
- `problem_solving`
- `communication`
- `ownership`

Outputs include:

- overall score
- per-dimension scores
- strengths
- risks
- evidence excerpts
- recommendation (`hire/hold/reject/needs_review`)

## Frontend Integration

Use `src/lib/interviewRuntime.ts` helper methods and edge wrappers:

- `interviewRuntimeEdge.prepareInterview(...)`
- `interviewRuntimeEdge.startInterview(...)`
- `interviewRuntimeEdge.appendTurn(...)`
- `interviewRuntimeEdge.finishInterview(...)`
- `interviewRuntimeEdge.scoreInterview(...)`

