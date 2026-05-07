"""
Loaders: Tools to safely read from generic data sources (mock files, databases, or MCP endpoints).
"""
import os
from pydantic import BaseModel, Field
from src.agent.tools.mcp_base import AgentTool, ToolResponse

class LoadFileInput(BaseModel):
    file_path: str = Field(description="The absolute or relative path to the requested file.")

def _safe_read_file(args: LoadFileInput) -> ToolResponse:
    # 统一文件读取入口：先做存在性检查，再尝试 UTF-8 读取。
    if not os.path.exists(args.file_path):
        return ToolResponse(success=False, error=f"File not found: {args.file_path}")
    
    try:
        with open(args.file_path, "r", encoding="utf-8") as f:
            content = f.read()
        return ToolResponse(success=True, data=content)
    except Exception as e:
        return ToolResponse(success=False, error=f"Read failure: {str(e)}")

# Tool 1: 读取简历文本
load_resume_text_tool = AgentTool(
    name="load_resume_text",
    description="Loads the candidate's raw text resume from the local filesystem or configured storage.",
    input_schema=LoadFileInput,
    handler=_safe_read_file
)

# Tool 2: 读取 JD 文本
load_jd_text_tool = AgentTool(
    name="load_jd_text",
    description="Loads the Job Description text requirements for structural parsing.",
    input_schema=LoadFileInput,
    handler=_safe_read_file
)

# Tool 4: 读取评分 Rubric（如企业内部评分细则）
load_scoring_rubric_tool = AgentTool(
    name="load_scoring_rubric",
    description="Loads organizational specific scoring rubrics or culture guidelines to inject into Eval prompts.",
    input_schema=LoadFileInput,
    handler=_safe_read_file
)
