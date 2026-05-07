import ast
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[1]


def test_agent_runtime_code_uses_logging_instead_of_print() -> None:
    offenders: list[str] = []
    for path in (PROJECT_ROOT / "src" / "agent").rglob("*.py"):
        tree = ast.parse(path.read_text(encoding="utf-8-sig"), filename=str(path))
        for node in ast.walk(tree):
            if isinstance(node, ast.Call) and isinstance(node.func, ast.Name) and node.func.id == "print":
                rel_path = path.relative_to(PROJECT_ROOT).as_posix()
                offenders.append(f"{rel_path}:{node.lineno}")

    assert not offenders, "Use logging instead of print in src/agent: " + ", ".join(offenders)
