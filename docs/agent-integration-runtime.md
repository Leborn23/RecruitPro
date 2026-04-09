# Agent Integration Runtime

RecruitPro now calls the Python interview agent through a FastAPI gateway instead of generating AI questions and scores inside the Deno edge runtime.

## Changed Edge Functions

- `interview-start`
- `interview-turn`
- `interview-score`
- `interview-human-confirm`

Shared gateway client:

- `supabase/functions/_shared/agentGateway.ts`

## Required Secrets

Set these for Supabase Edge Functions:

```text
AGENT_BASE_URL=http://<agent-host>:8000
AGENT_SHARED_SECRET=<same-secret-as-agent>
AGENT_TIMEOUT_MS=20000
```

Example:

```powershell
npx supabase secrets set AGENT_BASE_URL=http://127.0.0.1:8000
npx supabase secrets set AGENT_SHARED_SECRET=replace-with-a-long-random-secret
npx supabase secrets set AGENT_TIMEOUT_MS=20000
```

## Deploy Functions

```powershell
npx supabase functions deploy interview-start
npx supabase functions deploy interview-turn
npx supabase functions deploy interview-score
npx supabase functions deploy interview-human-confirm
```

If not already deployed:

```powershell
npx supabase functions deploy interview-prepare
npx supabase functions deploy interview-finish
npx supabase functions deploy interview-room-password
```

## Local Verification Order

1. Start the agent gateway.
2. Verify `GET /healthz`.
3. Run `interview-prepare`.
4. Run `interview-start`.
5. Submit one or more `interview-turn` requests.
6. Run `interview-finish`.
7. Run `interview-score`.
8. If score returns `pending_human_review=true`, call `interview-human-confirm` and then re-check the report in `interview_reports`.

## Notes

- `session_id` is used as the agent `thread_id`.
- `interview-start` builds `resume_text` from parsed resume data and `jd_text` from parsed job requirements.
- `interview-score` now writes a pending report when the agent is waiting for human review.
- Final report fields are mapped back into `interview_reports`.
