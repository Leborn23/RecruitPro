import { useCallback, useEffect, useRef, useState, type Dispatch, type RefCallback, type SetStateAction } from 'react';
import {
  buildSnapshotPath,
  deriveProctoringSeverity,
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
  consented: boolean;
  setConsented: Dispatch<SetStateAction<boolean>>;
  start: () => Promise<void>;
  stop: () => Promise<void>;
  flushEvents: () => Promise<void>;
};

type DetectedFace = {
  box?: unknown;
  keypoints?: unknown[];
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
};

const POLL_INTERVAL_MS = 1000;
const IMMEDIATE_EVENT_TYPES = new Set<ProctoringEventType>(['camera_closed', 'window_blur']);

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
  const edgeMargin = 0.01;
  const centerMin = 0.12;
  const centerMax = 0.88;
  const touchesEdge =
    bounds.xMin / frameWidth <= edgeMargin ||
    bounds.yMin / frameHeight <= edgeMargin ||
    bounds.xMax / frameWidth >= 1 - edgeMargin ||
    bounds.yMax / frameHeight >= 1 - edgeMargin;
  const centerOutside = centerX < centerMin || centerX > centerMax || centerY < centerMin || centerY > centerMax;
  const tooSmall = areaRatio > 0 && areaRatio < 0.018;

  return {
    offScreen: touchesEdge || centerOutside || tooSmall,
    metadata: {
      attention_signal: touchesEdge ? 'face_near_edge' : centerOutside ? 'face_off_center' : tooSmall ? 'face_too_small' : 'face_centered',
      face_center_x: Number(centerX.toFixed(3)),
      face_center_y: Number(centerY.toFixed(3)),
      face_area_ratio: Number(areaRatio.toFixed(3)),
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
  const [status, setStatus] = useState<InterviewProctoringStatus>('idle');
  const [statusText, setStatusText] = useState('摄像头监考未开启');
  const [consented, setConsented] = useState(false);

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
    });
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
    if (!shouldCommitTimedEvent(type, durationMs)) return;
    const eventSessionId = resolveTimedEventSession(active.sessionId, sessionIdRef.current);
    if (!eventSessionId) return;

    const endedAt = new Date(timestampMs).toISOString();
    const eventMetadata: Record<string, unknown> = { ...active.metadata, ...metadata };
    let snapshotPaths: string[] = [];

    try {
      snapshotPaths = await captureSnapshot(type, timestampMs);
    } catch (error) {
      eventMetadata.snapshot_error = resolveErrorMessage(error, 'Snapshot upload failed');
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
      return;
    }

    return closeTimedEvent(type, timestampMs, metadata);
  }

  function hasThresholdWarning(timestampMs: number): boolean {
    for (const [type, active] of activeEventsRef.current) {
      const durationMs = Math.max(0, timestampMs - active.startedMs);
      if (type !== 'camera_closed' && shouldCommitTimedEvent(type, durationMs)) {
        return true;
      }
    }

    return false;
  }

  function refreshReadyStatus(timestampMs: number): void {
    if (stoppedRef.current) return;

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
      await trackTimedCondition('no_face', faces.length === 0, nowMs, { face_count: faces.length });
      await trackTimedCondition('multiple_faces', faces.length > 1, nowMs, { face_count: faces.length });
      const attention = getOffScreenAttentionMetadata(faces.length === 1 ? faces[0] : undefined, video.videoWidth, video.videoHeight);
      await trackTimedCondition('off_screen_attention', faces.length === 1 && attention.offScreen, nowMs, {
        face_count: faces.length,
        ...attention.metadata,
      });
      refreshReadyStatus(nowMs);
    } catch (error) {
      if (!stoppedRef.current) {
        setRuntimeStatus('error', resolveErrorMessage(error, '人脸检测失败'));
      }
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
        openTimedEvent('page_hidden', nowMs, { visibility_state: document.visibilityState });
        return;
      }

      void closeTimedEvent('page_hidden', nowMs, { visibility_state: document.visibilityState }).then(() => {
        refreshReadyStatus(nowMs);
      });
    };

    const handleBlur = () => {
      if (stoppedRef.current) return;

      openTimedEvent('window_blur', Date.now(), { focused: false });
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
    await import('@tensorflow/tfjs-backend-webgl');
    const tfjsDetector = await import('@tensorflow-models/face-detection/dist/tfjs/detector.js');

    return tfjsDetector.load({
      runtime: 'tfjs',
      maxFaces: 3,
    });
  }

  async function start(): Promise<void> {
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      setRuntimeStatus('blocked', '当前浏览器无法访问摄像头');
      return;
    }

    if (!enabledRef.current) {
      setRuntimeStatus('idle', '摄像头监考未启用');
      return;
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

      setRuntimeStatus('requesting', 'Loading face detector');
      const detector = await createDetector();
      if (stoppedRef.current || runId !== runIdRef.current) {
        detector.dispose();
        return;
      }

      detectorRef.current = detector;
      registerActivityListeners();
      setRuntimeStatus('ready', '摄像头监考正常');
      startPolling();
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
    if (!enabled) {
      void stopRuntime(true);
    }
  }, [enabled]);

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
    consented,
    setConsented,
    start,
    stop,
    flushEvents,
  };
}
