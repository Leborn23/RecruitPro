"""
MCP-Friendly Base Tool Abstraction
Responsibility: Provide a typed bridge for tools so they can be exported natively as MCP JSON-RPC schemas
or consumed directly by LangGraph / LangChain systems.
"""
from pydantic import BaseModel, ConfigDict
from typing import Type, Callable, Any, Dict

class ToolResponse(BaseModel):
    """Normalized response contract to prevent untyped exceptions crashing the graph."""
    # 所有工具都返回 success/data/error，调用方无需猜返回结构。
    success: bool
    data: Any = None
    error: str | None = None

class AgentTool:
    """
    Abstration unifying tool interfaces.
    Makes it easy to register in an MCP Server (via stdio or SSE) later by extracting
    `name`, `description`, and `input_schema.model_json_schema()`.
    """
    def __init__(
        self,
        name: str,
        description: str,
        input_schema: Type[BaseModel],
        handler: Callable[[Any], ToolResponse]
    ):
        self.name = name
        self.description = description
        self.input_schema = input_schema
        self.handler = handler

    def invoke(self, args_dict: Dict[str, Any]) -> ToolResponse:
        """Executes the tool with robust error boundary catching mapping JSON input."""
        try:
            # 先用 pydantic 校验入参，避免工具内部手写 if/else 做参数检查。
            validated_args = self.input_schema.model_validate(args_dict)
            return self.handler(validated_args)
        except Exception as e:
            # 工具异常不向上抛，避免打断主流程图。
            return ToolResponse(success=False, error=str(e))
            
    def as_mcp_descriptor(self) -> Dict[str, Any]:
        """Provides the raw dict mapping to MCP Tool registration schema."""
        return {
            "name": self.name,
            "description": self.description,
            "inputSchema": self.input_schema.model_json_schema()
        }
        
    def to_langchain_tool(self):
        """Builds and returns a native LangChain StructuredTool for direct usage in graphs."""
        # 这层适配让同一个工具既能用于 MCP，也能用于 LangChain Tool Calling。
        from langchain_core.tools import StructuredTool
        return StructuredTool.from_function(
            func=self.handler,
            name=self.name,
            description=self.description,
            args_schema=self.input_schema
        )
