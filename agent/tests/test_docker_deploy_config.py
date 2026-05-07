from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[1]


def test_dockerfile_uses_platform_port_and_single_worker() -> None:
    dockerfile = (PROJECT_ROOT / "Dockerfile").read_text(encoding="utf-8")

    assert "ENV PORT=8000" in dockerfile
    assert "--port ${PORT}" in dockerfile
    assert "--workers 1" in dockerfile
    assert "${PORT:-8000}" not in dockerfile


def test_docker_deploy_doc_exists() -> None:
    doc = (PROJECT_ROOT / "docs" / "DOCKER_DEPLOY.md").read_text(encoding="utf-8")

    assert "docker build" in doc
    assert "/healthz" in doc
