# 外部市场薪资采集设计

日期：2026-04-18

## 目标

为招聘薪资决策台提供可持续更新的外部市场薪资基准，并将其作为薪资判断的主锚点。

系统最终要回答：

- 这个岗位在外部市场上的合理区间是多少
- 当前候选人的期望薪资是否偏高
- 当前岗位预算是否覆盖市场

## 设计原则

- 外部市场是主锚点
- 候选人期望与岗位预算是修正项，不是基准源
- 先做可用的标准化市场库，再做复杂的模型判断
- 第一版允许人工抽查，不追求全自动无监督

## 范围

本次设计包含：

- 外部市场薪资数据采集
- 原始数据落库
- 岗位 / 城市标准化
- 薪资区间聚合
- 市场薪资基准表生成

本次不包含：

- 商业数据源采购接入
- 多来源质量评分模型
- 全自动纠错
- 内部员工薪酬系统

## 数据分层

### 1. 原始采集层

保存外部平台抓取到的原始记录，保留来源与原始文案，便于追溯。

建议表：`market_salary_raw_records`

字段：

- `id`
- `source`
- `source_job_title`
- `source_city`
- `source_salary_text`
- `salary_min`
- `salary_max`
- `salary_period`
- `currency`
- `experience_text`
- `education_text`
- `company_name`
- `captured_at`
- `raw_payload`
- `hash_key`

作用：

- 保留抓取原样
- 防重
- 便于后续重新标准化

### 2. 标准化映射层

将原始岗位和城市映射为系统内统一维度。

建议表：`market_salary_normalized_records`

字段：

- `id`
- `raw_record_id`
- `normalized_role`
- `normalized_city`
- `normalized_level`
- `salary_min_monthly`
- `salary_median_monthly`
- `salary_max_monthly`
- `source`
- `captured_at`
- `is_valid`
- `invalid_reason`

作用：

- 统一不同平台字段
- 过滤明显异常值
- 为聚合层提供干净数据

### 3. 基准聚合层

作为招聘薪资页直接读取的主表。

建议表：`market_salary_benchmarks`

字段：

- `id`
- `role_key`
- `city_key`
- `level_key`
- `min_salary`
- `median_salary`
- `max_salary`
- `sample_size`
- `source_count`
- `latest_source_at`
- `updated_at`

作用：

- 成为“岗位 × 城市 × 级别”的市场锚点
- 供 `/salary` 页面和薪资判断规则直接读取

## 采集来源

第一版建议只接 1 到 2 个公开来源，先确保链路稳定。

来源筛选标准：

- 有公开职位薪资区间
- 岗位标题与城市信息可抓取
- 数据量覆盖技术招聘主场景
- 抓取频率不需要实时秒级

第一版优先：

- 招聘网站公开职位页
- 聚合职位列表页

第一版避免：

- 必须登录才能稳定访问的平台
- 高强风控或复杂反爬的平台
- 商业 API

## 标准化规则

### 岗位标准化

目标是把外部职位标题压到系统内稳定的 `role_key`。

示例：

- `计算机视觉算法工程师`
- `CV 算法工程师`
- `视觉算法工程师`

统一到：

- `cv_algorithm_engineer`

第一版做法：

- 关键词词典
- 别名映射
- 少量规则归类

不做复杂 NLP 分类器。

### 城市标准化

目标是将来源城市统一到系统内 `city_key`。

示例：

- `北京`
- `北京市`

统一到：

- `beijing`

### 级别标准化

优先从职位文案中的经验要求推断级别：

- `0-3 年` -> `junior`
- `3-5 年` -> `mid`
- `5-8 年` -> `senior`
- `8+` 或负责人岗位 -> `lead`

如果无法判断，先落为 `unknown`。

## 薪资换算规则

不同来源可能出现：

- 月薪
- 年薪
- `15薪 / 16薪`
- 薪资面议

第一版规则：

- 统一换算为税前月薪基准
- 能明确解析的才纳入
- `面议` 直接标记无效
- 无法解析的记录保留在原始层，但不进入聚合

## 聚合逻辑

聚合维度：

- `role_key`
- `city_key`
- `level_key`

聚合输出：

- `min_salary`
- `median_salary`
- `max_salary`
- `sample_size`

建议规则：

- 样本数低于阈值时，不生成正式 benchmark
- 异常高值和异常低值在聚合前做截尾
- 使用中位值作为默认建议锚点

## 刷新机制

第一版不需要实时刷新。

建议：

- 每日或每周批量更新
- 每次抓取形成一批 `crawl_job`
- 成功后更新基准表

建议表：`market_salary_crawl_jobs`

字段：

- `id`
- `source`
- `status`
- `started_at`
- `finished_at`
- `records_fetched`
- `records_valid`
- `error_message`

## 与招聘薪资页的关系

`/salary` 不直接读原始抓取记录，而是读聚合后的 `market_salary_benchmarks`。

招聘判断公式依赖三类输入：

- 市场基准
- 候选人期望薪资
- 岗位预算

但市场基准优先级最高。

## 第一版实施建议

第一版建议拆成四步：

1. 建立三层表结构
2. 做一个采集脚本，先落原始记录
3. 做标准化与聚合脚本
4. 让 `/salary` 页面只读 benchmark 表

这样即使采集源后续增加，页面层也不需要重写。

## 风险

### 1. 岗位名称不统一

解决：

- 先做词典映射
- 人工补充高频别名

### 2. 薪资表达方式混乱

解决：

- 第一版严格过滤无法解析项
- 原始数据保留，后续再补解析器

### 3. 样本量不足

解决：

- 样本不足时不给出正式市场结论
- 页面展示“缺少市场基准”

### 4. 来源质量波动

解决：

- 记录 `source`
- 后续可引入来源权重，但第一版先不做

## 验证

至少验证：

- 原始数据可成功落库
- 标准化后能生成稳定的 `role_key / city_key / level_key`
- benchmark 表可被 `/salary` 页面查询
- 同一岗位不同来源能正确聚合
- 样本不足与无法解析记录不会污染市场基准
