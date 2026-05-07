export type ProctoringEventType =
  | 'camera_check_passed'
  | 'camera_denied'
  | 'camera_closed'
  | 'no_face'
  | 'multiple_faces'
  | 'off_screen_attention'
  | 'head_turned_left'
  | 'head_turned_right'
  | 'head_down'
  | 'head_up'
  | 'face_occluded'
  | 'page_hidden'
  | 'window_blur';

export type ProctoringSeverity = 'low' | 'medium' | 'high';

export type ProctoringEventInput = {
  interview_id: string;
  session_id: string;
  event_type: ProctoringEventType;
  severity: ProctoringSeverity;
  confidence: number | null;
  started_at: string;
  ended_at?: string | null;
  duration_ms: number;
  snapshot_paths: string[];
  metadata: Record<string, unknown> | null;
};

export type ProctoringEventRow = Omit<ProctoringEventInput, 'interview_id' | 'session_id'> & {
  id?: string;
  interview_id?: string;
  session_id?: string;
  created_at?: string;
};

type SnapshotPathInput = {
  interviewId: string;
  sessionId: string;
  eventType: ProctoringEventType;
  timestampMs: number;
};

type ProctoringSummary = {
  eventCount: number;
  highCount: number;
  mediumCount: number;
  lowCount: number;
  riskScore: number;
  summaryText: string;
};

export type ScreenSwitchSummary = {
  eventCount: number;
  totalDurationMs: number;
  longestDurationMs: number;
  pageHiddenCount: number;
  windowBlurCount: number;
};

const PROCTORING_BUCKET = 'interview-proctoring';

const TIMED_EVENT_THRESHOLDS_MS: Partial<Record<ProctoringEventType, number>> = {
  no_face: 800,
  multiple_faces: 800,
  off_screen_attention: 1000,
  head_turned_left: 3000,
  head_turned_right: 3000,
  head_down: 3000,
  head_up: 3000,
  face_occluded: 1500,
  page_hidden: 2000,
  window_blur: 2000,
};

const EVENT_LABELS: Record<ProctoringEventType, string> = {
  camera_check_passed: '摄像头监考摘要',
  camera_denied: '摄像头权限拒绝',
  camera_closed: '摄像头关闭',
  no_face: '未检测到人脸',
  multiple_faces: '多人入镜',
  off_screen_attention: '人脸不完整或离开画面',
  head_turned_left: '头部长时间偏左',
  head_turned_right: '头部长时间偏右',
  head_down: '长时间低头',
  head_up: '长时间抬头',
  face_occluded: '人脸关键点遮挡',
  page_hidden: '页面离开',
  window_blur: '窗口失焦',
};

const RISK_SCORE_BY_SEVERITY: Record<ProctoringSeverity, number> = {
  high: 25,
  medium: 10,
  low: 3,
};

export function shouldOpenTimedEvent(type: ProctoringEventType, durationMs: number): boolean {
  const thresholdMs = TIMED_EVENT_THRESHOLDS_MS[type];
  return thresholdMs !== undefined && durationMs >= thresholdMs;
}

export function isScreenSwitchEvent(type: ProctoringEventType): boolean {
  return type === 'page_hidden' || type === 'window_blur';
}

export function resolveTimedEventSession(
  startedSessionId: string | null,
  currentSessionId: string | null
): string | null {
  if (!startedSessionId || startedSessionId !== currentSessionId) {
    return null;
  }

  return startedSessionId;
}

export function deriveProctoringSeverity(
  eventType: ProctoringEventType,
  durationMs: number
): ProctoringSeverity {
  if (
    eventType === 'camera_denied' ||
    eventType === 'camera_closed' ||
    eventType === 'multiple_faces' ||
    (
      (
        eventType === 'head_turned_left' ||
        eventType === 'head_turned_right' ||
        eventType === 'head_down' ||
        eventType === 'head_up'
      ) &&
      durationMs >= 6000
    )
  ) {
    return 'high';
  }

  if (eventType === 'camera_check_passed') {
    return 'low';
  }

  if (
    eventType === 'no_face' ||
    eventType === 'off_screen_attention' ||
    eventType === 'head_turned_left' ||
    eventType === 'head_turned_right' ||
    eventType === 'head_down' ||
    eventType === 'head_up' ||
    eventType === 'face_occluded'
  ) {
    return shouldOpenTimedEvent(eventType, durationMs) ? 'medium' : 'low';
  }

  if (isScreenSwitchEvent(eventType)) {
    if (durationMs >= 30000) return 'high';
    if (durationMs >= 10000) return 'medium';
    return shouldOpenTimedEvent(eventType, durationMs) ? 'low' : 'low';
  }

  return 'low';
}

export function buildSnapshotPath(input: SnapshotPathInput): string {
  const timestamp = new Date(input.timestampMs).toISOString().replaceAll(':', '-').replace('.', '-');
  return `${input.interviewId}/${input.sessionId}/${input.eventType}-${timestamp}.webp`;
}

export function summarizeProctoringEvents(events: ProctoringEventRow[]): ProctoringSummary {
  const highCount = events.filter((event) => event.severity === 'high').length;
  const mediumCount = events.filter((event) => event.severity === 'medium').length;
  const lowCount = events.filter((event) => event.severity === 'low').length;
  const uncappedRiskScore = events.reduce(
    (total, event) => total + RISK_SCORE_BY_SEVERITY[event.severity],
    0
  );
  const labels = [...new Set(events.map((event) => EVENT_LABELS[event.event_type]))];
  const snapshotCount = events.reduce((total, event) => total + event.snapshot_paths.length, 0);
  const summaryText =
    labels.length > 0
      ? `共记录 ${events.length} 次异常：${labels.join('、')}，含 ${snapshotCount} 张截图`
      : '未记录面试监考异常';

  return {
    eventCount: events.length,
    highCount,
    mediumCount,
    lowCount,
    riskScore: Math.min(uncappedRiskScore, 100),
    summaryText,
  };
}

export function summarizeScreenSwitchEvents(events: ProctoringEventRow[]): ScreenSwitchSummary {
  const screenSwitchEvents = events.filter((event) => isScreenSwitchEvent(event.event_type));
  const durations = screenSwitchEvents.map((event) => Math.max(0, Number(event.duration_ms) || 0));

  return {
    eventCount: screenSwitchEvents.length,
    totalDurationMs: durations.reduce((total, duration) => total + duration, 0),
    longestDurationMs: durations.length > 0 ? Math.max(...durations) : 0,
    pageHiddenCount: screenSwitchEvents.filter((event) => event.event_type === 'page_hidden').length,
    windowBlurCount: screenSwitchEvents.filter((event) => event.event_type === 'window_blur').length,
  };
}

export async function uploadProctoringSnapshot(path: string, blob: Blob): Promise<string> {
  const { supabase } = await import('./supabase.ts');
  const { error } = await supabase.storage.from(PROCTORING_BUCKET).upload(path, blob, {
    contentType: blob.type || 'image/webp',
    upsert: true,
  });

  if (error) {
    throw error;
  }

  return path;
}
