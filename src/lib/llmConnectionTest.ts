export type TestLlmProtocol = 'openai' | 'anthropic' | 'gemini';

export interface LlmConnectionConfig {
  apiProtocol: TestLlmProtocol;
  baseUrl: string | null;
  modelName: string;
  apiKey: string | null;
  apiVersion: string;
  timeoutMs: number;
  maxTokens: number;
  temperature: number;
}

export interface LlmConnectionTestResult {
  ok: boolean;
  latencyMs: number;
  preview: string;
  endpoint: string;
}

function ensureText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function toObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function openAiChatUrl(baseUrl: string | null): string {
  const fallback = 'https://api.openai.com/v1';
  const base = ensureText(baseUrl) || fallback;
  const normalized = base.endsWith('/') ? base.slice(0, -1) : base;
  if (normalized.endsWith('/chat/completions')) return normalized;
  if (normalized.endsWith('/v1')) return `${normalized}/chat/completions`;
  return `${normalized}/v1/chat/completions`;
}

function anthropicUrl(baseUrl: string | null): string {
  const fallback = 'https://api.anthropic.com/v1';
  const base = ensureText(baseUrl) || fallback;
  const normalized = base.endsWith('/') ? base.slice(0, -1) : base;
  if (normalized.endsWith('/v1/messages')) return normalized;
  if (normalized.endsWith('/v1')) return `${normalized}/messages`;
  return `${normalized}/v1/messages`;
}

function geminiUrl(baseUrl: string | null, modelName: string, apiKey: string | null): string {
  const fallback = 'https://generativelanguage.googleapis.com/v1beta';
  const base = ensureText(baseUrl) || fallback;
  let url = base.endsWith('/') ? base.slice(0, -1) : base;

  if (!url.includes(':generateContent')) {
    if (url.includes('/models/')) {
      url = `${url}:generateContent`;
    } else if (url.endsWith('/v1beta') || url.endsWith('/v1')) {
      url = `${url}/models/${modelName}:generateContent`;
    } else {
      url = `${url}/v1beta/models/${modelName}:generateContent`;
    }
  }

  if (apiKey && !url.includes('key=')) {
    url += `${url.includes('?') ? '&' : '?'}key=${encodeURIComponent(apiKey)}`;
  }

  return url;
}

async function readErrorBody(response: Response): Promise<string> {
  try {
    const text = await response.text();
    return text.slice(0, 280) || `HTTP ${response.status}`;
  } catch {
    return `HTTP ${response.status}`;
  }
}

function parseOpenAiPreview(raw: Record<string, unknown>): string {
  const choices = Array.isArray(raw.choices) ? (raw.choices as Array<Record<string, unknown>>) : [];
  const first = choices[0] ?? null;
  const message = toObject(first?.message);
  return ensureText(message?.content) || 'LLM returned empty content';
}

function parseAnthropicPreview(raw: Record<string, unknown>): string {
  const content = Array.isArray(raw.content) ? (raw.content as Array<Record<string, unknown>>) : [];
  return (
    content
      .map((part) => ensureText(part.text))
      .filter(Boolean)
      .join('\n') || 'LLM returned empty content'
  );
}

function parseGeminiPreview(raw: Record<string, unknown>): string {
  const candidates = Array.isArray(raw.candidates) ? (raw.candidates as Array<Record<string, unknown>>) : [];
  const first = candidates[0] ?? null;
  const content = toObject(first?.content);
  const parts = Array.isArray(content?.parts) ? (content.parts as Array<Record<string, unknown>>) : [];
  return (
    parts
      .map((part) => ensureText(part.text))
      .filter(Boolean)
      .join('\n') || 'LLM returned empty content'
  );
}

export async function testLlmConnection(config: LlmConnectionConfig): Promise<LlmConnectionTestResult> {
  const protocol = config.apiProtocol;
  const modelName = ensureText(config.modelName);

  if (!modelName) {
    throw new Error('Model name is required');
  }

  const controller = new AbortController();
  const timeoutMs = Math.max(5000, Math.min(180000, config.timeoutMs || 45000));
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const startedAt = Date.now();

  try {
    if (protocol === 'anthropic') {
      if (!config.apiKey) {
        throw new Error('Anthropic protocol requires API key');
      }

      const endpoint = anthropicUrl(config.baseUrl);
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': config.apiKey,
          'anthropic-version': ensureText(config.apiVersion) || '2023-06-01'
        },
        body: JSON.stringify({
          model: modelName,
          max_tokens: Math.max(64, Math.min(8192, config.maxTokens || 256)),
          temperature: Math.max(0, Math.min(2, config.temperature || 0)),
          messages: [{ role: 'user', content: 'Return a short string: OK' }]
        }),
        signal: controller.signal
      });

      if (!response.ok) {
        throw new Error(await readErrorBody(response));
      }

      const raw = (await response.json()) as Record<string, unknown>;
      const preview = parseAnthropicPreview(raw);
      return {
        ok: true,
        latencyMs: Date.now() - startedAt,
        preview: preview.slice(0, 180),
        endpoint
      };
    }

    if (protocol === 'gemini') {
      const endpoint = geminiUrl(config.baseUrl, modelName, config.apiKey);
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          contents: [
            {
              role: 'user',
              parts: [{ text: 'Return a short string: OK' }]
            }
          ],
          generationConfig: {
            temperature: Math.max(0, Math.min(2, config.temperature || 0)),
            maxOutputTokens: Math.max(64, Math.min(8192, config.maxTokens || 256))
          }
        }),
        signal: controller.signal
      });

      if (!response.ok) {
        throw new Error(await readErrorBody(response));
      }

      const raw = (await response.json()) as Record<string, unknown>;
      const preview = parseGeminiPreview(raw);
      return {
        ok: true,
        latencyMs: Date.now() - startedAt,
        preview: preview.slice(0, 180),
        endpoint
      };
    }

    const endpoint = openAiChatUrl(config.baseUrl);
    const headers: Record<string, string> = {
      'Content-Type': 'application/json'
    };
    if (config.apiKey) {
      headers.Authorization = `Bearer ${config.apiKey}`;
    }

    const response = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: modelName,
        temperature: Math.max(0, Math.min(2, config.temperature || 0)),
        max_tokens: Math.max(64, Math.min(8192, config.maxTokens || 256)),
        messages: [{ role: 'user', content: 'Return a short string: OK' }]
      }),
      signal: controller.signal
    });

    if (!response.ok) {
      throw new Error(await readErrorBody(response));
    }

    const raw = (await response.json()) as Record<string, unknown>;
    const preview = parseOpenAiPreview(raw);
    return {
      ok: true,
      latencyMs: Date.now() - startedAt,
      preview: preview.slice(0, 180),
      endpoint
    };
  } finally {
    clearTimeout(timeout);
  }
}
