"""
Exporters: Tools responsible for flushing state to the external world reliably.
"""
import json
import os
from pydantic import BaseModel, Field
from src.agent.tools.mcp_base import AgentTool, ToolResponse

class SaveJsonArtifactInput(BaseModel):
    file_path: str = Field(description="Target destination path.")
    json_data: str = Field(description="Serialized JSON string data to write.")

def _save_artifact(args: SaveJsonArtifactInput) -> ToolResponse:
    try:
        # 先确保目标目录存在，再执行写入。
        os.makedirs(os.path.dirname(args.file_path), exist_ok=True)
        with open(args.file_path, "w", encoding="utf-8") as f:
            # 先反序列化再写回，确保输入确实是合法 JSON。
            parsed = json.loads(args.json_data)
            json.dump(parsed, f, indent=4, ensure_ascii=False)
        return ToolResponse(success=True, data=f"Artifact saved to {args.file_path}")
    except Exception as e:
        return ToolResponse(success=False, error=str(e))

# Tool 3: save_json_artifact
save_json_artifact_tool = AgentTool(
    name="save_json_artifact",
    description="Saves generic JSON outputs into a centralized logging/artifact directory.",
    input_schema=SaveJsonArtifactInput,
    handler=_save_artifact
)

class ExportReportInput(BaseModel):
    file_path: str = Field(description="Target export filepath (e.g. final_report.txt)")
    markdown_content: str = Field(description="The formatted report.")

def _export_report(args: ExportReportInput) -> ToolResponse:
    try:
        # 报告导出是纯文本写入，不做 JSON 校验。
        os.makedirs(os.path.dirname(args.file_path), exist_ok=True)
        with open(args.file_path, "w", encoding="utf-8") as f:
            f.write(args.markdown_content)
        return ToolResponse(success=True, data="Final report exported.")
    except Exception as e:
        return ToolResponse(success=False, error=str(e))

# Tool 5: export_transcript
export_transcript_tool = AgentTool(
    name="export_transcript",
    description="Dumps the current interview QA messages string to a textual file.",
    input_schema=ExportReportInput,
    handler=_export_report
)

# Tool 6: export_report
export_report_tool = AgentTool(
    name="export_report",
    description="Renders and writes the structured FinalInterviewReport to a disk or external DB interface.",
    input_schema=ExportReportInput,
    handler=_export_report
)
