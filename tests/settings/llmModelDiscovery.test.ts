import assert from 'node:assert/strict';
import { buildOpenAiModelListUrls, parseOpenAiModelList, fetchOpenAiCompatibleModels } from '../../src/lib/llmModelDiscovery.ts';

assert.deepEqual(buildOpenAiModelListUrls('https://api.example.com/v1'), ['https://api.example.com/v1/models']);
assert.deepEqual(buildOpenAiModelListUrls('https://api.example.com'), [
  'https://api.example.com/models',
  'https://api.example.com/v1/models',
]);

assert.deepEqual(
  parseOpenAiModelList({
    data: [
      { id: 'deepseek-chat' },
      { id: 'deepseek-reasoner' },
      { id: '' },
      { name: 'ignored-name' },
      { id: 'deepseek-chat' },
    ],
  }),
  ['deepseek-chat', 'deepseek-reasoner']
);

const requestedUrls: string[] = [];
const originalFetch = globalThis.fetch;
globalThis.fetch = (async (url: RequestInfo | URL) => {
  requestedUrls.push(String(url));
  if (String(url) === 'https://api.moonshot.cn/models') {
    return new Response('not found', { status: 404 });
  }
  return Response.json({ data: [{ id: 'kimi-k2' }, { id: 'moonshot-v1-8k' }] });
}) as typeof fetch;

try {
  const result = await fetchOpenAiCompatibleModels({
    baseUrl: 'https://api.moonshot.cn',
    apiKey: 'test-key',
    timeoutMs: 5000,
  });

  assert.deepEqual(requestedUrls, ['https://api.moonshot.cn/models', 'https://api.moonshot.cn/v1/models']);
  assert.deepEqual(result.models, ['kimi-k2', 'moonshot-v1-8k']);
  assert.equal(result.endpoint, 'https://api.moonshot.cn/v1/models');
} finally {
  globalThis.fetch = originalFetch;
}

console.log('llmModelDiscovery tests passed');
