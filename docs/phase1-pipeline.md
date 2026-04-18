# Phase 1 Resume Pipeline (RecruitPro)

## Scope

Phase 1 delivers an end-to-end chain:

1. Resume upload
2. Text extraction
3. Profile / project / skill structuring
4. Position matching with explainable output
5. Candidate + match persistence

## Current runtime path

1. `screening` page sends file + position payload to `POST /api/screening/phase1`
2. FastAPI creates `resume_uploads` row
3. FastAPI uploads the file into Supabase Storage
4. FastAPI executes text extraction / OCR fallback / phase1 matching
5. FastAPI writes:
   - `parsed_resume_profiles`
   - `parsed_resume_projects`
   - `parsed_job_requirements` (bootstrap if absent)
   - `candidate_position_matches`
   - `candidates`
6. `resume_uploads` moves through:
   - `uploaded`
   - `text_extraction`
   - `profile_extraction`
   - `matching`
   - `completed | failed`

## Key tables

- `resume_uploads`: workflow status, errors, parsed payload pointer
- `parsed_resume_profiles`: normalized profile + confidence + raw payload
- `parsed_resume_projects`: project-level structured records
- `parsed_job_requirements`: structured JD requirements
- `candidate_position_matches`: explainable scoring output

## UI surfaces

- `screening`: live stage status + recent jobs + list by score bins
- `candidate detail`: explainable sections
  - overall score / recommendation / confidence
  - matched vs missing skills
  - requirement breakdown (`met/not_met/unknown`)
  - evidence spans
  - matched projects + risk flags

## Verification checklist

1. Run migration `202604010008_phase1_resume_matching_pipeline.sql`
2. Start FastAPI backend
3. Upload 1 PDF / DOCX in screening
4. Confirm `resume_uploads.pipeline_stage` transitions
5. Confirm rows created in all Phase 1 tables
6. Open candidate detail and verify explainable blocks render

## LLM / OCR notes

- current frontend no longer runs the browser-side phase1 fallback
- FastAPI is responsible for OCR fallback and phase1 persistence
- external model routing remains a backend concern, not a browser concern
