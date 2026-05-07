# API Contract

This contract describes the stable HTTP boundary exposed by `src.main:app`.

## Authentication

If `AGENT_SHARED_SECRET` is set, every `/agent/*` request must include:

```text
x-agent-secret: <AGENT_SHARED_SECRET>
```

`GET /healthz` does not require this header.

## Runtime State Machine

The `status` field in every agent response is one of:

| Status | Meaning | Expected next caller action |
| --- | --- | --- |
| `ask` | The agent is waiting for the candidate's answer. | Call `POST /agent/answer`. |
| `wait_for_review` | The agent has paused for human review before finalization. | Call `POST /agent/review`. |
| `finish` | The interview is complete. | Read `final_report` or `GET /agent/status`. |
| `error` | The requested action is invalid or the session cannot be found. | Fix the caller state and retry the valid endpoint. |

Normal successful flow:

```text
POST /agent/start
  -> status=ask
POST /agent/answer
  -> status=ask or wait_for_review
POST /agent/review
  -> status=finish
```

## Shared Response Shape

Every mutating endpoint returns the serialized `AgentResponse` plus `state_snapshot`:

```json
{
  "status": "ask",
  "thread_id": "session-123",
  "message": "Candidate-facing text",
  "candidate_profile": {},
  "job_profile": {},
  "gap_analysis": {},
  "interview_plan": {},
  "partial_eval": {},
  "final_report": null,
  "metadata": {},
  "state_snapshot": {
    "asked_question_count": 1,
    "answer_count": 0,
    "planned_question_count": 3,
    "next_nodes": ["evaluate_answer"]
  }
}
```

Fields that are not ready for the current phase are `null`.

## Endpoints

### `GET /agent/runtime-config`

Returns runtime configuration useful for operations dashboards:

- `interview_question_range`
- `checkpoint_backend`
- `checkpoint_location`
- `declared_worker_count`
- `session_lock_scope`

### `POST /agent/start`

Starts a new interview session.

Required body fields:

- `session_id`
- `resume_text`
- `jd_text`

Optional body fields:

- `candidate_profile`
- `job_profile`
- `llm_config`

Important constraints:

- Reusing an existing `session_id` returns `status=error`.
- If `candidate_profile` and `job_profile` are provided, parsing can be skipped by the graph.

### `POST /agent/answer`

Submits one candidate answer for the active question.

Required body fields:

- `session_id`
- `user_answer`

Important constraints:

- Unknown `session_id` returns `status=error`.
- Calling this while the session is waiting for human review returns `status=error`.
- Calling this after `finish` returns `status=error`.
- On success, `partial_eval` contains the latest answer evaluation when available.

### `POST /agent/review`

Submits the human review decision and resumes final report generation.

Required body fields:

- `session_id`
- `approved`

Optional body fields:

- `comments`

Important constraints:

- Unknown `session_id` returns `status=error`.
- Calling this before `wait_for_review` returns `status=error`.
- If `approved=false`, `comments` must be non-empty.

### `GET /agent/status?session_id=...`

Returns:

- `summary`: integration-facing summary, ready only after `finish`
- `response`: current `AgentResponse`
- `state_snapshot`: graph checkpoint counters and next nodes

## LLM Override

`POST /agent/start`, `POST /agent/answer`, and `POST /agent/review` accept optional `llm_config`:

```json
{
  "provider": "openai",
  "model": "gpt-4o-mini",
  "api_key": "optional override",
  "base_url": "optional override"
}
```

If `api_key` or `base_url` are omitted, provider-specific environment variables are used.
