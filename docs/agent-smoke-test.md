# Agent Smoke Test

Use this file to verify the FastAPI gateway and the RecruitPro integration path step by step.

## 1. Start the Agent Gateway

```powershell
cd D:\project\agent\recruitment-agent
.\.venv\Scripts\python.exe -m uvicorn src.main:app --host 127.0.0.1 --port 8000
```

## 2. Health Check

```powershell
curl http://127.0.0.1:8000/healthz
```

Expected:

```json
{"ok":"true"}
```

## 3. Start Interview

```powershell
$headers = @{
  "x-agent-secret" = "replace-with-a-long-random-secret"
  "Content-Type" = "application/json"
}

$body = @'
{
  "session_id": "smoke-session-1",
  "resume_text": "Candidate with Python, distributed systems, and backend architecture experience.",
  "jd_text": "Need backend engineer with Python, architecture, and reliability skills."
}
'@

Invoke-RestMethod -Method Post -Uri "http://127.0.0.1:8000/agent/start" -Headers $headers -Body $body
```

Expected:

- `status = "ask"`
- `message` contains the first interview question

## 4. Submit Answer

```powershell
$body = @'
{
  "session_id": "smoke-session-1",
  "user_answer": "I used Python multiprocessing, async IO, and metrics-based tuning for a high traffic pipeline."
}
'@

Invoke-RestMethod -Method Post -Uri "http://127.0.0.1:8000/agent/answer" -Headers $headers -Body $body
```

Expected:

- `status = "ask"` while more questions remain
- `state_snapshot.asked_question_count` increases when the agent advances to the next planned question

## 5. Poll Status

```powershell
Invoke-RestMethod -Method Get -Uri "http://127.0.0.1:8000/agent/status?session_id=smoke-session-1" -Headers @{ "x-agent-secret" = "replace-with-a-long-random-secret" }
```

Expected:

- `response.status = "ask"` or `wait_for_review`
- `summary.ready = false` until the final report exists

## 6. Human Review

Only call this after the agent reaches `wait_for_review`.

```powershell
$body = @'
{
  "session_id": "smoke-session-1",
  "approved": true,
  "comments": "manual smoke review"
}
'@

Invoke-RestMethod -Method Post -Uri "http://127.0.0.1:8000/agent/review" -Headers $headers -Body $body
```

Expected:

- `status = "finish"`
- `final_report.overall_score` is present
- `final_report.hire_recommendation` is present

## 7. RecruitPro Edge Function Path

After the FastAPI gateway is running and Supabase secrets are set:

1. `interview-prepare`
2. `interview-start`
3. `interview-turn`
4. `interview-finish`
5. `interview-score`
6. If needed: `interview-human-confirm`

## Notes

- In `AGENT_MODE=dev` without a real API key, the gateway uses mock outputs.
- Console output on Windows PowerShell may display Chinese text with encoding artifacts. The HTTP contract still works.
