# Head Pose Proctoring v3 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Detect sustained head turns and looking down/up during interview proctoring, record explainable events, and show them in reports.

**Architecture:** Extend the existing browser proctoring hook with MediaPipe FaceLandmarker output while keeping the current FaceDetector path as fallback. Convert landmarks into approximate yaw/pitch signals, track timed events through the existing event pipeline, and reuse existing report timeline rendering through event metadata.

**Tech Stack:** React, TypeScript, Vite, `@mediapipe/tasks-vision`, Supabase storage/database, FastAPI report merge.

---

### Task 1: Add Head Pose Event Types

**Files:**
- Modify: `src/lib/interviewProctoring.ts`
- Modify: `backend/main.py`
- Modify: `tests/interview/interviewProctoring.test.ts`
- Modify: `tests/backend/test_interview_scoring.py`

- [ ] Add event types `head_turned_left`, `head_turned_right`, `head_down`, `head_up`, `face_occluded`.
- [ ] Set thresholds: head left/right/down/up at `3000ms`, face occluded at `1500ms`.
- [ ] Set severity: sustained head pose events are `medium` at threshold, `high` after `6000ms`; face occluded is `medium`.
- [ ] Add Chinese labels for frontend/backend report display.
- [ ] Update tests to assert thresholds and accepted backend event types.

### Task 2: Add FaceLandmarker Analyzer

**Files:**
- Modify: `src/hooks/useInterviewProctoring.ts`

- [ ] Extend detector adapter to prefer `FaceLandmarker.createFromOptions`.
- [ ] Enable `runningMode: "VIDEO"`, `numFaces: 3`, `outputFaceBlendshapes: false`, `outputFacialTransformationMatrixes: true`.
- [ ] Convert first face landmarks into a face box from normalized landmark min/max values.
- [ ] Estimate approximate pose:
  - yaw from nose tip horizontal offset against eye center and face width.
  - pitch from nose vertical offset against eye/mouth center.
  - roll from left/right eye slope.
- [ ] Fall back to existing FaceDetector adapter if landmarker load fails.

### Task 3: Track Head Pose Conditions

**Files:**
- Modify: `src/hooks/useInterviewProctoring.ts`
- Modify: `src/pages/InterviewRoom.tsx`

- [ ] Add `poseLabel` and `poseState` to the hook result.
- [ ] Trigger timed conditions:
  - `head_turned_left` when yaw is left beyond threshold.
  - `head_turned_right` when yaw is right beyond threshold.
  - `head_down` and `head_up` from pitch thresholds.
  - `face_occluded` when landmarks are missing or unreliable while a face box exists.
- [ ] Store metadata: `head_pose.yaw`, `head_pose.pitch`, `head_pose.roll`, `pose_signal`, `face_score`, `landmark_count`.
- [ ] Show candidate-facing text `请保持正对摄像头` for sustained head pose warnings.
- [ ] Keep labels outside the face box.

### Task 4: Report Timeline Details

**Files:**
- Modify: `backend/main.py`
- Modify: `src/pages/Interviews.tsx`
- Modify: `src/pages/InterviewRoom.tsx`

- [ ] Include `pose_signal` and `head_pose` fields in proctoring detail summaries.
- [ ] Render timeline details such as `头部向右偏转，yaw 32°，持续 4.2s`.
- [ ] Keep wording as `疑似查看屏幕外内容` or `长时间未正对摄像头`, never `作弊`.

### Task 5: Verification

**Files:**
- Test: `tests/interview/interviewProctoring.test.ts`
- Test: `tests/backend/test_interview_scoring.py`

- [ ] Run `npm run build`; expected: success.
- [ ] Run `npm run test:interview`; expected: all interview tests pass.
- [ ] Run `python -m unittest tests.backend.test_interview_scoring`; expected: all backend scoring tests pass.
- [ ] Restart frontend `5173` and backend `8010`.
