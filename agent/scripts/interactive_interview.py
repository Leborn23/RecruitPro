import json
import os
import sys
import time
import warnings
import zipfile
from pathlib import Path
from xml.etree import ElementTree

from dotenv import load_dotenv

ROOT_DIR = Path(__file__).resolve().parents[1]
# 入口脚本最先加载 .env，避免 provider 在 import 阶段拿到旧配置。
load_dotenv(dotenv_path=ROOT_DIR / ".env", override=True)

warnings.filterwarnings("ignore", message="Deserializing unregistered type")
sys.path.append(os.getcwd())

from src.agent.api_schemas import AgentActionType
from src.agent.langsmith_utils import is_langsmith_tracing_enabled
from src.agent.runtime import InterviewAgentRuntime


def clear_input_buffer() -> None:
    if sys.platform == "win32":
        import msvcrt

        while msvcrt.kbhit():
            msvcrt.getch()


def _read_text_file(path: Path) -> str:
    for encoding in ("utf-8", "utf-8-sig", "gbk"):
        try:
            return path.read_text(encoding=encoding)
        except UnicodeDecodeError:
            continue
    raise UnicodeDecodeError("unknown", b"", 0, 1, f"Unable to decode file: {path}")


def _read_pdf_file(path: Path) -> str:
    import pypdf

    reader = pypdf.PdfReader(str(path))
    text_parts: list[str] = []
    for page in reader.pages:
        text_parts.append((page.extract_text() or "").strip())
    return "\n\n".join(part for part in text_parts if part).strip()


def _read_docx_file(path: Path) -> str:
    with zipfile.ZipFile(path, "r") as zf:
        xml_content = zf.read("word/document.xml")
    root = ElementTree.fromstring(xml_content)
    ns = {"w": "http://schemas.openxmlformats.org/wordprocessingml/2006/main"}
    paragraphs: list[str] = []
    for paragraph in root.findall(".//w:p", ns):
        texts = [t.text for t in paragraph.findall(".//w:t", ns) if t.text]
        if texts:
            paragraphs.append("".join(texts))
    return "\n".join(paragraphs).strip()


def _read_json_file(path: Path) -> str:
    raw = _read_text_file(path)
    obj = json.loads(raw)
    return json.dumps(obj, ensure_ascii=False, indent=2)


def _read_file_content(path: Path) -> str:
    # 统一多格式读取，保证“路径输入”和“粘贴输入”走同一条后续链路。
    ext = path.suffix.lower()
    if ext in {".txt", ".md", ".markdown", ".log"}:
        return _read_text_file(path).strip()
    if ext == ".pdf":
        return _read_pdf_file(path)
    if ext == ".docx":
        return _read_docx_file(path)
    if ext == ".json":
        return _read_json_file(path)
    if ext in {".csv", ".tsv"}:
        return _read_text_file(path).strip()
    return _read_text_file(path).strip()


def _is_probable_file_path(text: str) -> bool:
    suffix = Path(text).suffix.lower()
    supported = {".txt", ".md", ".markdown", ".log", ".pdf", ".docx", ".json", ".csv", ".tsv"}
    has_drive = len(text) > 1 and text[1] == ":"
    has_sep = ("\\" in text) or ("/" in text)
    return suffix in supported and (has_drive or has_sep or text.startswith("."))


def read_input_content(raw_input: str | None) -> tuple[str | None, str | None]:
    if not raw_input:
        return None, None

    cleaned = (
        raw_input.strip()
        .strip('"')
        .strip("'")
        .replace("\ufeff", "")
        .replace("“", "")
        .replace("”", "")
    )
    if not cleaned:
        return None, None

    # 同时尝试原始路径和展开环境变量后的路径（如 %USERPROFILE%）。
    candidates = [Path(cleaned), Path(os.path.expandvars(cleaned))]
    for path in candidates:
        if not path.is_file():
            continue
        try:
            content = _read_file_content(path)
            if not content:
                return None, f"文件为空或无法提取文本: {path}"
            return content, None
        except Exception as exc:
            return None, f"读取文件失败 {path}: {exc}"

    # 看起来像文件路径但无法访问时，直接报错，不当作普通文本使用。
    if _is_probable_file_path(cleaned):
        return None, f"文件不存在或无法访问: {cleaned}"

    return cleaned, None


def run_interactive_interview() -> None:
    os.system("cls" if os.name == "nt" else "clear")
    print("\n" + "=" * 57)
    print("  HireGraph 3.0 - 真实环境实战 (Prod)")
    print("=" * 57)

    mode = os.getenv("AGENT_MODE", "dev")
    provider = os.getenv("LLM_PROVIDER", "openai")
    print(f"  当前模式: 【{mode.upper()}】 | 供应商: 【{provider.upper()}】")
    print("-" * 57 + "\n")

    print("初始化面试背景...")
    print("  支持输入: 直接粘贴文本 或 文件路径 (txt/md/pdf/docx/json/csv)")

    resume_input = input("简历: ").strip()
    resume_text, resume_err = read_input_content(resume_input)
    if resume_err:
        print(f"[WARN] 简历读取告警: {resume_err}")
    if not resume_text:
        resume_text = "候选人简历未提供"

    jd_input = input("JD: ").strip()
    jd_text, jd_err = read_input_content(jd_input)
    if jd_err:
        print(f"[WARN] JD 读取告警: {jd_err}")
    if not jd_text:
        jd_text = "岗位描述未提供"

    runtime = InterviewAgentRuntime()
    thread_id = f"real_run_{int(time.time())}"

    tracing_on = is_langsmith_tracing_enabled()
    project = os.getenv("LANGSMITH_PROJECT", "").strip() or "(default)"
    print(f"Session Thread ID: {thread_id}")
    print(f"LangSmith Tracing: {'ON' if tracing_on else 'OFF'} | Project: {project}")
    print("\n[系统] 正在调用 AI 进行深度分析并制定计划...")

    response = runtime.start_interview(resume_text, jd_text, thread_id=thread_id)
    while True:
        if response.status == AgentActionType.ERROR:
            print(f"\n[ERROR] {response.message}")
            break

        if response.status == AgentActionType.ASK:
            print("\n" + "-" * 54)
            print(f"[AI 面试官]: {response.message or '...'}")
            print("-" * 54)

            clear_input_buffer()
            user_answer = ""
            while not user_answer:
                user_answer = input("\n[你的回答] (输入 'q' 结束): ").strip()

            if user_answer.lower() in ["q", "quit"]:
                break

            print("\n[系统] 正在评估回答", end="", flush=True)
            response = runtime.submit_answer(thread_id, user_answer)
            print(". 完成")

            # 每题即时反馈：候选人能立刻看到分数和理由，减少“黑箱感”。
            last_eval = response.partial_eval
            if last_eval:
                if "clarification_needed" in (last_eval.missing_logic_elements or []):
                    print("\n[本题说明]")
                    print("- 已进入一次澄清重述轮，本轮不计入正式评分。")
                    print(f"- 说明: {last_eval.feedback}")
                    continue
                dims = last_eval.dimensions
                q_score = int(
                    (dims.technical_depth * 5)
                    + (dims.communication_logic * 3)
                    + (dims.problem_solving * 2)
                )
                print("\n[本题评分]")
                print(
                    f"- 分数: {q_score}/100 "
                    f"(技术:{dims.technical_depth}/10, 逻辑:{dims.communication_logic}/10, "
                    f"解决问题:{dims.problem_solving}/10)"
                )
                print(f"- 理由: {last_eval.feedback}")
            continue

        if response.status == AgentActionType.WAIT_FOR_REVIEW:
            response = runtime.submit_human_review(thread_id, approved=True, comments="Auto-approved by CLI demo.")
            continue

        if response.status == AgentActionType.FINISH:
            report = response.final_report
            if report:
                print("\n" + "=" * 50)
                print("最终评估报告")
                print("=" * 50)
                print(f"候选人: {report.candidate_name}")
                print(f"面试评分: {report.overall_score}/100")
                print(f"建议: {report.hire_recommendation.name}")
                print("-" * 50)
                print("优势亮点:")
                for strength in report.strengths:
                    src = f"(Q{strength.source_question_index + 1})" if strength.source_question_index >= 0 else ""
                    print(f"  - {strength.claim} {src}")
                print("\n待提升项:")
                for weakness in report.weaknesses:
                    src = f"(Q{weakness.source_question_index + 1})" if weakness.source_question_index >= 0 else ""
                    print(f"  - {weakness.claim} {src}")
                print("\n逐题评分明细:")
                for i, item in enumerate(report.detailed_evaluations, start=1):
                    dims = item.dimensions
                    q_score = int(
                        (dims.technical_depth * 5)
                        + (dims.communication_logic * 3)
                        + (dims.problem_solving * 2)
                    )
                    print(
                        f"  Q{i}: {q_score}/100 "
                        f"(技术:{dims.technical_depth}, 逻辑:{dims.communication_logic}, 解题:{dims.problem_solving})"
                    )
                    print(f"      理由: {item.feedback}")
                print("=" * 50 + "\n")
            break

        break

    print("测试完毕。")


if __name__ == "__main__":
    run_interactive_interview()
