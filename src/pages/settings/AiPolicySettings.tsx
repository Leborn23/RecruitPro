import { useEffect, useMemo, useState } from 'react';
import { ListChecks, Loader2, Sliders, Trash2, Wifi } from 'lucide-react';
import { useSettingsCenterContext } from './context';
import { supabase } from '../../lib/supabase';
import { testLlmConnection, type LlmConnectionConfig } from '../../lib/llmConnectionTest';
import { fetchOpenAiCompatibleModels } from '../../lib/llmModelDiscovery';

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

type ModelDiscoveryState =
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
  const { settings, loading, syncError, updateSetting } = useSettingsCenterContext();
  const [models, setModels] = useState<LlmModelConfigRow[]>([]);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [modelsError, setModelsError] = useState<string | null>(null);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [isSavingModel, setIsSavingModel] = useState(false);
  const [newModel, setNewModel] = useState<NewModelForm>(makeInitialForm());
  const [testState, setTestState] = useState<TestState>({ status: 'idle', message: '' });
  const [modelDiscoveryState, setModelDiscoveryState] = useState<ModelDiscoveryState>({ status: 'idle', message: '' });
  const [discoveredModels, setDiscoveredModels] = useState<string[]>([]);

  const activeModelId = (settings?.active_llm_model_id as string | null) ?? null;
  const interviewAgentModelId = (settings?.active_interview_llm_model_id as string | null) ?? activeModelId ?? null;
  const activeModel = useMemo(() => models.find((item) => item.id === activeModelId) ?? null, [models, activeModelId]);
  const interviewAgentModel = useMemo(
    () => models.find((item) => item.id === interviewAgentModelId) ?? null,
    [models, interviewAgentModelId]
  );
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
    return <div className="p-12 text-center text-slate-500 animate-pulse">正在加载 AI 配置...</div>;
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

  const handleDiscoverModels = async () => {
    setModelsError(null);
    setSaveMessage(null);
    setDiscoveredModels([]);

    const baseUrl = newModel.base_url.trim();
    if (!baseUrl) {
      setModelDiscoveryState({ status: 'error', message: '请先填写 Base URL。' });
      return;
    }

    if (newModel.provider === 'anthropic' || newModel.provider === 'google') {
      setModelDiscoveryState({
        status: 'error',
        message: '当前自动检测优先支持 OpenAI 兼容接口；Anthropic / Gemini 请先手动填写模型名称。',
      });
      return;
    }

    if (newModel.mode === 'api_key' && !newModel.api_key_encrypted.trim()) {
      setModelDiscoveryState({ status: 'error', message: '云端模型需要先填写 API Key。' });
      return;
    }

    try {
      setModelDiscoveryState({ status: 'running', message: '正在检测模型列表...' });
      const result = await fetchOpenAiCompatibleModels({
        baseUrl,
        apiKey: newModel.mode === 'api_key' ? newModel.api_key_encrypted.trim() : null,
        timeoutMs: 15000,
      });
      setDiscoveredModels(result.models);
      setNewModel((prev) => ({
        ...prev,
        model_name: prev.model_name.trim() || result.models[0] || '',
      }));
      setModelDiscoveryState({
        status: 'success',
        message: `已从 ${result.endpoint} 获取 ${result.models.length} 个模型。`,
      });
    } catch (error) {
      setModelDiscoveryState({
        status: 'error',
        message: error instanceof Error ? error.message : '模型列表检测失败，请手动填写模型名称。',
      });
    }
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

  return (
    <section className="space-y-6 rounded-[28px] border border-[#d9e5f2] bg-white p-6 shadow-[0_14px_30px_-28px_rgba(15,23,42,0.1)]">
      <div className="space-y-1 border-b border-[#e8eff7] pb-5">
        <h3 className="flex items-center gap-2 text-base font-semibold text-[#16355f]">
          <Sliders className="h-5 w-5 text-[#1f5fbf]" />
          AI 配置
        </h3>
        <p className="text-sm text-[#6b86a4]">配置简历分析、匹配度计算、AI 面试和评分报告使用的模型。</p>
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

      <div className="grid gap-3 md:grid-cols-2">
        <article className={`rounded-[20px] border border-[#d9e5f2] bg-[#fbfdff] p-4 ${cardShadow}`}>
          <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[#6b86a4]">当前主模型</p>
          <p className="mt-2 text-lg font-semibold text-[#16355f]">{activeModel?.model_name || '未设置'}</p>
          <p className="mt-1 text-xs text-[#6b86a4]">
            {activeModel ? `${activeModel.provider} · ${activeModel.mode}` : '需要先添加模型'}
          </p>
        </article>
        <article className={`rounded-[20px] border border-[#d9e5f2] bg-[#fbfdff] p-4 ${cardShadow}`}>
          <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[#6b86a4]">面试模型</p>
          <p className="mt-2 text-lg font-semibold text-[#16355f]">{interviewAgentModel?.model_name || activeModel?.model_name || '未设置'}</p>
          <p className="mt-1 text-xs text-[#6b86a4]">未单独设置时跟随主模型</p>
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
                  onChange={(event) => {
                    setDiscoveredModels([]);
                    setModelDiscoveryState({ status: 'idle', message: '' });
                    setNewModel((prev) => ({
                      ...prev,
                      mode: normalizeModelMode(event.target.value),
                      api_key_encrypted: normalizeModelMode(event.target.value) === 'local' ? '' : prev.api_key_encrypted,
                    }));
                  }}
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
                  onChange={(event) => {
                    setDiscoveredModels([]);
                    setModelDiscoveryState({ status: 'idle', message: '' });
                    setNewModel((prev) => ({ ...prev, provider: event.target.value as LlmProvider }));
                  }}
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
                  list="llm-discovered-models"
                  value={newModel.model_name}
                  onChange={(event) => setNewModel((prev) => ({ ...prev, model_name: event.target.value }))}
                  placeholder="例如：gpt-4.1-mini / kimi-k2 / deepseek-chat"
                  className="w-full rounded-2xl border border-[#d7e5f7] bg-white px-4 py-3 text-sm text-[#16355f] outline-none transition focus:border-[#6a9be0]"
                />
                {discoveredModels.length > 0 ? (
                  <datalist id="llm-discovered-models">
                    {discoveredModels.map((modelName) => (
                      <option key={modelName} value={modelName} />
                    ))}
                  </datalist>
                ) : null}
              </div>

              <div className="space-y-2">
                <label className="block text-sm font-medium text-[#24476b]">Base URL</label>
                <input
                  type="text"
                  value={newModel.base_url}
                  onChange={(event) => {
                    setDiscoveredModels([]);
                    setModelDiscoveryState({ status: 'idle', message: '' });
                    setNewModel((prev) => ({ ...prev, base_url: event.target.value }));
                  }}
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
                    onChange={(event) => {
                      setDiscoveredModels([]);
                      setModelDiscoveryState({ status: 'idle', message: '' });
                      setNewModel((prev) => ({ ...prev, api_key_encrypted: event.target.value }));
                    }}
                    placeholder="输入对应提供方的 API Key"
                    className="w-full rounded-2xl border border-[#d7e5f7] bg-white px-4 py-3 text-sm text-[#16355f] outline-none transition focus:border-[#6a9be0]"
                  />
                </div>
              ) : null}

              <div className="rounded-[20px] border border-[#d7e5f7] bg-white p-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="text-sm font-semibold text-[#16355f]">自动检测模型</p>
                    <p className="mt-1 text-xs text-[#6b86a4]">调用 OpenAI 兼容的 /models 接口，检测失败时仍可手动填写。</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => void handleDiscoverModels()}
                    disabled={modelDiscoveryState.status === 'running'}
                    className="inline-flex items-center justify-center gap-2 rounded-2xl border border-[#bfd5f5] bg-[#f7fbff] px-4 py-2.5 text-sm font-medium text-[#1f5fbf] transition hover:bg-[#edf4fd] disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {modelDiscoveryState.status === 'running' ? <Loader2 className="h-4 w-4 animate-spin" /> : <ListChecks className="h-4 w-4" />}
                    {modelDiscoveryState.status === 'running' ? '检测中...' : '检测模型'}
                  </button>
                </div>

                {modelDiscoveryState.status !== 'idle' ? (
                  <div
                    className={`mt-3 rounded-2xl border px-3 py-2 text-xs ${
                      modelDiscoveryState.status === 'success'
                        ? 'border-[#bfd5f5] bg-[#f7fbff] text-[#1f5fbf]'
                        : modelDiscoveryState.status === 'error'
                          ? 'border-rose-200 bg-rose-50 text-rose-600'
                          : 'border-[#d9e5f2] bg-[#fbfdff] text-[#6b86a4]'
                    }`}
                  >
                    {modelDiscoveryState.message}
                  </div>
                ) : null}

                {discoveredModels.length > 0 ? (
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {discoveredModels.slice(0, 8).map((modelName) => (
                      <button
                        key={modelName}
                        type="button"
                        onClick={() => setNewModel((prev) => ({ ...prev, model_name: modelName }))}
                        className="rounded-full border border-[#d7e5f7] bg-[#fbfdff] px-2.5 py-1 text-xs text-[#24476b] transition hover:border-[#6a9be0] hover:text-[#1f5fbf]"
                      >
                        {modelName}
                      </button>
                    ))}
                    {discoveredModels.length > 8 ? (
                      <span className="rounded-full border border-[#d7e5f7] bg-[#fbfdff] px-2.5 py-1 text-xs text-[#6b86a4]">
                        +{discoveredModels.length - 8}
                      </span>
                    ) : null}
                  </div>
                ) : null}
              </div>

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
