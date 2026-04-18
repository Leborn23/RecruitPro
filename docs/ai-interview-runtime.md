# AI Interview Runtime

RecruitPro now uses FastAPI as the business backend for the full AI interview flow.

## Current flow

- frontend -> FastAPI
- FastAPI -> external agent
- FastAPI -> Supabase tables

## Required services

1. FastAPI backend on `http://127.0.0.1:8010`
2. external agent service on `AGENT_BASE_URL`

## Required database migration

Run:

- `supabase/migrations/202604020017_ai_interview_runtime.sql`

It creates:

- interview status fields in `upcoming_interviews`
- `interview_sessions`
- `interview_turns`
- `interview_reports`

## Core FastAPI endpoints

- `POST /api/interviews/prepare`
- `POST /api/interviews/start`
- `POST /api/interviews/turn`
- `POST /api/interviews/finish`
- `POST /api/interviews/score`
- `POST /api/interviews/human-confirm`
- `POST /api/interviews/room-password`

## Frontend integration

Use:

- [src/lib/interviewRuntime.ts](D:/project/RecruitPro_/src/lib/interviewRuntime.ts)
