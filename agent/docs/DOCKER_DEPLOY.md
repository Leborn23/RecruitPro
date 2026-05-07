# Docker Deploy

This project is ready to run as a Dockerized FastAPI service.

## Build

```bash
docker build -t recruitment-agent .
```

## Run

```bash
docker run --rm -p 8000:8000 \
  -e PORT=8000 \
  -e AGENT_MODE=dev \
  -e AGENT_CHECKPOINT_BACKEND=memory \
  recruitment-agent
```

## Health Check

```bash
curl http://127.0.0.1:8000/healthz
```

Expected response:

```json
{"ok":"true"}
```

## Runtime Notes

- The container listens on `PORT`, defaulting to `8000`.
- The Docker image runs Uvicorn with one worker by default.
- If you use `AGENT_CHECKPOINT_BACKEND=sqlite`, keep `AGENT_WORKER_COUNT=1` unless you add a cross-process lock/checkpoint backend.
- For production, set `AGENT_SHARED_SECRET` and provider-specific LLM credentials.
