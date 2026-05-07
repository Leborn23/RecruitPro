# HireGraph 学习路径

这份文档面向刚接触 Python、LangGraph 和 Agent 工程的学习者。目标不是一次读完全部代码，而是按主线逐步建立整体理解。

## 1. 先建立全局认识

先看这几个文件：

- `README.md`
- `src/agent/graph.py`
- `src/agent/state.py`

先回答三个问题：

1. 这个项目解决什么问题？
2. 它的流程顺序是什么？
3. 它靠什么状态把整场面试串起来？

如果这一步没看懂，不要急着钻节点细节。

## 2. 先跑一遍系统

建议先用终端入口：

```bash
python scripts/interactive_interview.py
```

观察这条主链路：

1. 读取简历和 JD
2. 解析候选人和岗位画像
3. 做风险审计
4. 做 gap analysis
5. 生成 interview plan
6. 提问
7. 评分
8. 等待人审
9. 生成 final report

先把运行结果和屏幕输出看懂，后面读代码才有锚点。

## 3. 看状态机

优先阅读：

- `src/agent/graph.py`
- `src/agent/state.py`
- `src/agent/runtime.py`

重点理解：

- `InterviewState` 里有哪些字段
- 每个字段由哪个节点写入
- 图如何决定下一步走向
- `thread_id` 为什么能让会话恢复

建议边看边画一个最简流程：

```text
parse -> audit/research -> plan -> interview -> human review -> final
```

## 4. 看核心节点

最值得先读的节点：

- `src/agent/nodes/parser.py`
- `src/agent/nodes/planner.py`
- `src/agent/nodes/interviewer.py`
- `src/agent/nodes/reviewer.py`

推荐顺序：

1. `parser.py`：把自由文本变成结构化对象。
2. `planner.py`：决定后面问什么题，是业务策略核心。
3. `interviewer.py`：控制提问、澄清、换题和追问。
4. `reviewer.py`：控制单题评分、人审暂停和最终报告。

读每个节点时都问四件事：

1. 输入依赖哪些 state 字段？
2. 主要调用哪个 prompt？
3. 输出写回哪些 state 字段？
4. 失败会影响哪段流程？

## 5. 看 prompts 和 schema

相关文件：

- `src/agent/prompts/`
- `src/agent/schemas.py`

这是 Agent 工程里最容易被忽视、但最关键的一层。需要理解：

- prompt 希望模型输出什么
- schema 要求输出长什么样
- 两者为什么必须严格对齐

如果 prompt 和 schema 不一致，就容易出现 JSON 解析失败、字段缺失、类型错误和路由逻辑失真。

## 6. 看 LLM 适配层

相关文件：

- `src/agent/llm_service.py`
- `src/agent/llm/config.py`
- `src/agent/llm/registry.py`
- `src/agent/llm/adapters/openai_adapter.py`
- `src/agent/llm/adapters/non_openai.py`

这一层的作用不是“问模型”，而是“稳定地问模型”。

重点看：

- `.env` 如何映射成 `ProviderConfig`
- DeepSeek / Moonshot / Qwen 为什么能共用 OpenAI-compatible adapter
- 结构化调用和普通文本调用有什么区别
- LangSmith tracing 是怎么挂进去的

## 7. 看外部入口

三个入口代表三种使用方式：

- `scripts/interactive_interview.py`：适合本地学习和直接跑流程。
- `src/main.py`：适合理解外部服务如何通过 HTTP 调用 Agent。
- `src/showcase/app.py`：适合理解展示层如何连接后端能力。

如果你是初学者，先看 `interactive_interview.py`。理解主链路后，再看 `src/main.py`。

## 8. 看测试

相关目录：

- `tests/`

测试不是最后才看，而是理解“系统应该怎样工作”的好方式。

建议先看：

- `tests/test_graph.py`
- `tests/test_schemas.py`
- `tests/conformance/test_graph_flow.py`
- `tests/conformance/test_llm_providers.py`
- `tests/test_runtime_config_and_concurrency.py`

你要从测试里学到：

- 系统的稳定边界在哪里
- 哪些输入是合法的
- 哪些行为被认为是正确的
- checkpoint 和人审暂停如何保证流程可恢复

## 9. 推荐学习顺序

如果每天学习 1 小时，建议这样走：

1. 第一天：跑通项目，看 `README.md`、`graph.py`、`state.py`
2. 第二天：看 `parser.py`、`schemas.py`
3. 第三天：看 `planner.py` 和对应 prompts
4. 第四天：看 `interviewer.py`
5. 第五天：看 `reviewer.py`
6. 第六天：看 `llm_service.py`、`openai_adapter.py`
7. 第七天：看 `src/main.py` 和 `tests/`

## 10. 常见误区

1. 一上来从头到尾硬读所有代码。  
   这样会迷失在细节里。

2. 只看 prompt，不看 schema。  
   这样会误以为模型想怎么说都行。

3. 只看节点，不看 state。  
   这样会看不懂数据怎么在图里流动。

4. 只跑 UI，不跑 CLI。  
   CLI 更容易看清主流程。

## 11. 最后一条建议

把这个项目当成三个问题去学：

1. 它怎么组织流程？
2. 它怎么约束模型输出？
3. 它怎么把一次面试变成可恢复、可评分、可追踪的状态机？

只要这三件事看懂，这个项目的骨架就真正掌握了。
