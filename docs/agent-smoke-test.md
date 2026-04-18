# Agent Smoke Test

Use this file to verify the external agent and the RecruitPro FastAPI integration path.

## 1. Start the agent service

```powershell
cd D:\project\agent\recruitment-agent
.\.venv\Scripts\python.exe -m uvicorn src.main:app --host 127.0.0.1 --port 8000
```

## 2. Start RecruitPro FastAPI

```powershell
cd D:\project\RecruitPro_\backend
.\.venv\Scripts\python.exe -m uvicorn main:app --host 127.0.0.1 --port 8010 --reload
```

## 3. Agent health check

```powershell
curl http://127.0.0.1:8000/healthz
```

## 4. RecruitPro backend health check

```powershell
curl http://127.0.0.1:8010/api/health
```

## 5. Web verification order

1. Start one interview from the web app
2. Enter at least one candidate answer
3. Finish the interview
4. Trigger scoring
5. If needed, execute human confirmation

## Notes

- in `AGENT_MODE=dev`, the agent may return mock outputs
