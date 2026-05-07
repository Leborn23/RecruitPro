"""
Web Search Tool Definition
Responsibility: Defines the search tool in OpenAI Function Calling format,
and provides the executor that actually performs the search.
"""
import json
import urllib.request
import urllib.parse

# OpenAI Function Calling 协议下的工具声明。
# LLM 看到这个 schema 后，才能发出结构化 tool call。
SEARCH_TOOL_DEFINITION = {
    "type": "function",
    "function": {
        "name": "search_web",
        "description": "Search the internet for real-time information about a technology, company, person, or concept. Use this when you encounter unfamiliar terms or need to verify factual claims.",
        "parameters": {
            "type": "object",
            "properties": {
                "query": {
                    "type": "string",
                    "description": "The search query string. Be specific, e.g. 'FastAPI framework release date' or 'Company XYZ tech stack'."
                }
            },
            "required": ["query"]
        }
    }
}

def execute_web_search(query: str) -> str:
    """
    Performs a lightweight web search using DuckDuckGo Instant Answers API.
    Returns a summary string. Falls back gracefully on errors.
    """
    try:
        # 对 query 做 URL 编码，避免中文/空格导致请求失败。
        encoded_query = urllib.parse.quote_plus(query)
        url = f"https://api.duckduckgo.com/?q={encoded_query}&format=json&no_html=1&skip_disambig=1"
        
        req = urllib.request.Request(url, headers={"User-Agent": "HireGraph/1.0"})
        with urllib.request.urlopen(req, timeout=5) as response:
            data = json.loads(response.read().decode())
        
        # 提取最有用的字段：摘要、直接答案、相关主题。
        abstract = data.get("AbstractText", "")
        answer = data.get("Answer", "")
        related = [t.get("Text", "") for t in data.get("RelatedTopics", [])[:3] if isinstance(t, dict)]
        
        result_parts = []
        if abstract:
            result_parts.append(f"Summary: {abstract}")
        if answer:
            result_parts.append(f"Direct Answer: {answer}")
        if related:
            result_parts.append("Related: " + " | ".join(related))
        
        if result_parts:
            return "\n".join(result_parts)
        else:
            return f"No detailed results found for '{query}'. The term may be too niche or newly coined."
            
    except Exception as e:
        return f"Search failed for '{query}': {str(e)}"


def tool_executor(func_name: str, func_args_json: str | dict) -> str:
    """
    Universal tool executor. Routes function calls to their implementations.
    This is passed to invoke_with_tools as the callback.
    """
    # 目前只接入 search_web，一个入口便于后续扩展更多工具。
    if func_name == "search_web":
        if isinstance(func_args_json, str):
            args = json.loads(func_args_json)
        elif isinstance(func_args_json, dict):
            args = func_args_json
        else:
            args = {}
        query = args.get("query", "")
        return execute_web_search(query)
    
    return f"Unknown tool: {func_name}"
