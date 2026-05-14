export interface FetchOpenAiCompatibleModelsOptions {
  baseUrl: string;
  apiKey?: string | null;
  timeoutMs?: number;
}

export interface FetchOpenAiCompatibleModelsResult {
  models: string[];
  endpoint: string;
}

const ensureText = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

const stripTrailingSlash = (value: string): string => value.replace(/\/+$/, '');

export function buildOpenAiModelListUrls(baseUrl: string): string[] {
  const normalized = stripTrailingSlash(ensureText(baseUrl));
  if (!normalized) return [];
  if (normalized.endsWith('/models')) return [normalized];
  if (normalized.endsWith('/v1')) return [`${normalized}/models`];
  return [`${normalized}/models`, `${normalized}/v1/models`];
}

export function parseOpenAiModelList(raw: unknown): string[] {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return [];
  const data = (raw as { data?: unknown }).data;
  if (!Array.isArray(data)) return [];

  const seen = new Set<string>();
  const models: string[] = [];

  for (const item of data) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    const id = ensureText((item as { id?: unknown }).id);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    models.push(id);
  }

  return models;
}

async function readError(response: Response): Promise<string> {
  try {
    const text = await response.text();
    return text.slice(0, 240) || `HTTP ${response.status}`;
  } catch {
    return `HTTP ${response.status}`;
  }
}

export async function fetchOpenAiCompatibleModels(
  options: FetchOpenAiCompatibleModelsOptions
): Promise<FetchOpenAiCompatibleModelsResult> {
  const urls = buildOpenAiModelListUrls(options.baseUrl);
  if (urls.length === 0) {
    throw new Error('请先填写 Base URL');
  }

  const timeoutMs = Math.max(5000, Math.min(60000, options.timeoutMs ?? 15000));
  const apiKey = ensureText(options.apiKey);
  let lastError = '';

  for (const endpoint of urls) {
    const controller = new AbortController();
    const timeout = globalThis.setTimeout(() => controller.abort(), timeoutMs);

    try {
      const headers: Record<string, string> = { Accept: 'application/json' };
      if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

      const response = await fetch(endpoint, {
        method: 'GET',
        headers,
        signal: controller.signal,
      });

      if (!response.ok) {
        lastError = await readError(response);
        continue;
      }

      const raw = await response.json();
      const models = parseOpenAiModelList(raw);
      if (models.length === 0) {
        lastError = '接口返回成功，但没有发现模型名称';
        continue;
      }

      return { models, endpoint };
    } catch (error) {
      lastError = error instanceof Error ? error.message : '模型列表请求失败';
    } finally {
      globalThis.clearTimeout(timeout);
    }
  }

  throw new Error(lastError || '该服务未开放模型列表，请手动填写模型名称');
}
