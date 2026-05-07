import { useCallback, useEffect, useRef, useState, type Dispatch, type RefCallback, type SetStateAction } from 'react';
import {
  buildSnapshotPath,
  deriveProctoringSeverity,
  isScreenSwitchEvent,
  resolveTimedEventSession,
  shouldOpenTimedEvent,
  uploadProctoringSnapshot,
  type ProctoringEventInput,
  type ProctoringEventType,
} from '../lib/interviewProctoring.ts';
import { interviewRuntimeEdge } from '../lib/interviewRuntime.ts';

export type InterviewProctoringStatus = 'idle' | 'requesting' | 'ready' | 'warning' | 'blocked' | 'error';

export type UseInterviewProctoringParams = {
  interviewId: string;
  sessionId: string | null;
  enabled: boolean;
};

export type UseInterviewProctoringResult = {
  videoRef: RefCallback<HTMLVideoElement>;
  status: InterviewProctoringStatus;
  statusText: string;
  faceBox: ProctoringFaceBox | null;
  screenSwitch: ProctoringScreenSwitchState;
  consented: boolean;
  setConsented: Dispatch<SetStateAction<boolean>>;
  start: (options?: { assumeConsent?: boolean }) => Promise<void>;
  stop: () => Promise<void>;
  flushEvents: () => Promise<void>;
};

export type ProctoringFaceBox = {
  x: number;
  y: number;
  width: number;
  height: number;
  state: 'normal' | 'warning';
  label: string;
};

export type ProctoringScreenSwitchState = {
  active: boolean;
  type: Extract<ProctoringEventType, 'page_hidden' | 'window_blur'> | null;
  startedAt: string | null;
  lastDurationMs: number;
  eventCount: number;
  totalDurationMs: number;
  statusText: string;
};

type DetectedFace = {
  box?: unknown;
  keypoints?: unknown[];
  score?: number;
  landmarks?: FaceLandmark[];
  pose?: HeadPose;
};

type FaceLandmark = {
  x: number;
  y: number;
  z?: number;
  visibility?: number;
};

type HeadPose = {
  yaw: number;
  pitch: number;
  roll: number;
};

type FaceBounds = {
  xMin: number;
  yMin: number;
  xMax: number;
  yMax: number;
};

type Detector = {
  estimateFaces: (video: HTMLVideoElement, config?: { flipHorizontal?: boolean }) => Promise<DetectedFace[]>;
  dispose: () => void;
  reset: () => void;
};

type ActiveTimedEvent = {
  sessionId: string | null;
  startedAt: string;
  startedMs: number;
  metadata: Record<string, unknown>;
  snapshotPaths: string[];
  snapshotError?: string;
  snapshotPromise?: Promise<void>;
};

const POLL_INTERVAL_MS = 300;
const IMMEDIATE_EVENT_TYPES = new Set<ProctoringEventType>(['camera_closed']);
const HEAD_YAW_THRESHOLD = 28;
const HEAD_PITCH_DOWN_THRESHOLD = -16;
const HEAD_PITCH_UP_THRESHOLD = 18;
const CONSENT_STORAGE_PREFIX = 'recruitpro:interview-proctoring-consent:';

function getConsentStorageKey(interviewId: string): string {
  return `${CONSENT_STORAGE_PREFIX}${interviewId}`;
}

function readStoredConsent(interviewId: string): boolean {
  if (typeof window === 'undefined') return false;

  try {
    return window.localStorage.getItem(getConsentStorageKey(interviewId)) === 'true';
  } catch {
    return false;
  }
}

function writeStoredConsent(interviewId: string, value: boolean): void {
  if (typeof window === 'undefined') return;

  try {
    window.localStorage.setItem(getConsentStorageKey(interviewId), value ? 'true' : 'false');
  } catch {
    // Local storage can be disabled; in-memory consent still works for the current page.
  }
}

function resolveErrorMessage(error: unknown, fallback: string): string {
  if (error && typeof error === 'object' && 'message' in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === 'string' && message.trim()) {
      return message;
    }
  }

  return fallback;
}

function getFirstVideoTrack(stream: MediaStream | null): MediaStreamTrack | null {
  return stream?.getVideoTracks()[0] ?? null;
}

function stopStream(stream: MediaStream | null): void {
  stream?.getTracks().forEach((track) => {
    track.stop();
  });
}

function shouldCommitTimedEvent(type: ProctoringEventType, durationMs: number): boolean {
  return IMMEDIATE_EVENT_TYPES.has(type) || shouldOpenTimedEvent(type, durationMs);
}

function isVisualEvent(type: ProctoringEventType): boolean {
  return type !== 'page_hidden' && type !== 'window_blur';
}

function getScreenSwitchStatusText(
  type: ProctoringScreenSwitchState['type'],
  durationMs: number
): string {
  if (type === 'page_hidden') {
    return `检测到离开考试页面 ${Math.round(durationMs / 1000)} 秒`;
  }
  if (type === 'window_blur') {
    return `检测到窗口失焦 ${Math.round(durationMs / 1000)} 秒`;
  }
  return '切屏监控正常';
}

function toFiniteNumber(value: unknown): number | null {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function readFaceBounds(face: DetectedFace): FaceBounds | null {
  if (face.box && typeof face.box === 'object') {
    const box = face.box as Record<string, unknown>;
    const xMin = toFiniteNumber(box.xMin ?? box.x);
    const yMin = toFiniteNumber(box.yMin ?? box.y);
    const width = toFiniteNumber(box.width);
    const height = toFiniteNumber(box.height);
    const xMax = toFiniteNumber(box.xMax) ?? (xMin !== null && width !== null ? xMin + width : null);
    const yMax = toFiniteNumber(box.yMax) ?? (yMin !== null && height !== null ? yMin + height : null);

    if (xMin !== null && yMin !== null && xMax !== null && yMax !== null && xMax > xMin && yMax > yMin) {
      return { xMin, yMin, xMax, yMax };
    }
  }

  const keypoints = Array.isArray(face.keypoints) ? face.keypoints : [];
  const points = keypoints
    .map((point) => {
      if (!point || typeof point !== 'object') return null;
      const source = point as Record<string, unknown>;
      const x = toFiniteNumber(source.x);
      const y = toFiniteNumber(source.y);
      return x !== null && y !== null ? { x, y } : null;
    })
    .filter((point): point is { x: number; y: number } => point !== null);

  if (points.length === 0) return null;

  return {
    xMin: Math.min(...points.map((point) => point.x)),
    yMin: Math.min(...points.map((point) => point.y)),
    xMax: Math.max(...points.map((point) => point.x)),
    yMax: Math.max(...points.map((point) => point.y)),
  };
}

function readLandmark(landmarks: FaceLandmark[], index: number): FaceLandmark | null {
  const landmark = landmarks[index];
  if (!landmark) return null;

  const x = toFiniteNumber(landmark.x);
  const y = toFiniteNumber(landmark.y);
  if (x === null || y === null) return null;

  return {
    x,
    y,
    z: toFiniteNumber(landmark.z) ?? undefined,
    visibility: toFiniteNumber(landmark.visibility) ?? undefined,
  };
}

function estimateHeadPose(landmarks: FaceLandmark[]): HeadPose | null {
  const leftEye = readLandmark(landmarks, 33);
  const rightEye = readLandmark(landmarks, 263);
  const nose = readLandmark(landmarks, 1);
  const mouthLeft = readLandmark(landmarks, 61);
  const mouthRight = readLandmark(landmarks, 291);
  if (!leftEye || !rightEye || !nose || !mouthLeft || !mouthRight) return null;

  const eyeCenterX = (leftEye.x + rightEye.x) / 2;
  const eyeCenterY = (leftEye.y + rightEye.y) / 2;
  const mouthCenterY = (mouthLeft.y + mouthRight.y) / 2;
  const eyeDistance = Math.max(0.001, Math.abs(rightEye.x - leftEye.x));
  const eyeToMouth = Math.max(0.001, mouthCenterY - eyeCenterY);

  const yaw = ((nose.x - eyeCenterX) / eyeDistance) * 55;
  const noseVerticalRatio = (nose.y - eyeCenterY) / eyeToMouth;
  const pitch = (0.48 - noseVerticalRatio) * 70;
  const roll = Math.atan2(rightEye.y - leftEye.y, rightEye.x - leftEye.x) * (180 / Math.PI);

  return {
    yaw: Number(yaw.toFixed(1)),
    pitch: Number(pitch.toFixed(1)),
    roll: Number(roll.toFixed(1)),
  };
}

function landmarksToFace(landmarks: FaceLandmark[], frameWidth: number, frameHeight: number): DetectedFace | null {
  const points = landmarks
    .map((landmark) => {
      const x = toFiniteNumber(landmark.x);
      const y = toFiniteNumber(landmark.y);
      return x !== null && y !== null ? { x: x * frameWidth, y: y * frameHeight } : null;
    })
    .filter((point): point is { x: number; y: number } => point !== null);

  if (points.length === 0) return null;

  const xMin = Math.min(...points.map((point) => point.x));
  const yMin = Math.min(...points.map((point) => point.y));
  const xMax = Math.max(...points.map((point) => point.x));
  const yMax = Math.max(...points.map((point) => point.y));

  return {
    box: {
      xMin,
      yMin,
      xMax,
      yMax,
      width: xMax - xMin,
      height: yMax - yMin,
    },
    landmarks,
    pose: estimateHeadPose(landmarks) ?? undefined,
  };
}

function buildHeadPoseMetadata(face: DetectedFace | undefined): Record<string, unknown> {
  if (!face?.pose) return {};

  return {
    head_pose: {
      yaw: face.pose.yaw,
      pitch: face.pose.pitch,
      roll: face.pose.roll,
    },
    landmark_count: face.landmarks?.length ?? null,
  };
}

function getPoseSignal(face: DetectedFace | undefined): {
  signal: ProctoringEventType | null;
  label: string;
  metadata: Record<string, unknown>;
} {
  const metadata = buildHeadPoseMetadata(face);
  if (!face) {
    return { signal: null, label: '人脸已锁定', metadata };
  }

  if (face.landmarks && (!face.pose || face.landmarks.length < 120)) {
    return {
      signal: 'face_occluded',
      label: '人脸关键点遮挡',
      metadata: { ...metadata, pose_signal: 'face_occluded' },
    };
  }

  const pose = face.pose;
  if (!pose) {
    return { signal: null, label: '人脸已锁定', metadata };
  }

  if (pose.yaw <= -HEAD_YAW_THRESHOLD) {
    return {
      signal: 'head_turned_left',
      label: '头部偏左',
      metadata: { ...metadata, pose_signal: 'head_turned_left' },
    };
  }

  if (pose.yaw >= HEAD_YAW_THRESHOLD) {
    return {
      signal: 'head_turned_right',
      label: '头部偏右',
      metadata: { ...metadata, pose_signal: 'head_turned_right' },
    };
  }

  if (pose.pitch <= HEAD_PITCH_DOWN_THRESHOLD) {
    return {
      signal: 'head_down',
      label: '长时间低头',
      metadata: { ...metadata, pose_signal: 'head_down' },
    };
  }

  if (pose.pitch >= HEAD_PITCH_UP_THRESHOLD) {
    return {
      signal: 'head_up',
      label: '长时间抬头',
      metadata: { ...metadata, pose_signal: 'head_up' },
    };
  }

  return {
    signal: null,
    label: '正对摄像头',
    metadata: { ...metadata, pose_signal: 'head_forward' },
  };
}

function getOffScreenAttentionMetadata(
  face: DetectedFace | undefined,
  frameWidth: number,
  frameHeight: number
): { offScreen: boolean; metadata: Record<string, unknown> } {
  if (!face || frameWidth <= 0 || frameHeight <= 0) {
    return { offScreen: false, metadata: {} };
  }

  const bounds = readFaceBounds(face);
  if (!bounds) {
    return { offScreen: false, metadata: { attention_signal: 'missing_face_bounds' } };
  }

  const faceWidth = bounds.xMax - bounds.xMin;
  const faceHeight = bounds.yMax - bounds.yMin;
  const centerX = (bounds.xMin + bounds.xMax) / 2 / frameWidth;
  const centerY = (bounds.yMin + bounds.yMax) / 2 / frameHeight;
  const areaRatio = (faceWidth * faceHeight) / (frameWidth * frameHeight);
  const edgeMargin = 0.08;
  const touchesEdge =
    bounds.xMin / frameWidth <= edgeMargin ||
    bounds.yMin / frameHeight <= edgeMargin ||
    bounds.xMax / frameWidth >= 1 - edgeMargin ||
    bounds.yMax / frameHeight >= 1 - edgeMargin;
  const tooSmall = areaRatio > 0 && areaRatio < 0.035;

  return {
    offScreen: touchesEdge || tooSmall,
    metadata: {
      attention_signal: touchesEdge ? 'face_near_edge' : tooSmall ? 'face_too_small' : 'face_centered',
      face_center_x: Number(centerX.toFixed(3)),
      face_center_y: Number(centerY.toFixed(3)),
      face_area_ratio: Number(areaRatio.toFixed(3)),
      face_score: typeof face.score === 'number' ? Number(face.score.toFixed(3)) : null,
    },
  };
}

export function useInterviewProctoring(params: UseInterviewProctoringParams): UseInterviewProctoringResult {
  const { interviewId, sessionId, enabled } = params;
  const videoElementRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const detectorRef = useRef<Detector | null>(null);
  const activeEventsRef = useRef(new Map<ProctoringEventType, ActiveTimedEvent>());
  const pendingEventsRef = useRef<ProctoringEventInput[]>([]);
  const pollTimerRef = useRef<number | null>(null);
  const pollingRef = useRef(false);
  const flushingRef = useRef(false);
  const flushAgainRef = useRef(false);
  const stoppedRef = useRef(true);
  const mountedRef = useRef(false);
  const runIdRef = useRef(0);
  const listenerCleanupRef = useRef<(() => void) | null>(null);
  const trackEndedCleanupRef = useRef<(() => void) | null>(null);
  const interviewIdRef = useRef(interviewId);
  const sessionIdRef = useRef(sessionId);
  const enabledRef = useRef(enabled);
  const consentedRef = useRef(false);
  const sessionSummaryRecordedRef = useRef(false);
  const [status, setStatus] = useState<InterviewProctoringStatus>('idle');
  const [statusText, setStatusText] = useState('摄像头监考未开启');
  const [faceBox, setFaceBox] = useState<ProctoringFaceBox | null>(null);
  const [screenSwitch, setScreenSwitch] = useState<ProctoringScreenSwitchState>({
    active: false,
    type: null,
    startedAt: null,
    lastDurationMs: 0,
    eventCount: 0,
    totalDurationMs: 0,
    statusText: '切屏监控正常',
  });
  const [consented, setConsented] = useState(() => readStoredConsent(interviewId));

  const attachStreamToVideo = useCallback((node: HTMLVideoElement | null): void => {
    videoElementRef.current = node;
    if (!node || !streamRef.current) return;

    node.srcObject = streamRef.current;
    node.muted = true;
    node.playsInline = true;
    void node.play().catch(() => {
      // The polling loop still owns detection status; preview playback errors are non-fatal.
    });
  }, []);

  function setRuntimeStatus(nextStatus: InterviewProctoringStatus, nextText: string): void {
    if (!mountedRef.current) return;

    setStatus((current) => (current === nextStatus ? current : nextStatus));
    setStatusText((current) => (current === nextText ? current : nextText));
  }

  function markScreenSwitchOpen(type: ProctoringEventType, timestampMs: number): void {
    if (!isScreenSwitchEvent(type)) return;

    const switchType = type as ProctoringScreenSwitchState['type'];
    setScreenSwitch((current) => ({
      ...current,
      active: true,
      type: switchType,
      startedAt: new Date(timestampMs).toISOString(),
      lastDurationMs: 0,
      statusText: getScreenSwitchStatusText(switchType, 0),
    }));
  }

  function markScreenSwitchClose(type: ProctoringEventType, durationMs: number, committed: boolean): void {
    if (!isScreenSwitchEvent(type)) return;

    setScreenSwitch((current) => ({
      active: false,
      type: null,
      startedAt: null,
      lastDurationMs: durationMs,
      eventCount: committed ? current.eventCount + 1 : current.eventCount,
      totalDurationMs: committed ? current.totalDurationMs + durationMs : current.totalDurationMs,
      statusText: committed ? `已记录切屏 ${Math.round(durationMs / 1000)} 秒` : '切屏监控正常',
    }));
  }

  function clearPollTimer(): void {
    if (pollTimerRef.current === null || typeof window === 'undefined') return;

    window.clearInterval(pollTimerRef.current);
    pollTimerRef.current = null;
  }

  function cleanupActivityListeners(): void {
    listenerCleanupRef.current?.();
    listenerCleanupRef.current = null;
  }

  function cleanupTrackEndedListener(): void {
    trackEndedCleanupRef.current?.();
    trackEndedCleanupRef.current = null;
  }

  function openTimedEvent(
    type: ProctoringEventType,
    timestampMs: number,
    metadata: Record<string, unknown> = {}
  ): void {
    if (activeEventsRef.current.has(type)) {
      const existing = activeEventsRef.current.get(type);
      if (existing) {
        existing.metadata = { ...existing.metadata, ...metadata };
      }
      return;
    }

    activeEventsRef.current.set(type, {
      sessionId: sessionIdRef.current,
      startedAt: new Date(timestampMs).toISOString(),
      startedMs: timestampMs,
      metadata,
      snapshotPaths: [],
    });
    markScreenSwitchOpen(type, timestampMs);
  }

  async function captureSnapshot(type: ProctoringEventType, timestampMs: number): Promise<string[]> {
    const video = videoElementRef.current;
    const currentSessionId = sessionIdRef.current;

    if (
      !isVisualEvent(type) ||
      !video ||
      !currentSessionId ||
      typeof document === 'undefined' ||
      video.videoWidth <= 0 ||
      video.videoHeight <= 0
    ) {
      return [];
    }

    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;

    const context = canvas.getContext('2d');
    if (!context) return [];

    context.drawImage(video, 0, 0, canvas.width, canvas.height);

    const blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob(resolve, 'image/webp', 0.82);
    });

    if (!blob) return [];

    const path = buildSnapshotPath({
      interviewId: interviewIdRef.current,
      sessionId: currentSessionId,
      eventType: type,
      timestampMs,
    });

    return [await uploadProctoringSnapshot(path, blob)];
  }

  async function closeTimedEvent(
    type: ProctoringEventType,
    timestampMs: number,
    metadata: Record<string, unknown> = {}
  ): Promise<void> {
    const active = activeEventsRef.current.get(type);
    if (!active) return;

    activeEventsRef.current.delete(type);

    const durationMs = Math.max(0, timestampMs - active.startedMs);
    const shouldCommit = shouldCommitTimedEvent(type, durationMs);
    if (!shouldCommit) {
      markScreenSwitchClose(type, durationMs, false);
      return;
    }
    const eventSessionId = resolveTimedEventSession(active.sessionId, sessionIdRef.current);
    if (!eventSessionId) {
      markScreenSwitchClose(type, durationMs, false);
      return;
    }

    const endedAt = new Date(timestampMs).toISOString();
    const eventMetadata: Record<string, unknown> = { ...active.metadata, ...metadata };
    if (active.snapshotPromise) {
      await active.snapshotPromise;
    }

    const snapshotPaths = active.snapshotPaths;
    if (active.snapshotError) {
      eventMetadata.snapshot_error = active.snapshotError;
    }

    pendingEventsRef.current.push({
      interview_id: interviewIdRef.current,
      session_id: eventSessionId,
      event_type: type,
      severity: deriveProctoringSeverity(type, durationMs),
      confidence: type === 'no_face' ? null : 1,
      started_at: active.startedAt,
      ended_at: endedAt,
      duration_ms: durationMs,
      snapshot_paths: snapshotPaths,
      metadata: Object.keys(eventMetadata).length > 0 ? eventMetadata : null,
    });
    markScreenSwitchClose(type, durationMs, true);
  }

  async function closeActiveTimedEvents(
    timestampMs: number,
    metadata: Record<string, unknown>,
    excludedTypes: Set<ProctoringEventType> = new Set()
  ): Promise<void> {
    const activeTypes = [...activeEventsRef.current.keys()].filter((type) => !excludedTypes.has(type));

    for (const type of activeTypes) {
      await closeTimedEvent(type, timestampMs, metadata);
    }
  }

  function trackTimedCondition(
    type: ProctoringEventType,
    condition: boolean,
    timestampMs: number,
    metadata: Record<string, unknown> = {}
  ): Promise<void> | void {
    if (condition) {
      openTimedEvent(type, timestampMs, metadata);
      const active = activeEventsRef.current.get(type);
      const durationMs = active ? Math.max(0, timestampMs - active.startedMs) : 0;
      if (active && active.snapshotPaths.length === 0 && !active.snapshotPromise && shouldCommitTimedEvent(type, durationMs)) {
        active.snapshotPromise = captureSnapshot(type, timestampMs)
          .then((paths) => {
            active.snapshotPaths = paths;
          })
          .catch((error) => {
            active.snapshotError = resolveErrorMessage(error, 'Snapshot upload failed');
          });
      }
      return;
    }

    return closeTimedEvent(type, timestampMs, metadata);
  }

  function hasThresholdWarning(timestampMs: number): boolean {
    for (const [type, active] of activeEventsRef.current) {
      const durationMs = Math.max(0, timestampMs - active.startedMs);
      if (type !== 'camera_closed' && type !== 'off_screen_attention' && shouldCommitTimedEvent(type, durationMs)) {
        return true;
      }
    }

    return false;
  }

  function refreshReadyStatus(timestampMs: number): void {
    if (stoppedRef.current) return;

    if (activeEventsRef.current.has('no_face')) {
      setRuntimeStatus('warning', '未检测到人脸');
      return;
    }

    if (activeEventsRef.current.has('multiple_faces')) {
      setRuntimeStatus('warning', '检测到多人入镜');
      return;
    }

    if (activeEventsRef.current.has('face_occluded')) {
      setRuntimeStatus('warning', '请保持面部无遮挡');
      return;
    }

    if (activeEventsRef.current.has('head_down')) {
      setRuntimeStatus('warning', '请不要长时间低头');
      return;
    }

    if (activeEventsRef.current.has('head_up')) {
      setRuntimeStatus('warning', '请保持正对摄像头');
      return;
    }

    if (activeEventsRef.current.has('head_turned_left') || activeEventsRef.current.has('head_turned_right')) {
      setRuntimeStatus('warning', '请保持正对摄像头');
      return;
    }

    if (activeEventsRef.current.has('off_screen_attention')) {
      setRuntimeStatus('warning', '人脸不完整或离开画面');
      return;
    }

    if (activeEventsRef.current.has('page_hidden')) {
      setRuntimeStatus('warning', '检测到离开考试页面');
      return;
    }

    if (activeEventsRef.current.has('window_blur')) {
      setRuntimeStatus('warning', '检测到窗口失焦');
      return;
    }

    if (hasThresholdWarning(timestampMs)) {
      setRuntimeStatus('warning', '请保持面部在摄像头画面内');
      return;
    }

    setRuntimeStatus('ready', '摄像头监考正常');
  }

  async function recordCameraClosed(timestampMs: number, metadata: Record<string, unknown>): Promise<void> {
    if (activeEventsRef.current.has('camera_closed')) return;

    openTimedEvent('camera_closed', timestampMs, metadata);
    await closeTimedEvent('camera_closed', timestampMs, metadata);
    setRuntimeStatus('blocked', '摄像头已关闭');
  }

  async function flushEvents(): Promise<void> {
    await closeActiveTimedEvents(Date.now(), { flushed: true });
    recordSessionSummaryEvent();

    if (flushingRef.current) {
      flushAgainRef.current = true;
      return;
    }

    if (pendingEventsRef.current.length === 0) return;

    flushingRef.current = true;

    try {
      while (pendingEventsRef.current.length > 0 || flushAgainRef.current) {
        flushAgainRef.current = false;

        if (pendingEventsRef.current.length === 0) {
          continue;
        }

        const eventsToFlush = pendingEventsRef.current.splice(0);
        const grouped = new Map<string, ProctoringEventInput[]>();

        for (const event of eventsToFlush) {
          const key = `${event.interview_id}\n${event.session_id}`;
          grouped.set(key, [...(grouped.get(key) ?? []), event]);
        }

        const requeue: ProctoringEventInput[] = [];

        for (const groupEvents of grouped.values()) {
          const firstEvent = groupEvents[0];
          if (!firstEvent) continue;

          try {
            await interviewRuntimeEdge.recordProctoringEvents({
              interviewId: firstEvent.interview_id,
              sessionId: firstEvent.session_id,
              events: groupEvents.map((event) => ({
                eventType: event.event_type,
                severity: event.severity,
                confidence: event.confidence ?? 1,
                startedAt: event.started_at,
                endedAt: event.ended_at ?? null,
                durationMs: event.duration_ms,
                snapshotPaths: event.snapshot_paths,
                metadata: event.metadata ?? {},
              })),
            });
          } catch {
            requeue.push(...groupEvents);
          }
        }

        if (requeue.length > 0) {
          pendingEventsRef.current = [...requeue, ...pendingEventsRef.current];
          return;
        }
      }
    } finally {
      flushingRef.current = false;
    }
  }

  function recordSessionSummaryEvent(): void {
    const currentSessionId = sessionIdRef.current;
    const track = getFirstVideoTrack(streamRef.current);
    if (!currentSessionId || !track || sessionSummaryRecordedRef.current) return;

    const timestamp = new Date().toISOString();
    sessionSummaryRecordedRef.current = true;
    pendingEventsRef.current.push({
      interview_id: interviewIdRef.current,
      session_id: currentSessionId,
      event_type: 'camera_check_passed',
      severity: 'low',
      confidence: 1,
      started_at: timestamp,
      ended_at: timestamp,
      duration_ms: 0,
      snapshot_paths: [],
      metadata: {
        camera_ready: track.readyState === 'live',
        video_width: videoElementRef.current?.videoWidth ?? null,
        video_height: videoElementRef.current?.videoHeight ?? null,
        face_box_state: faceBox?.state ?? null,
        face_box_label: faceBox?.label ?? null,
        screen_switch_event_count: screenSwitch.eventCount,
        screen_switch_total_duration_ms: screenSwitch.totalDurationMs,
      },
    });
  }

  function cleanupDetector(): void {
    const detector = detectorRef.current;
    detectorRef.current = null;

    if (!detector) return;

    try {
      detector.reset();
    } catch {
      // Ignore model cleanup failures.
    }

    try {
      detector.dispose();
    } catch {
      // Ignore model cleanup failures.
    }
  }

  async function stopRuntime(shouldFlush: boolean): Promise<void> {
    runIdRef.current += 1;
    stoppedRef.current = true;
    clearPollTimer();
    cleanupActivityListeners();
    cleanupTrackEndedListener();

    const nowMs = Date.now();
    await closeActiveTimedEvents(nowMs, { stopped: true });

    stopStream(streamRef.current);
    streamRef.current = null;

    if (videoElementRef.current) {
      videoElementRef.current.srcObject = null;
    }

    cleanupDetector();
    setRuntimeStatus('idle', '摄像头监考未开启');
    setFaceBox(null);
    setScreenSwitch((current) => ({
      ...current,
      active: false,
      type: null,
      startedAt: null,
      lastDurationMs: 0,
      statusText: '切屏监控正常',
    }));

    if (shouldFlush) {
      await flushEvents();
    }
  }

  async function handleCameraClosed(): Promise<void> {
    if (stoppedRef.current) return;

    const nowMs = Date.now();
    await recordCameraClosed(nowMs, { ready_state: 'ended' });
    await closeActiveTimedEvents(nowMs, { camera_closed: true }, new Set<ProctoringEventType>(['camera_closed']));
    runIdRef.current += 1;
    stoppedRef.current = true;
    clearPollTimer();
    cleanupActivityListeners();
    cleanupTrackEndedListener();
    stopStream(streamRef.current);
    streamRef.current = null;
    cleanupDetector();

    if (videoElementRef.current) {
      videoElementRef.current.srcObject = null;
    }

    setFaceBox(null);
    await flushEvents();
  }

  async function pollFaces(): Promise<void> {
    if (pollingRef.current || stoppedRef.current) return;

    const detector = detectorRef.current;
    const video = videoElementRef.current;
    const track = getFirstVideoTrack(streamRef.current);
    if (!detector || !video || !track) return;

    pollingRef.current = true;

    try {
      const nowMs = Date.now();
      if (track.readyState === 'ended') {
        await handleCameraClosed();
        return;
      }

      const faces = await detector.estimateFaces(video, { flipHorizontal: false });
      const singleFace = faces.length === 1 ? faces[0] : undefined;
      const attention = getOffScreenAttentionMetadata(singleFace, video.videoWidth, video.videoHeight);
      const pose = getPoseSignal(singleFace);
      const hasPoseWarning = Boolean(pose.signal);
      const bounds = singleFace ? readFaceBounds(singleFace) : null;
      if (bounds) {
        const faceWidth = bounds.xMax - bounds.xMin;
        const faceHeight = bounds.yMax - bounds.yMin;
        setFaceBox({
          x: bounds.xMin / video.videoWidth,
          y: bounds.yMin / video.videoHeight,
          width: faceWidth / video.videoWidth,
          height: faceHeight / video.videoHeight,
          state: attention.offScreen || hasPoseWarning ? 'warning' : 'normal',
          label: attention.offScreen ? '人脸不完整' : pose.label,
        });
      } else {
        setFaceBox(null);
      }
      await trackTimedCondition('no_face', faces.length === 0, nowMs, { face_count: faces.length });
      await trackTimedCondition('multiple_faces', faces.length > 1, nowMs, { face_count: faces.length });
      await trackTimedCondition('off_screen_attention', faces.length === 1 && attention.offScreen, nowMs, {
        face_count: faces.length,
        ...attention.metadata,
      });
      await trackTimedCondition('head_turned_left', pose.signal === 'head_turned_left', nowMs, {
        face_count: faces.length,
        ...pose.metadata,
      });
      await trackTimedCondition('head_turned_right', pose.signal === 'head_turned_right', nowMs, {
        face_count: faces.length,
        ...pose.metadata,
      });
      await trackTimedCondition('head_down', pose.signal === 'head_down', nowMs, {
        face_count: faces.length,
        ...pose.metadata,
      });
      await trackTimedCondition('head_up', pose.signal === 'head_up', nowMs, {
        face_count: faces.length,
        ...pose.metadata,
      });
      await trackTimedCondition('face_occluded', pose.signal === 'face_occluded', nowMs, {
        face_count: faces.length,
        ...pose.metadata,
      });
      refreshReadyStatus(nowMs);
    } catch (error) {
      if (!stoppedRef.current) {
        setRuntimeStatus('error', resolveErrorMessage(error, '人脸检测失败'));
      }
      setFaceBox(null);
    } finally {
      pollingRef.current = false;
    }
  }

  function startPolling(): void {
    if (typeof window === 'undefined') return;

    clearPollTimer();
    pollTimerRef.current = window.setInterval(() => {
      void pollFaces();
    }, POLL_INTERVAL_MS);
    void pollFaces();
  }

  function registerActivityListeners(): void {
    if (typeof document === 'undefined' || typeof window === 'undefined') return;

    cleanupActivityListeners();

    const handleVisibilityChange = () => {
      if (stoppedRef.current) return;

      const nowMs = Date.now();
      if (document.visibilityState === 'hidden') {
        if (activeEventsRef.current.has('window_blur')) {
          void closeTimedEvent('window_blur', nowMs, { hidden_overlap: true });
        }
        openTimedEvent('page_hidden', nowMs, { visibility_state: document.visibilityState });
        setRuntimeStatus('warning', '检测到离开考试页面');
        return;
      }

      void closeTimedEvent('page_hidden', nowMs, { visibility_state: document.visibilityState }).then(() => {
        refreshReadyStatus(nowMs);
      });
    };

    const handleBlur = () => {
      if (stoppedRef.current) return;
      if (document.visibilityState === 'hidden') return;

      openTimedEvent('window_blur', Date.now(), { focused: false });
      setRuntimeStatus('warning', '检测到窗口失焦');
    };

    const handleFocus = () => {
      if (stoppedRef.current) return;

      const nowMs = Date.now();
      void closeTimedEvent('window_blur', nowMs, { focused: true }).then(() => {
        refreshReadyStatus(nowMs);
      });
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('blur', handleBlur);
    window.addEventListener('focus', handleFocus);
    listenerCleanupRef.current = () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('blur', handleBlur);
      window.removeEventListener('focus', handleFocus);
    };
  }

  function registerTrackEndedListener(track: MediaStreamTrack): void {
    cleanupTrackEndedListener();

    const handleEnded = () => {
      void handleCameraClosed();
    };

    track.addEventListener('ended', handleEnded);
    trackEndedCleanupRef.current = () => {
      track.removeEventListener('ended', handleEnded);
    };
  }

  async function createDetector(): Promise<Detector> {
    const { FaceDetector, FaceLandmarker, FilesetResolver } = await import('@mediapipe/tasks-vision');
    const vision = await FilesetResolver.forVisionTasks('https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision/wasm');
    try {
      const landmarker = await FaceLandmarker.createFromOptions(vision, {
        baseOptions: {
          modelAssetPath:
            'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/latest/face_landmarker.task',
        },
        runningMode: 'VIDEO',
        numFaces: 3,
        minFaceDetectionConfidence: 0.5,
        minFacePresenceConfidence: 0.5,
        minTrackingConfidence: 0.5,
        outputFaceBlendshapes: false,
        outputFacialTransformationMatrixes: true,
      });

      return {
        async estimateFaces(video: HTMLVideoElement) {
          const result = landmarker.detectForVideo(video, performance.now());
          return result.faceLandmarks
            .map((landmarks) => landmarksToFace(landmarks, video.videoWidth, video.videoHeight))
            .filter((face): face is DetectedFace => face !== null);
        },
        reset() {},
        dispose() {
          landmarker.close();
        },
      };
    } catch {
      // Fall back to face detection when the heavier landmark model is unavailable.
    }

    const detector = await FaceDetector.createFromOptions(vision, {
      baseOptions: {
        modelAssetPath:
          'https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/latest/blaze_face_short_range.tflite',
      },
      runningMode: 'VIDEO',
      minDetectionConfidence: 0.5,
      minSuppressionThreshold: 0.3,
    });

    return {
      async estimateFaces(video: HTMLVideoElement) {
        const result = detector.detectForVideo(video, performance.now());
        return result.detections.map((detection) => {
          const box = detection.boundingBox;
          const score = detection.categories[0]?.score;
          return {
            box: box
              ? {
                  xMin: box.originX,
                  yMin: box.originY,
                  xMax: box.originX + box.width,
                  yMax: box.originY + box.height,
                  width: box.width,
                  height: box.height,
                }
              : undefined,
            keypoints: detection.keypoints,
            score,
          };
        });
      },
      reset() {},
      dispose() {
        detector.close();
      },
    };
  }

  async function start(options: { assumeConsent?: boolean } = {}): Promise<void> {
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      setRuntimeStatus('blocked', '当前浏览器无法访问摄像头');
      return;
    }

    if (!enabledRef.current) {
      setRuntimeStatus('idle', '摄像头监考未启用');
      return;
    }

    if (options.assumeConsent) {
      consentedRef.current = true;
      writeStoredConsent(interviewIdRef.current, true);
      setConsented(true);
    }

    if (!consentedRef.current) {
      setRuntimeStatus('blocked', '请先同意开启摄像头监考');
      return;
    }

    const video = videoElementRef.current;
    if (!video) {
      setRuntimeStatus('error', '摄像头预览未准备好');
      return;
    }

    if (!stoppedRef.current) {
      await stopRuntime(true);
    }

    const runId = runIdRef.current + 1;
    runIdRef.current = runId;
    stoppedRef.current = false;
    sessionSummaryRecordedRef.current = false;
    setRuntimeStatus('requesting', '正在请求摄像头权限');

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      if (stoppedRef.current || runId !== runIdRef.current) {
        stopStream(stream);
        return;
      }

      streamRef.current = stream;
      video.srcObject = stream;
      video.muted = true;
      video.playsInline = true;
      await video.play();

      const track = getFirstVideoTrack(stream);
      if (track) {
        registerTrackEndedListener(track);
      }

      registerActivityListeners();
      setRuntimeStatus('ready', '摄像头监考正常');

      try {
        setRuntimeStatus('requesting', '正在加载人脸检测模型');
        const detector = await createDetector();
        if (stoppedRef.current || runId !== runIdRef.current) {
          detector.dispose();
          return;
        }

        detectorRef.current = detector;
        setRuntimeStatus('ready', '摄像头监考正常');
        startPolling();
      } catch {
        setRuntimeStatus('ready', '摄像头已开启，人脸检测暂不可用');
      }
    } catch (error) {
      stopStream(streamRef.current);
      streamRef.current = null;
      cleanupDetector();

      if (videoElementRef.current) {
        videoElementRef.current.srcObject = null;
      }

      stoppedRef.current = true;
      const message = resolveErrorMessage(error, '摄像头访问失败');
      setRuntimeStatus(message.toLowerCase().includes('permission') ? 'blocked' : 'error', message);

      const currentSessionId = sessionIdRef.current;
      if (currentSessionId) {
        const timestampMs = Date.now();
        pendingEventsRef.current.push({
          interview_id: interviewIdRef.current,
          session_id: currentSessionId,
          event_type: 'camera_denied',
          severity: 'high',
          confidence: 1,
          started_at: new Date(timestampMs).toISOString(),
          ended_at: new Date(timestampMs).toISOString(),
          duration_ms: 0,
          snapshot_paths: [],
          metadata: { error: message },
        });
        await flushEvents();
      }
    }
  }

  async function stop(): Promise<void> {
    await stopRuntime(true);
  }

  useEffect(() => {
    interviewIdRef.current = interviewId;
    sessionIdRef.current = sessionId;
    enabledRef.current = enabled;
    consentedRef.current = consented;
  }, [interviewId, sessionId, enabled, consented]);

  useEffect(() => {
    setConsented(readStoredConsent(interviewId));
  }, [interviewId]);

  useEffect(() => {
    writeStoredConsent(interviewId, consented);
  }, [interviewId, consented]);

  useEffect(() => {
    if (!enabled) {
      void stopRuntime(true);
    }
  }, [enabled]);

  useEffect(() => {
    if (!enabled || !sessionId || !consented || !stoppedRef.current) return;

    const timer = window.setTimeout(() => {
      if (!enabledRef.current || !sessionIdRef.current || !consentedRef.current || !stoppedRef.current) return;
      void start();
    }, 150);

    return () => window.clearTimeout(timer);
  }, [enabled, sessionId, consented]);

  useEffect(() => {
    if (!screenSwitch.active || !screenSwitch.startedAt || !screenSwitch.type) return;

    const timer = window.setInterval(() => {
      const durationMs = Math.max(0, Date.now() - new Date(screenSwitch.startedAt ?? '').getTime());
      setScreenSwitch((current) => {
        if (!current.active || !current.startedAt || !current.type) return current;
        return {
          ...current,
          lastDurationMs: durationMs,
          statusText: getScreenSwitchStatusText(current.type, durationMs),
        };
      });
    }, 1000);

    return () => window.clearInterval(timer);
  }, [screenSwitch.active, screenSwitch.startedAt, screenSwitch.type]);

  useEffect(() => {
    mountedRef.current = true;

    return () => {
      mountedRef.current = false;
      void stopRuntime(true);
    };
  }, []);

  return {
    videoRef: attachStreamToVideo,
    status,
    statusText,
    faceBox,
    screenSwitch,
    consented,
    setConsented,
    start,
    stop,
    flushEvents,
  };
}
