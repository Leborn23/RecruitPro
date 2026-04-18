# FastAPI backend

This service is now the primary backend entry for RecruitPro business flows.

## Run

```bash
cd backend
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
uvicorn main:app --host 127.0.0.1 --port 8010 --reload
```

## Required env

The backend loads variables from:

1. `backend/.env`
2. repo root `.env.local`

At minimum you need:

- `SUPABASE_URL` or `VITE_SUPABASE_URL`
- `SUPABASE_ANON_KEY` or `VITE_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `AGENT_BASE_URL`

## Current scope

FastAPI now owns:

- interview scheduling, sessions, turns, reports, scoring and human confirmation
- screening dashboard, upload lifecycle, phase1 execution and historical rescreen
- positions, candidates, dashboard, salary and settings business endpoints
- admin permission management
- llm usage event writes

Supabase remains in use for:

- Auth
- Postgres / Storage
- client session token retrieval on the frontend
