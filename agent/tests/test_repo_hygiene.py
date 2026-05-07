from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[1]


def test_gitignore_covers_generated_python_and_runtime_artifacts() -> None:
    gitignore = (PROJECT_ROOT / ".gitignore").read_text(encoding="utf-8")
    required_patterns = {
        "__pycache__/",
        "*.py[cod]",
        ".pytest_cache/",
        "*.egg-info/",
        "build/",
        "dist/",
        ".coverage",
        "artifacts/",
        "*.sqlite",
        "test_outputs/",
        ".env",
        "!.env.example",
    }

    missing = sorted(pattern for pattern in required_patterns if pattern not in gitignore)

    assert not missing, "Missing generated-artifact ignore patterns: " + ", ".join(missing)
