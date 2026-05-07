# 阶段 9：案例设计方案与目录规划 (Demo Dataset & Golden Cases)

## 1. 案例体系设计
本阶段将构建 3 套核心案例 + 2 套边缘案例，覆盖从“精英”到“风险”的完整候选人图谱。

| 案例 ID | 名称 | 核心考察点 | 预期结论 | 简历演示价值 |
|---|---|---|---|---|
| **expert_rag** | RAG 架构专家 | 深度检索、向量数据库优化、Ragas 评测。 | Strong Hire | 展示 Agent 处理高专业度对话的能力。 |
| **generalist_python** | 后端转 AI 开发 | Python 功底扎实，但对 LangGraph 状态机理解尚浅。 | Lean Hire | 测试 Agent 在考察“成长性”与“技能缺口”时的精准度。 |
| **risk_inconsistent** | 简历造假/常识风险 | 声称“5年 GPT-4 经验”，技术指标严重破产。 | No Hire / Human Review | 证明 Agent 具备事实校验（Fact-checking）与风险识别的硬核防御。 |

## 2. 目录结构
```text
data/cases/
├── expert_rag/
│   ├── jd.txt
│   ├── resume.txt
│   └── golden_config.json (包含预期得分、考察重点、标准答案)
├── generalist_python/
│   ├── jd.txt
│   ├── resume.txt
│   └── golden_config.json
├── risk_inconsistent/
│   ├── jd.txt
│   ├── resume.txt
│   └── golden_config.json
└── edge_cases/
    ├── junior_overachiever.txt
    └── keyword_stuffer.txt
```

## 3. 验证与演示 (Demo/Eval)
- **Demo**: 通过 `scripts/main.py --case expert_rag` 快速加载。
- **Eval**: `evals/evaluator.py` 将对比 `golden_config.json` 中的 `expected_fit_score` 与模型实际输出，计算真实偏差（MSE/Accuracy）。

---
**方案已就绪，现在开始生成具体的样例数据文件。**
