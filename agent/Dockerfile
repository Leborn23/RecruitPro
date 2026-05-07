FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1
ENV AGENT_GATEWAY_HOST=0.0.0.0
ENV AGENT_GATEWAY_PORT=8000
ENV AGENT_WORKER_COUNT=1
ENV PORT=8000

WORKDIR /app

COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY src ./src
COPY README.md pyproject.toml ./

RUN mkdir -p /app/artifacts/checkpoints

EXPOSE 8000

CMD python -m uvicorn src.main:app --host 0.0.0.0 --port ${PORT} --workers 1
