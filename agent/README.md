# HireGraph AI Interview Agent

[中文版本](#中文版本) | [English Version](#english-version)

---

## 中文版本

HireGraph 是一个基于 `LangGraph` 的技术面试 Agent。它会读取简历和 JD，完成解析、审计、差距分析、面试规划、逐题提问、逐题评分、人审确认和最终报告生成。

### 从哪里开始

- 终端入口：`scripts/interactive_interview.py`
- API 入口：`src/main.py`
- 展示入口：`src/showcase/app.py`
- 中文学习指南：`docs/LEARNING_PATH_CN.md`

### 核心链路

```text
parse resume/JD
  -> audit/research (optional)
  -> gap analysis
  -> interview plan
  -> ask question
  -> evaluate answer
  -> human review
  -> final report
```

### 核心能力

1. 工作流编排
- 解析简历和 JD
- 风险审计与差距分析
- 生成面试计划
- 提问、追问、澄清和评分
- 人审后生成最终报告

2. 结构化输出
- 关键中间结果都通过 `Pydantic` schema 校验
- 降低字段漂移和 JSON 解析失败

3. 可恢复会话
- 默认使用内存 checkpoint
- 可切换 SQLite checkpoint，让会话在同一主机重启后继续

4. LangSmith 追踪
- 支持节点级 tracing
- 支持 `thread_id` / `session_id` 串联整场面试

### 项目结构

```text
recruitment-agent/
├─ src/
│  ├─ main.py
│  ├─ showcase/app.py
│  └─ agent/
│     ├─ graph.py
│     ├─ state.py
│     ├─ schemas.py
│     ├─ runtime.py
│     ├─ nodes/
│     ├─ prompts/
│     └─ tools/
├─ scripts/
│  └─ interactive_interview.py
├─ docs/
│  ├─ LEARNING_PATH_CN.md
│  ├─ FASTAPI_GATEWAY_SETUP.md
│  └─ DOCKER_DEPLOY.md
├─ tests/
├─ .env.example
├─ requirements.txt
└─ README.md
```

### 快速开始

```bash
python -m venv .venv
# Windows:
.venv\Scripts\activate
pip install -r requirements.txt
python scripts/interactive_interview.py
```

配置 `.env`：

```env
AGENT_MODE=demo
LLM_PROVIDER=openai
LLM_MODEL=gpt-4o-mini
API_KEY=your_key
BASE_URL=https://api.openai.com/v1

LANGSMITH_TRACING=true
LANGSMITH_API_KEY=your_langsmith_key
LANGSMITH_PROJECT=hiregraph
```

运行 API：

```bash
uvicorn src.main:app --host 0.0.0.0 --port 8000
```

### 运行时配置

```env
INTERVIEW_MIN_QUESTIONS=3
INTERVIEW_MAX_QUESTIONS=5

AGENT_CHECKPOINT_BACKEND=memory

# 使用 SQLite 持久化时：
AGENT_CHECKPOINT_BACKEND=sqlite
AGENT_CHECKPOINT_SQLITE_PATH=artifacts/checkpoints/interview.sqlite
```

注意：SQLite checkpoint 需要安装 `langgraph-checkpoint-sqlite>=3.0.3`。如果默认镜像源失败，可临时使用官方源：

```bash
pip install langgraph-checkpoint-sqlite>=3.0.3 -i https://pypi.org/simple
```

### 常见问题

1. 首题前较慢  
   系统会先经过解析、审计、差距分析和面试计划生成。

2. 终端中文显示异常  
   建议使用 UTF-8 终端。

3. SQLite checkpoint 不可用  
   检查 `langgraph-checkpoint-sqlite` 是否真的安装到了当前虚拟环境。

4. LangSmith 没有 trace  
   检查 `.env` 是否在 Agent 初始化前加载，并确认 `LANGSMITH_TRACING`、`LANGSMITH_API_KEY`、`LANGSMITH_PROJECT`。

---

## English Version

HireGraph is a `LangGraph`-based technical interview agent. It parses resume and JD text, performs audit and gap analysis, generates an interview plan, asks questions, scores answers, waits for human review, and then produces a final hiring report.

### Where To Start

- CLI entry: `scripts/interactive_interview.py`
- API entry: `src/main.py`
- UI entry: `src/showcase/app.py`
- Chinese learning guide: `docs/LEARNING_PATH_CN.md`
- API contract: `docs/API_CONTRACT.md`

### Workflow

```text
parse resume/JD
  -> audit/research (optional)
  -> gap analysis
  -> interview plan
  -> ask question
  -> evaluate answer
  -> human review
  -> final report
```

### Key Features

1. Workflow orchestration
- resume and JD parsing
- audit and gap analysis
- interview planning
- ask, follow-up, clarify, evaluate
- final report after human review

2. Structured contracts
- critical outputs are validated by `Pydantic`
- reduces output drift and JSON parsing failures

3. Recoverable sessions
- in-memory checkpointing by default
- optional SQLite checkpointing for same-host restart recovery

4. LangSmith tracing
- node-level tracing
- `thread_id` / `session_id` linkage across one interview session

### Quick Start

```bash
python -m venv .venv
# Windows:
.venv\Scripts\activate
pip install -r requirements.txt
python scripts/interactive_interview.py
```

Run the API:

```bash
uvicorn src.main:app --host 0.0.0.0 --port 8000
```

Run tests:

```bash
pytest
```

Optional real-provider smoke test:

```bash
set RUN_REAL_LLM_SMOKE=1
set AGENT_MODE=demo
set LLM_PROVIDER=openai
set OPENAI_API_KEY=sk-...
pytest tests/conformance/test_real_llm_smoke.py -m real_llm
```

The smoke test is skipped by default so normal local and CI runs do not call external LLM APIs.

### Runtime Configuration

```env
INTERVIEW_MIN_QUESTIONS=3
INTERVIEW_MAX_QUESTIONS=5

AGENT_CHECKPOINT_BACKEND=memory

# SQLite persistence:
AGENT_CHECKPOINT_BACKEND=sqlite
AGENT_CHECKPOINT_SQLITE_PATH=artifacts/checkpoints/interview.sqlite
```

SQLite checkpointing requires `langgraph-checkpoint-sqlite>=3.0.3`.
