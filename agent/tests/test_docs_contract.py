from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[1]


def test_api_contract_doc_is_linked_from_entry_docs() -> None:
    contract_path = PROJECT_ROOT / "docs" / "API_CONTRACT.md"
    readme = (PROJECT_ROOT / "README.md").read_text(encoding="utf-8")
    fastapi_setup = (PROJECT_ROOT / "docs" / "FASTAPI_GATEWAY_SETUP.md").read_text(encoding="utf-8")

    assert contract_path.exists()
    assert "docs/API_CONTRACT.md" in readme
    assert "docs/API_CONTRACT.md" in fastapi_setup


def test_api_contract_documents_all_runtime_statuses() -> None:
    contract = (PROJECT_ROOT / "docs" / "API_CONTRACT.md").read_text(encoding="utf-8")

    for status in ("ask", "wait_for_review", "finish", "error"):
        assert f"`{status}`" in contract

    for endpoint in (
        "POST /agent/start",
        "POST /agent/answer",
        "POST /agent/review",
        "GET /agent/status",
        "GET /agent/runtime-config",
    ):
        assert endpoint in contract
