export type ProctoringEventType =
  | 'camera_denied'
  | 'camera_closed'
  | 'no_face'
  | 'multiple_faces'
  | 'off_screen_attention'
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

const PROCTORING_BUCKET = 'interview-proctoring';

const TIMED_EVENT_THRESHOLDS_MS: Partial<Record<ProctoringEventType, number>> = {
  no_face: 5000,
  multiple_faces: 3000,
  off_screen_attention: 8000,
  page_hidden: 10000,
};

const EVENT_LABELS: Record<ProctoringEventType, string> = {
  camera_denied: '摄像头权限拒绝',
  camera_closed: '摄像头关闭',
  no_face: '未检测到人脸',
  multiple_faces: '多人入镜',
  off_screen_attention: '视线离开屏幕',
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
    eventType === 'multiple_faces'
  ) {
    return 'high';
  }

  if (
    eventType === 'no_face' ||
    eventType === 'off_screen_attention' ||
    eventType === 'page_hidden'
  ) {
    return shouldOpenTimedEvent(eventType, durationMs) ? 'medium' : 'low';
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
