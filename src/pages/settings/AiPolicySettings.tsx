import { useEffect, useMemo, useState } from 'react';
import { Sliders, Trash2, Wifi } from 'lucide-react';
import { useSettingsCenterContext } from './context';
import { supabase } from '../../lib/supabase';
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
  { value: 'custom', label: '自定义（OpenAI兼容）' },
  { value: 'openai', label: 'OpenAI' },
  { value: 'anthropic', label: 'Anthropic' },
  { value: 'google', label: 'Google Gemini' },
  { value: 'deepseek', label: 'DeepSeek（深度求索）' },
  { value: 'openrouter', label: 'OpenRouter' },
  { value: 'ollama', label: 'Ollama（本地）' },
  { value: 'vllm', label: 'vLLM（本地）' },
  { value: 'zhipu', label: '智谱 AI' },
  { value: 'moonshot', label: 'Moonshot / Kimi' }
];

const STRATEGY_OPTIONS: Array<{ value: LlmStrategyMode; label: string; description: string }> = [
  { value: 'quality', label: '质量优先', description: '优先稳定和准确，必要时自动重试一次。' },
  { value: 'balanced', label: '平衡（推荐）', description: '在效果、响应时间和成本之间保持平衡。' },
  { value: 'cost', label: '成本优先', description: '尽量减少重试，优先控制调用成本。' }
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
    api_key_encrypted: ''
  };
}

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
    return <div className="p-12 text-center text-on-surface-variant animate-pulse">正在加载 AI 策略设置...</div>;
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
      is_active: true
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
      base_url: prev.base_url
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
      setTestState({ status: 'error', message: '当前模型缺少 API Key，无法连接测试。' });
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
      temperature: Number(activeModel.temperature ?? 0.2)
    };

    try {
      setTestState({ status: 'running', message: `正在测试模型 ${activeModel.model_name}...` });
      const result = await testLlmConnection(config);
      setTestState({
        status: 'success',
        message: `连接成功（${result.latencyMs}ms）。响应预览：${result.preview || 'OK'}`
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : '未知连接错误';
      setTestState({ status: 'error', message });
    }
  };

  const handleSaveSimpleStrategy = async (patch: Partial<{ llm_retry_enabled: boolean; llm_strategy_mode: LlmStrategyMode }>) => {
    setSaveMessage(null);
    setModelsError(null);
    await updateSettings(patch);
    setSaveMessage('AI 自动策略已保存。');
  };

  return (
    <section className="bg-surface-container-lowest border border-outline-variant/15 rounded-xl p-6 shadow-sm space-y-6">
      <h3 className="text-base font-medium text-on-surface flex items-center gap-2 border-b border-outline-variant/10 pb-4">
        <Sliders className="w-5 h-5 text-primary" /> AI 与筛选策略
      </h3>

      {syncError && (
        <div className="rounded-lg border border-error/20 bg-error/8 px-4 py-3 text-sm text-error">
          设置同步失败：{syncError}
        </div>
      )}

      {modelsError && (
        <div className="rounded-lg border border-error/20 bg-error/8 px-4 py-3 text-sm text-error">{modelsError}</div>
      )}

      {saveMessage && (
        <div className="rounded-lg border border-primary/20 bg-primary/8 px-4 py-3 text-sm text-primary">{saveMessage}</div>
      )}

      <div className="space-y-2 md:max-w-xl">
        <label className="text-sm font-medium text-on-surface block">当前生效模型（仅显示已添加）</label>
        <select
          value={activeModelId ?? ''}
          onChange={(event) => void handleSelectActiveModel(event.target.value)}
          disabled={modelsLoading || models.length === 0}
          className="w-full bg-surface-container border border-outline-variant/20 rounded-md px-4 py-2.5 text-sm outline-none focus:border-primary transition-colors cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed"
        >
          <option value="">{models.length === 0 ? '暂无模型，请先添加' : '请选择生效模型'}</option>
          {models.map((item) => (
            <option key={item.id} value={item.id}>
              {item.model_name}
            </option>
          ))}
        </select>
        <p className="text-xs text-on-surface-variant">只会显示你在下方添加的模型，不提供内置假模型。</p>
      </div>

      <div className="space-y-2 md:max-w-xl">
        <label className="text-sm font-medium text-on-surface block">面试 Agent 模型</label>
        <select
          value={interviewAgentModelId ?? ''}
          onChange={(event) => void handleSelectInterviewAgentModel(event.target.value)}
          disabled={modelsLoading || models.length === 0}
          className="w-full bg-surface-container border border-outline-variant/20 rounded-md px-4 py-2.5 text-sm outline-none focus:border-primary transition-colors cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed"
        >
          <option value="">{models.length === 0 ? '暂无模型，请先添加' : '跟随上方默认模型'}</option>
          {models.map((item) => (
            <option key={item.id} value={item.id}>
              {item.model_name}
            </option>
          ))}
        </select>
        <p className="text-xs text-on-surface-variant">仅影响面试 Agent。留空时会复用上方默认模型。</p>
        {interviewAgentModel && (
          <div className="text-xs text-on-surface-variant">
            当前 Agent 使用：{interviewAgentModel.model_name} / {interviewAgentModel.provider}
          </div>
        )}
      </div>

      {activeModel && (
        <div className="md:max-w-xl space-y-2">
          <div className="text-xs text-on-surface-variant">
            已生效：{activeModel.model_name} · {activeModel.provider} · {normalizeModelMode(activeModel.mode) === 'local' ? '本地模型' : '云端 / API Key'}
          </div>
          <button
            type="button"
            onClick={() => void handleTestConnection()}
            disabled={testState.status === 'running'}
            className="cursor-pointer px-4 py-2.5 rounded-md text-sm font-medium bg-primary text-white hover:bg-primary/90 disabled:opacity-60 disabled:cursor-not-allowed inline-flex items-center gap-2"
          >
            <Wifi className="w-4 h-4" />
            {testState.status === 'running' ? '连接测试中...' : '测试当前模型连接'}
          </button>

          {testState.status !== 'idle' && (
            <div
              className={`text-xs rounded-md px-3 py-2 border ${
                testState.status === 'success'
                  ? 'border-primary/30 bg-primary/10 text-primary'
                  : testState.status === 'error'
                    ? 'border-error/30 bg-error/10 text-error'
                    : 'border-outline-variant/20 bg-surface-container text-on-surface-variant'
              }`}
            >
              {testState.message}
            </div>
          )}
        </div>
      )}

      <div className="border-t border-outline-variant/10 pt-6 space-y-4 md:max-w-xl">
        <h4 className="text-sm font-semibold text-on-surface">自动策略（极简）</h4>

        <label className="inline-flex items-center gap-2 text-sm text-on-surface cursor-pointer select-none">
          <input
            type="checkbox"
            checked={retryEnabled}
            onChange={(event) => void handleSaveSimpleStrategy({ llm_retry_enabled: event.target.checked })}
            className="w-4 h-4 cursor-pointer accent-primary"
          />
          自动重试（模型失败或结果不稳定时自动再试一次）
        </label>

        <div className="space-y-2">
          <label className="text-sm font-medium text-on-surface block">策略模式</label>
          <select
            value={strategyMode}
            onChange={(event) => void handleSaveSimpleStrategy({ llm_strategy_mode: normalizeStrategyMode(event.target.value) })}
            className="w-full bg-surface-container border border-outline-variant/20 rounded-md px-4 py-2.5 text-sm outline-none focus:border-primary transition-colors cursor-pointer"
          >
            {STRATEGY_OPTIONS.map((item) => (
              <option key={item.value} value={item.value}>
                {item.label}
              </option>
            ))}
          </select>
          <p className="text-xs text-on-surface-variant">
            {STRATEGY_OPTIONS.find((x) => x.value === strategyMode)?.description ?? '在效果、速度和成本之间平衡。'}
          </p>
        </div>
      </div>

      <div className="border-t border-outline-variant/10 pt-6 space-y-4">
        <h4 className="text-sm font-semibold text-on-surface">添加模型</h4>

        <div className="space-y-2 md:max-w-xl">
          <label className="text-sm font-medium text-on-surface block">模型运行模式</label>
          <select
            value={newModel.mode}
            onChange={(event) =>
              setNewModel((prev) => ({
                ...prev,
                mode: normalizeModelMode(event.target.value),
                api_key_encrypted: normalizeModelMode(event.target.value) === 'local' ? '' : prev.api_key_encrypted
              }))
            }
            className="w-full bg-surface-container border border-outline-variant/20 rounded-md px-4 py-2.5 text-sm outline-none focus:border-primary transition-colors cursor-pointer"
          >
            <option value="local">本地模型</option>
            <option value="api_key">云端 / API Key</option>
          </select>
        </div>

        <div className="space-y-2 md:max-w-xl">
          <label className="text-sm font-medium text-on-surface block">模型提供商</label>
          <select
            value={newModel.provider}
            onChange={(event) => setNewModel((prev) => ({ ...prev, provider: event.target.value as LlmProvider }))}
            className="w-full bg-surface-container border border-outline-variant/20 rounded-md px-4 py-2.5 text-sm outline-none focus:border-primary transition-colors cursor-pointer"
          >
            {PROVIDER_OPTIONS.map((item) => (
              <option key={item.value} value={item.value}>
                {item.label}
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-2 md:max-w-xl">
          <label className="text-sm font-medium text-on-surface block">模型名称（model_name）</label>
          <input
            type="text"
            value={newModel.model_name}
            onChange={(event) => setNewModel((prev) => ({ ...prev, model_name: event.target.value }))}
            placeholder="例如：moonshot-v1-8k / kimi-k2 / glm-4-air / deepseek-chat"
            className="w-full bg-surface-container border border-outline-variant/20 rounded-md px-4 py-2.5 text-sm outline-none focus:border-primary transition-colors"
          />
        </div>

        <div className="space-y-2 md:max-w-xl">
          <label className="text-sm font-medium text-on-surface block">Base URL / 接口地址</label>
          <input
            type="text"
            value={newModel.base_url}
            onChange={(event) => setNewModel((prev) => ({ ...prev, base_url: event.target.value }))}
            placeholder="如：http://127.0.0.1:11434/v1 或 https://api.moonshot.cn/v1"
            className="w-full bg-surface-container border border-outline-variant/20 rounded-md px-4 py-2.5 text-sm outline-none focus:border-primary transition-colors"
          />
        </div>

        {newModel.mode === 'api_key' && (
          <div className="space-y-2 md:max-w-xl">
            <label className="text-sm font-medium text-on-surface block">模型 API Key</label>
            <input
              type="password"
              value={newModel.api_key_encrypted}
              onChange={(event) => setNewModel((prev) => ({ ...prev, api_key_encrypted: event.target.value }))}
              placeholder="输入对应提供商的 API Key"
              className="w-full bg-surface-container border border-outline-variant/20 rounded-md px-4 py-2.5 text-sm outline-none focus:border-primary transition-colors"
            />
          </div>
        )}

        <button
          type="button"
          onClick={() => void handleCreateModel()}
          disabled={isSavingModel}
          className="cursor-pointer px-4 py-2.5 rounded-md text-sm font-medium bg-primary text-white hover:bg-primary/90 disabled:opacity-60 disabled:cursor-not-allowed"
        >
          {isSavingModel ? '保存中...' : '添加模型'}
        </button>
      </div>

      <div className="border-t border-outline-variant/10 pt-6 space-y-3">
        <h4 className="text-sm font-semibold text-on-surface">已添加模型</h4>
        {models.length === 0 ? (
          <p className="text-sm text-on-surface-variant">暂无已添加模型。</p>
        ) : (
          <div className="space-y-2">
            {models.map((item) => (
              <div
                key={item.id}
                className="rounded-md border border-outline-variant/20 bg-surface-container px-3 py-2 flex items-center justify-between gap-3"
              >
                <div>
                  <p className="text-sm font-medium text-on-surface">{item.model_name}</p>
                  <p className="text-xs text-on-surface-variant">
                    {item.provider} · {normalizeModelMode(item.mode) === 'local' ? '本地模型' : '云端 / API Key'}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {item.id === activeModelId ? (
                    <span className="text-xs px-2 py-1 rounded bg-primary/10 text-primary">当前生效</span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => void handleSelectActiveModel(item.id)}
                      className="cursor-pointer text-xs px-2.5 py-1.5 rounded border border-outline-variant/30 hover:bg-surface"
                    >
                      设为生效
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => void handleDeleteModel(item)}
                    className="cursor-pointer text-xs px-2.5 py-1.5 rounded border border-error/30 text-error hover:bg-error/10 inline-flex items-center gap-1"
                  >
                    <Trash2 className="w-3 h-3" />
                    删除
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
