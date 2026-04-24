import { useEffect, useMemo, useState } from 'react';
import { Sliders, Trash2, Wifi } from 'lucide-react';
import { useSettingsCenterContext } from './context';
import { supabase } from '../../lib/supabase';
import {
  getInterviewQuestionCountOption,
  INTERVIEW_QUESTION_COUNT_OPTIONS,
  normalizeInterviewQuestionCount,
} from '../../lib/interviewQuestionCount';
import {
  getInterviewDurationMinutesForQuestionCount,
  INTERVIEW_DURATION_OPTIONS,
  normalizeInterviewDuration,
} from '../../lib/interviewDuration';
import { testLlmConnection, type LlmConnectionConfig } from '../../lib/llmConnectionTest';

type LlmMode = 'local' | 'api_key';
type LlmProvider =
  | 'custom'
  | 'openai'
  | 'anthropic'
  | 'google'
  | 'deepseek'
  | 'openrouter'
  | 'ollama'
  | 'vllm'
  | 'zhipu'
  | 'moonshot';
type LlmStrategyMode = 'quality' | 'balanced' | 'cost';

interface LlmModelConfigRow {
  id: string;
  provider: LlmProvider;
  mode: LlmMode;
  model_name: string;
  base_url: string | null;
  api_key_encrypted: string | null;
  api_version: string | null;
  max_tokens: number | null;
  temperature: number | null;
  timeout_ms: number | null;
  is_active: boolean;
  created_at: string;
}

interface NewModelForm {
  mode: LlmMode;
  provider: LlmProvider;
  model_name: string;
  base_url: string;
  api_key_encrypted: string;
}

type TestState =
  | { status: 'idle'; message: '' }
  | { status: 'running'; message: string }
  | { status: 'success'; message: string }
  | { status: 'error'; message: string };

const PROVIDER_OPTIONS: Array<{ value: LlmProvider; label: string }> = [
  { value: 'custom', label: '自定义（OpenAI 兼容）' },
  { value: 'openai', label: 'OpenAI' },
  { value: 'anthropic', label: 'Anthropic' },
  { value: 'google', label: 'Google Gemini' },
  { value: 'deepseek', label: 'DeepSeek' },
  { value: 'openrouter', label: 'OpenRouter' },
  { value: 'ollama', label: 'Ollama（本地）' },
  { value: 'vllm', label: 'vLLM（本地）' },
  { value: 'zhipu', label: '智谱 AI' },
  { value: 'moonshot', label: 'Moonshot / Kimi' },
];

const STRATEGY_OPTIONS: Array<{ value: LlmStrategyMode; label: string; description: string }> = [
  { value: 'quality', label: '质量优先', description: '优先保证稳定性和准确性，必要时自动重试一次。' },
  { value: 'balanced', label: '平衡模式', description: '在效果、响应速度和成本之间保持平衡。' },
  { value: 'cost', label: '成本优先', description: '尽量减少重试，更强调调用成本控制。' },
];

function inferProtocol(provider: LlmProvider, baseUrl: string | null): 'openai' | 'anthropic' | 'gemini' {
  if (provider === 'anthropic') return 'anthropic';
  if (provider === 'google') return 'gemini';

  const url = (baseUrl ?? '').toLowerCase();
  if (url.includes('anthropic')) return 'anthropic';
  if (url.includes('generativelanguage') || url.includes('gemini')) return 'gemini';
  return 'openai';
}

function normalizeModelMode(value: unknown): LlmMode {
  return value === 'local' ? 'local' : 'api_key';
}

function normalizeStrategyMode(value: unknown): LlmStrategyMode {
  if (value === 'quality' || value === 'balanced' || value === 'cost') return value;
  return 'balanced';
}

function makeInitialForm(): NewModelForm {
  return {
    mode: 'api_key',
    provider: 'moonshot',
    model_name: '',
    base_url: '',
    api_key_encrypted: '',
  };
}

const cardShadow = 'shadow-[0_14px_30px_-28px_rgba(15,23,42,0.1)]';

export default function AiPolicySettings() {
  const { settings, loading, syncError, updateSetting, updateSettings } = useSettingsCenterContext();
  const [models, setModels] = useState<LlmModelConfigRow[]>([]);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [modelsError, setModelsError] = useState<string | null>(null);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [isSavingModel, setIsSavingModel] = useState(false);
  const [newModel, setNewModel] = useState<NewModelForm>(makeInitialForm());
  const [testState, setTestState] = useState<TestState>({ status: 'idle', message: '' });

  const activeModelId = (settings?.active_llm_model_id as string | null) ?? null;
  const interviewAgentModelId = (settings?.active_interview_llm_model_id as string | null) ?? activeModelId ?? null;
  const activeModel = useMemo(() => models.find((item) => item.id === activeModelId) ?? null, [models, activeModelId]);
  const interviewAgentModel = useMemo(
    () => models.find((item) => item.id === interviewAgentModelId) ?? null,
    [models, interviewAgentModelId]
  );
  const retryEnabled = Boolean(settings?.llm_retry_enabled ?? true);
  const strategyMode = normalizeStrategyMode(settings?.llm_strategy_mode);
  const interviewQuestionCount = normalizeInterviewQuestionCount(settings?.interview_question_count);
  const interviewQuestionCountOption = getInterviewQuestionCountOption(interviewQuestionCount);
  const interviewDuration = getInterviewDurationMinutesForQuestionCount(interviewQuestionCount);
  const interviewDurationOption = { value: interviewDuration, label: '按题量自动匹配' } as const;

  const loadModels = async () => {
    setModelsLoading(true);
    setModelsError(null);

    const { data, error } = await supabase
      .from('llm_model_configs')
      .select('*')
      .eq('is_active', true)
      .order('created_at', { ascending: false });

    if (error) {
      setModelsError(error.message);
      setModels([]);
    } else {
      setModels((data ?? []) as LlmModelConfigRow[]);
    }

    setModelsLoading(false);
  };

  useEffect(() => {
    if (!loading) {
      void loadModels();
    }
  }, [loading]);

  if (loading) {
    return <div className="p-12 text-center text-slate-500 animate-pulse">正在加载 AI 策略设置...</div>;
  }

  const handleSelectActiveModel = async (modelId: string) => {
    setSaveMessage(null);
    await updateSetting('active_llm_model_id', modelId || null);
  };

  const handleSelectInterviewAgentModel = async (modelId: string) => {
    setSaveMessage(null);
    await updateSetting('active_interview_llm_model_id', modelId || null);
  };

  const handleCreateModel = async () => {
    setSaveMessage(null);
    setModelsError(null);

    const modelName = newModel.model_name.trim();
    if (!modelName) {
      setModelsError('请填写模型名称（model_name）。');
      return;
    }

    if (newModel.mode === 'api_key' && !newModel.api_key_encrypted.trim()) {
      setModelsError('云端 / API Key 模式必须填写 API Key。');
      return;
    }

    setIsSavingModel(true);
    const payload = {
      provider: newModel.provider,
      mode: newModel.mode,
      model_name: modelName,
      base_url: newModel.base_url.trim() || null,
      api_key_encrypted: newModel.mode === 'api_key' ? newModel.api_key_encrypted.trim() || null : null,
      api_version: '2023-06-01',
      max_tokens: 2048,
      temperature: 0.2,
      timeout_ms: 45000,
      is_active: true,
    };

    const { data, error } = await supabase.from('llm_model_configs').insert(payload).select('id').single();
    if (error) {
      setModelsError(error.message);
      setIsSavingModel(false);
      return;
    }

    if (!activeModelId) {
      await updateSetting('active_llm_model_id', (data as { id: string }).id);
    }

    setSaveMessage(`模型已添加：${modelName}`);
    setNewModel((prev) => ({
      ...makeInitialForm(),
      provider: prev.provider,
      mode: prev.mode,
      base_url: prev.base_url,
    }));
    await loadModels();
    setIsSavingModel(false);
  };

  const handleDeleteModel = async (model: LlmModelConfigRow) => {
    setSaveMessage(null);
    setModelsError(null);

    const confirmed = window.confirm(`确定删除模型 ${model.model_name} 吗？`);
    if (!confirmed) return;

    if (activeModelId === model.id) {
      await updateSetting('active_llm_model_id', null);
    }

    const { error } = await supabase.from('llm_model_configs').delete().eq('id', model.id);
    if (error) {
      setModelsError(error.message);
      return;
    }

    setSaveMessage(`模型已删除：${model.model_name}`);
    await loadModels();
  };

  const handleTestConnection = async () => {
    if (!activeModel) {
      setTestState({ status: 'error', message: '请先添加模型并选择一个生效模型。' });
      return;
    }

    if (activeModel.mode === 'api_key' && !(activeModel.api_key_encrypted ?? '').trim()) {
      setTestState({ status: 'error', message: '当前模型缺少 API Key，无法进行连接测试。' });
      return;
    }

    const config: LlmConnectionConfig = {
      apiProtocol: inferProtocol(activeModel.provider, activeModel.base_url),
      baseUrl: activeModel.base_url ?? null,
      modelName: activeModel.model_name,
      apiKey: activeModel.api_key_encrypted ?? null,
      apiVersion: activeModel.api_version ?? '2023-06-01',
      timeoutMs: Number(activeModel.timeout_ms ?? 45000),
      maxTokens: Number(activeModel.max_tokens ?? 2048),
      temperature: Number(activeModel.temperature ?? 0.2),
    };

    try {
      setTestState({ status: 'running', message: `正在测试模型 ${activeModel.model_name}...` });
      const result = await testLlmConnection(config);
      setTestState({
        status: 'success',
        message: `连接成功（${result.latencyMs}ms）。响应预览：${result.preview || 'OK'}`,
      });
    } catch (error) {
      setTestState({
        status: 'error',
        message: error instanceof Error ? error.message : '未知连接错误',
      });
    }
  };

  const handleSaveSimpleStrategy = async (
    patch: Partial<{
      llm_retry_enabled: boolean;
      llm_strategy_mode: LlmStrategyMode;
      interview_question_count: number;
      interview_duration_minutes: number;
    }>
  ) => {
    setSaveMessage(null);
    setModelsError(null);
    await updateSettings(patch);
    setSaveMessage('AI 策略已保存。');
  };

  return (
    <section className="space-y-6 rounded-[28px] border border-[#d9e5f2] bg-white p-6 shadow-[0_14px_30px_-28px_rgba(15,23,42,0.1)]">
      <div className="space-y-1 border-b border-[#e8eff7] pb-5">
        <h3 className="flex items-center gap-2 text-base font-semibold text-[#16355f]">
          <Sliders className="h-5 w-5 text-[#1f5fbf]" />
          AI 与筛选策略
        </h3>
        <p className="text-sm text-[#6b86a4]">统一管理模型接入、面试题生成和自动重试策略。</p>
      </div>

      {syncError ? (
        <div className="rounded-[18px] border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-600">
          设置同步失败：{syncError}
        </div>
      ) : null}

      {modelsError ? (
        <div className="rounded-[18px] border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-600">
          {modelsError}
        </div>
      ) : null}

      {saveMessage ? (
        <div className="rounded-[18px] border border-[#bfd5f5] bg-[#f7fbff] px-4 py-3 text-sm text-[#1f5fbf]">
          {saveMessage}
        </div>
      ) : null}

      <div className="grid gap-3 lg:grid-cols-4">
        <article className={`rounded-[20px] border border-[#d9e5f2] bg-[#fbfdff] p-4 ${cardShadow}`}>
          <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[#6b86a4]">当前主模型</p>
          <p className="mt-2 text-lg font-semibold text-[#16355f]">{activeModel?.model_name || '未设置'}</p>
          <p className="mt-1 text-xs text-[#6b86a4]">
            {activeModel ? `${activeModel.provider} · ${activeModel.mode}` : '需要先添加模型'}
          </p>
        </article>
        <article className={`rounded-[20px] border border-[#d9e5f2] bg-[#fbfdff] p-4 ${cardShadow}`}>
          <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[#6b86a4]">自动重试</p>
          <p className="mt-2 text-lg font-semibold text-[#16355f]">{retryEnabled ? '已开启' : '已关闭'}</p>
          <p className="mt-1 text-xs text-[#6b86a4]">
            {STRATEGY_OPTIONS.find((item) => item.value === strategyMode)?.label || '平衡模式'}
          </p>
        </article>
        <article className={`rounded-[20px] border border-[#d9e5f2] bg-[#fbfdff] p-4 ${cardShadow}`}>
          <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[#6b86a4]">面试题数量</p>
          <p className="mt-2 text-lg font-semibold text-[#16355f]">{interviewQuestionCountOption.value} 题</p>
          <p className="mt-1 text-xs text-[#6b86a4]">{interviewQuestionCountOption.label}</p>
        </article>
        <article className={`rounded-[20px] border border-[#d9e5f2] bg-[#fbfdff] p-4 ${cardShadow}`}>
          <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[#6b86a4]">默认面试时长</p>
          <p className="mt-2 text-lg font-semibold text-[#16355f]">{interviewDurationOption.value} 分钟</p>
          <p className="mt-1 text-xs text-[#6b86a4]">{interviewDurationOption.label}</p>
        </article>
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
        <div className="space-y-6">
          <section className={`rounded-[24px] border border-[#d9e5f2] bg-[#fbfdff] p-5 ${cardShadow}`}>
            <div className="space-y-5">
              <div>
                <h4 className="text-sm font-semibold text-[#16355f]">模型分配</h4>
                <p className="mt-1 text-xs text-[#6b86a4]">这里控制筛选流程和 AI 面试所使用的模型。</p>
              </div>

              <div className="space-y-2">
                <label className="block text-sm font-medium text-[#24476b]">当前生效模型</label>
                <select
                  value={activeModelId ?? ''}
                  onChange={(event) => void handleSelectActiveModel(event.target.value)}
                  disabled={modelsLoading || models.length === 0}
                  className="w-full rounded-2xl border border-[#d7e5f7] bg-white px-4 py-3 text-sm text-[#16355f] outline-none transition focus:border-[#6a9be0] disabled:opacity-60"
                >
                  <option value="">{models.length === 0 ? '暂无模型，请先添加' : '请选择生效模型'}</option>
                  {models.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.model_name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-2">
                <label className="block text-sm font-medium text-[#24476b]">面试 Agent 模型</label>
                <select
                  value={interviewAgentModelId ?? ''}
                  onChange={(event) => void handleSelectInterviewAgentModel(event.target.value)}
                  disabled={modelsLoading || models.length === 0}
                  className="w-full rounded-2xl border border-[#d7e5f7] bg-white px-4 py-3 text-sm text-[#16355f] outline-none transition focus:border-[#6a9be0] disabled:opacity-60"
                >
                  <option value="">{models.length === 0 ? '暂无模型，请先添加' : '留空则跟随主模型'}</option>
                  {models.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.model_name}
                    </option>
                  ))}
                </select>
                <p className="text-xs text-[#6b86a4]">
                  {interviewAgentModel
                    ? `当前面试 Agent：${interviewAgentModel.model_name} / ${interviewAgentModel.provider}`
                    : '未单独设置时会沿用上方主模型。'}
                </p>
              </div>

              {activeModel ? (
                <div className="space-y-3 rounded-[20px] border border-[#d7e5f7] bg-white p-4">
                  <div className="text-xs text-[#6b86a4]">
                    当前生效：{activeModel.model_name} · {activeModel.provider} ·{' '}
                    {activeModel.mode === 'local' ? '本地模型' : '云端 / API Key'}
                  </div>
                  <button
                    type="button"
                    onClick={() => void handleTestConnection()}
                    disabled={testState.status === 'running'}
                    className="inline-flex items-center gap-2 rounded-2xl bg-[#1f5fbf] px-4 py-2.5 text-sm font-medium text-white transition hover:bg-[#194f9e] disabled:opacity-60"
                  >
                    <Wifi className="h-4 w-4" />
                    {testState.status === 'running' ? '连接测试中...' : '测试当前模型连接'}
                  </button>

                  {testState.status !== 'idle' ? (
                    <div
                      className={`rounded-2xl border px-3 py-2 text-xs ${
                        testState.status === 'success'
                          ? 'border-[#bfd5f5] bg-[#f7fbff] text-[#1f5fbf]'
                          : testState.status === 'error'
                            ? 'border-rose-200 bg-rose-50 text-rose-600'
                            : 'border-[#d9e5f2] bg-[#fbfdff] text-[#6b86a4]'
                      }`}
                    >
                      {testState.message}
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>
          </section>

          <section className={`rounded-[24px] border border-[#d9e5f2] bg-[#fbfdff] p-5 ${cardShadow}`}>
            <div className="space-y-5">
              <div>
                <h4 className="text-sm font-semibold text-[#16355f]">自动策略</h4>
                <p className="mt-1 text-xs text-[#6b86a4]">控制筛选链路的稳定性和面试题默认强度。</p>
              </div>

              <label className="inline-flex items-center gap-3 text-sm text-[#24476b]">
                <input
                  type="checkbox"
                  checked={retryEnabled}
                  onChange={(event) => void handleSaveSimpleStrategy({ llm_retry_enabled: event.target.checked })}
                  className="h-4 w-4 cursor-pointer accent-[#1f5fbf]"
                />
                自动重试一次
              </label>

              <div className="space-y-2">
                <label className="block text-sm font-medium text-[#24476b]">策略模式</label>
                <select
                  value={strategyMode}
                  onChange={(event) =>
                    void handleSaveSimpleStrategy({ llm_strategy_mode: normalizeStrategyMode(event.target.value) })
                  }
                  className="w-full rounded-2xl border border-[#d7e5f7] bg-white px-4 py-3 text-sm text-[#16355f] outline-none transition focus:border-[#6a9be0]"
                >
                  {STRATEGY_OPTIONS.map((item) => (
                    <option key={item.value} value={item.value}>
                      {item.label}
                    </option>
                  ))}
                </select>
                <p className="text-xs text-[#6b86a4]">
                  {STRATEGY_OPTIONS.find((item) => item.value === strategyMode)?.description || '在效果、速度和成本之间保持平衡。'}
                </p>
              </div>

              <div className="space-y-2">
                <label className="block text-sm font-medium text-[#24476b]">默认题目数量</label>
                <select
                  value={String(interviewQuestionCount)}
                  onChange={(event) =>
                    void handleSaveSimpleStrategy({
                      interview_question_count: normalizeInterviewQuestionCount(event.target.value),
                    })
                  }
                  className="w-full rounded-2xl border border-[#d7e5f7] bg-white px-4 py-3 text-sm text-[#16355f] outline-none transition focus:border-[#6a9be0]"
                >
                  {INTERVIEW_QUESTION_COUNT_OPTIONS.map((item) => (
                    <option key={item.value} value={item.value}>
                      {item.label} · {item.value} 题
                    </option>
                  ))}
                </select>
                <p className="text-xs text-[#6b86a4]">
                  当前为 {interviewQuestionCountOption.label} 档，默认生成 {interviewQuestionCountOption.value} 道题。
                </p>
              </div>

              <div className="space-y-2">
                <label className="block text-sm font-medium text-[#24476b]">默认面试时长</label>
                <select
                  value={String(interviewDuration)}
                  onChange={(event) =>
                    void handleSaveSimpleStrategy({
                      interview_duration_minutes: normalizeInterviewDuration(event.target.value),
                    })
                  }
                  className="w-full rounded-2xl border border-[#d7e5f7] bg-white px-4 py-3 text-sm text-[#16355f] outline-none transition focus:border-[#6a9be0]"
                >
                  {INTERVIEW_DURATION_OPTIONS.map((item) => (
                    <option key={item.value} value={item.value}>
                      {item.label} · {item.value} 分钟
                    </option>
                  ))}
                </select>
                <p className="text-xs text-[#6b86a4]">
                  当前按题量自动匹配为 {interviewDurationOption.value} 分钟。
                </p>
              </div>
            </div>
          </section>
        </div>

        <div className="space-y-6">
          <section className={`rounded-[24px] border border-[#d9e5f2] bg-[#fbfdff] p-5 ${cardShadow}`}>
            <div className="space-y-5">
              <div>
                <h4 className="text-sm font-semibold text-[#16355f]">添加模型</h4>
                <p className="mt-1 text-xs text-[#6b86a4]">支持本地模型和云端 API Key 模式。</p>
              </div>

              <div className="space-y-2">
                <label className="block text-sm font-medium text-[#24476b]">运行模式</label>
                <select
                  value={newModel.mode}
                  onChange={(event) =>
                    setNewModel((prev) => ({
                      ...prev,
                      mode: normalizeModelMode(event.target.value),
                      api_key_encrypted: normalizeModelMode(event.target.value) === 'local' ? '' : prev.api_key_encrypted,
                    }))
                  }
                  className="w-full rounded-2xl border border-[#d7e5f7] bg-white px-4 py-3 text-sm text-[#16355f] outline-none transition focus:border-[#6a9be0]"
                >
                  <option value="local">本地模型</option>
                  <option value="api_key">云端 / API Key</option>
                </select>
              </div>

              <div className="space-y-2">
                <label className="block text-sm font-medium text-[#24476b]">模型提供方</label>
                <select
                  value={newModel.provider}
                  onChange={(event) => setNewModel((prev) => ({ ...prev, provider: event.target.value as LlmProvider }))}
                  className="w-full rounded-2xl border border-[#d7e5f7] bg-white px-4 py-3 text-sm text-[#16355f] outline-none transition focus:border-[#6a9be0]"
                >
                  {PROVIDER_OPTIONS.map((item) => (
                    <option key={item.value} value={item.value}>
                      {item.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-2">
                <label className="block text-sm font-medium text-[#24476b]">模型名称</label>
                <input
                  type="text"
                  value={newModel.model_name}
                  onChange={(event) => setNewModel((prev) => ({ ...prev, model_name: event.target.value }))}
                  placeholder="例如：gpt-4.1-mini / kimi-k2 / deepseek-chat"
                  className="w-full rounded-2xl border border-[#d7e5f7] bg-white px-4 py-3 text-sm text-[#16355f] outline-none transition focus:border-[#6a9be0]"
                />
              </div>

              <div className="space-y-2">
                <label className="block text-sm font-medium text-[#24476b]">Base URL</label>
                <input
                  type="text"
                  value={newModel.base_url}
                  onChange={(event) => setNewModel((prev) => ({ ...prev, base_url: event.target.value }))}
                  placeholder="例如：http://127.0.0.1:11434/v1 或 https://api.openai.com/v1"
                  className="w-full rounded-2xl border border-[#d7e5f7] bg-white px-4 py-3 text-sm text-[#16355f] outline-none transition focus:border-[#6a9be0]"
                />
              </div>

              {newModel.mode === 'api_key' ? (
                <div className="space-y-2">
                  <label className="block text-sm font-medium text-[#24476b]">API Key</label>
                  <input
                    type="password"
                    value={newModel.api_key_encrypted}
                    onChange={(event) => setNewModel((prev) => ({ ...prev, api_key_encrypted: event.target.value }))}
                    placeholder="输入对应提供方的 API Key"
                    className="w-full rounded-2xl border border-[#d7e5f7] bg-white px-4 py-3 text-sm text-[#16355f] outline-none transition focus:border-[#6a9be0]"
                  />
                </div>
              ) : null}

              <button
                type="button"
                onClick={() => void handleCreateModel()}
                disabled={isSavingModel}
                className="w-full rounded-2xl bg-[#1f5fbf] px-4 py-3 text-sm font-medium text-white transition hover:bg-[#194f9e] disabled:opacity-60"
              >
                {isSavingModel ? '保存中...' : '添加模型'}
              </button>
            </div>
          </section>

          <section className={`rounded-[24px] border border-[#d9e5f2] bg-[#fbfdff] p-5 ${cardShadow}`}>
            <div className="space-y-4">
              <div>
                <h4 className="text-sm font-semibold text-[#16355f]">已添加模型</h4>
                <p className="mt-1 text-xs text-[#6b86a4]">这里列出当前已配置好的模型入口。</p>
              </div>

              {models.length === 0 ? (
                <div className="rounded-[20px] border border-dashed border-[#d7e5f7] bg-white px-4 py-6 text-sm text-[#6b86a4]">
                  暂无已添加模型。
                </div>
              ) : (
                <div className="space-y-3">
                  {models.map((item) => (
                    <article key={item.id} className="rounded-[20px] border border-[#d7e5f7] bg-white p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-sm font-semibold text-[#16355f]">{item.model_name}</p>
                          <p className="mt-1 text-xs text-[#6b86a4]">
                            {item.provider} · {item.mode === 'local' ? '本地模型' : '云端 / API Key'}
                          </p>
                        </div>
                        {item.id === activeModelId ? (
                          <span className="rounded-full border border-[#bfd5f5] bg-[#f7fbff] px-2.5 py-1 text-[11px] font-medium text-[#1f5fbf]">
                            当前生效
                          </span>
                        ) : null}
                      </div>

                      <div className="mt-4 flex flex-wrap items-center gap-2">
                        {item.id !== activeModelId ? (
                          <button
                            type="button"
                            onClick={() => void handleSelectActiveModel(item.id)}
                            className="rounded-xl border border-[#d7e5f7] bg-[#f7fbff] px-3 py-2 text-xs font-medium text-[#24476b] transition hover:bg-[#edf4fd]"
                          >
                            设为主模型
                          </button>
                        ) : null}
                        <button
                          type="button"
                          onClick={() => void handleDeleteModel(item)}
                          className="inline-flex items-center gap-1.5 rounded-xl border border-[#f0d5dc] bg-[#fff7f8] px-3 py-2 text-xs font-medium text-[#a2506a] transition hover:bg-[#fff0f3]"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                          删除
                        </button>
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </div>
          </section>
        </div>
      </div>
    </section>
  );
}
