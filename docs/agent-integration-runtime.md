# Agent Integration Runtime

RecruitPro no longer uses Supabase Edge Functions for interview agent orchestration.

Current chain:

- frontend -> FastAPI
- FastAPI -> external agent service
- FastAPI -> Supabase tables/storage

## Required backend env

```text
AGENT_BASE_URL=http://<agent-host>:8000
AGENT_SHARED_SECRET=<same-secret-as-agent>
AGENT_TIMEOUT_MS=20000
```

Example:

```powershell
$env:AGENT_BASE_URL="http://127.0.0.1:8000"
$env:AGENT_SHARED_SECRET="replace-with-a-long-random-secret"
$env:AGENT_TIMEOUT_MS="20000"
```

## Local verification order

1. Start FastAPI on `http://127.0.0.1:8010`
2. Start the external agent service on `AGENT_BASE_URL`
3. Verify `GET /api/health`
4. Start one interview from the web app
5. Submit one or more interview turns
6. Finish scoring and verify `interview_reports`

## Notes

- `session_id` is still used as the agent thread key
- final agent report fields are mapped back into `interview_reports`
- the old `supabase/functions` implementation has been removed from the active path
