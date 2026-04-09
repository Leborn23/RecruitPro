# Phase 1 Resume Pipeline (RecruitPro)

## Scope
Phase 1 delivers an end-to-end chain:
1. Resume upload
2. Text extraction
3. Profile/project/skill structuring
4. Position matching with explainable output
5. Candidate + match persistence

## Data Flow
1. `screening` page uploads file to `storage.bucket: resume-files`
2. create `resume_uploads` row (`status=processing`, `pipeline_stage=uploaded`)
3. update stages: `text_extraction -> profile_extraction -> matching -> completed|failed`
4. write:
   - `parsed_resume_profiles`
   - `parsed_resume_projects`
   - `parsed_job_requirements` (bootstrap if absent)
   - `candidate_position_matches`
   - `candidates` (summary fields for list/detail compatibility)

## Key Tables
- `resume_uploads`: workflow status, errors, parsed payload pointer
- `parsed_resume_profiles`: normalized profile + confidence + raw payload
- `parsed_resume_projects`: project-level structured records
- `parsed_job_requirements`: structured JD requirements
- `candidate_position_matches`: explainable scoring output

## UI Surfaces
- `screening`: live stage status + recent jobs + list by score bins
- `candidate detail`: explainable sections
  - overall score / recommendation / confidence
  - matched vs missing skills
  - requirement breakdown (`met/not_met/unknown`)
  - evidence spans (non-black-box)
  - matched projects + risk flags

## Verification Checklist
1. Run migration `202604010008_phase1_resume_matching_pipeline.sql`
2. Upload 1 PDF/DOCX in screening
3. Confirm `resume_uploads.pipeline_stage` transitions
4. Confirm rows created in all Phase 1 tables
5. Open candidate detail and verify explainable blocks render

## LLM Mode
- `llm_mode=bootstrap`: pure rule-based extraction/matching fallback
- `llm_mode=local`: call local model service
- `llm_mode=api_key`: call cloud service with API key

## Universal LLM Adapter
- `llm_provider`: custom/openai/anthropic/google/deepseek/openrouter/ollama/vllm/zhipu/moonshot
- `llm_model_name`: target model id
- `llm_base_url`: provider endpoint root (or custom local endpoint)
- `llm_api_key`: required in non-local cloud mode

Protocol mapping in pipeline (auto by provider):
- `openai`: Chat Completions
- `anthropic`: Messages API
- `gemini`: GenerateContent API

Optional env overrides:
- `VITE_LLM_MODE`
- `VITE_LLM_PROVIDER`
- `VITE_LLM_BASE_URL`
- `VITE_LLM_MODEL`
- `VITE_LLM_API_KEY`
- `VITE_LLM_API_VERSION`
- `VITE_LLM_MAX_TOKENS`
- `VITE_LLM_TEMPERATURE`
- `VITE_LLM_TIMEOUT_MS`
