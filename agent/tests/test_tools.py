import json
import os
from src.agent.tools.loaders import load_resume_text_tool
from src.agent.tools.exporters import save_json_artifact_tool

def test_loader_missing_file():
    res = load_resume_text_tool.invoke({"file_path": "non_existent.txt"})
    assert res.success is False
    assert "not found" in res.error

def test_save_json_artifact(tmp_path):
    out_file = tmp_path / "test_artifact.json"
    dummy_data = {"profile": "Alice"}
    
    res = save_json_artifact_tool.invoke({
        "file_path": str(out_file),
        "json_data": json.dumps(dummy_data)
    })
    
    assert res.success is True
    assert out_file.exists()
    
    with open(out_file, "r") as f:
        loaded = json.load(f)
        assert loaded["profile"] == "Alice"

def test_mcp_schema_generation():
    schema = save_json_artifact_tool.as_mcp_descriptor()
    assert schema["name"] == "save_json_artifact"
    assert "inputSchema" in schema
    assert "json_data" in schema["inputSchema"]["properties"]

def test_langchain_tool_bridge():
    lc_tool = save_json_artifact_tool.to_langchain_tool()
    assert lc_tool.name == "save_json_artifact"
    assert lc_tool.args_schema is not None
