alter table public.company_settings
  add column if not exists llm_provider text not null default 'custom'
    check (llm_provider in ('custom','openai','anthropic','google','deepseek','openrouter','ollama','vllm','zhipu','moonshot')),
  add column if not exists llm_api_protocol text not null default 'openai'
    check (llm_api_protocol in ('openai','anthropic','gemini')),
  add column if not exists llm_api_version text not null default '2023-06-01',
  add column if not exists llm_max_tokens integer not null default 2048 check (llm_max_tokens between 128 and 8192);

update public.company_settings
set llm_api_protocol = case llm_provider
  when 'anthropic' then 'anthropic'
  when 'google' then 'gemini'
  else coalesce(llm_api_protocol, 'openai')
end
where llm_api_protocol is null or llm_api_protocol = '';
