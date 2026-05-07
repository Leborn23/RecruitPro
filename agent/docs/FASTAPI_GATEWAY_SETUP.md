# FastAPI Gateway Setup

This repository now exposes the interview agent through a FastAPI gateway so that external systems can call the runtime over HTTP.

## Install

Use the project virtual environment on Windows:

```powershell
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
```

If the environment already exists and you only need the gateway packages:

```powershell
.\.venv\Scripts\python.exe -m pip install fastapi "uvicorn[standard]"
```

## Required Environment Variables

Set these in `.env` or the process environment:

```env
AGENT_SHARED_SECRET=replace-with-a-long-random-secret
AGENT_GATEWAY_HOST=0.0.0.0
AGENT_GATEWAY_PORT=8000
AGENT_MODE=dev
LLM_PROVIDER=openai
OPENAI_API_KEY=...
```

## Start the Gateway

```powershell
.\.venv\Scripts\python.exe -m uvicorn src.main:app --host 0.0.0.0 --port 8000
```

## Health Check

```powershell
curl http://127.0.0.1:8000/healthz
```

Expected response:

```json
{"ok":"true"}
```

## Endpoints

- `POST /agent/start`
- `POST /agent/answer`
- `POST /agent/review`
- `GET /agent/status`
- `GET /agent/runtime-config`

Each request should include header:

```text
x-agent-secret: <AGENT_SHARED_SECRET>
```

See `docs/API_CONTRACT.md` for request/response shapes, state transitions, and invalid-action error rules.
