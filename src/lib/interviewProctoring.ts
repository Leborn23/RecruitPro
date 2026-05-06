export type ProctoringEventType =
  | 'camera_closed'
  | 'multiple_faces'
  | 'no_face'
  | 'off_screen_attention'
  | 'page_hidden'
  | 'window_blur';

export type ProctoringSeverity = 'low' | 'medium' | 'high';

export type ProctoringEventInput = {
  type: ProctoringEventType;
  durationMs?: number;
};

export type ProctoringEventRow = {
  id: string;
  interviewId: string;
  sessionId: string;
  type: ProctoringEventType;
  severity: ProctoringSeverity;
  occurredAt: string;
  durationMs?: number | null;
  snapshotPath?: string | null;
};

type SnapshotPathInput = {
  interviewId: string;
  sessionId: string;
  eventType: ProctoringEventType;
  timestamp: string | Date;
};

type ProctoringSummary = {
  eventCount: number;
  highCount: number;
  mediumCount: number;
  lowCount: number;
  riskScore: number;
  summaryText: string;
};

type StorageUploadResult = {
  path: string;
  error: Error | null;
};

type StorageBucket = {
  upload: (
    path: string,
    fileBody: Blob | ArrayBuffer | Uint8Array,
    options?: { contentType?: string; upsert?: boolean }
  ) => Promise<{ error: Error | null }>;
};

type StorageClient = {
  from: (bucketName: string) => StorageBucket;
};

const TIMED_EVENT_THRESHOLDS_MS: Partial<Record<ProctoringEventType, number>> = {
  no_face: 5000,
  multiple_faces: 3000,
  off_screen_attention: 8000,
  page_hidden: 10000,
};

const EVENT_LABELS: Record<ProctoringEventType, string> = {
  camera_closed: '摄像头关闭',
  multiple_faces: '多人入镜',
  no_face: '未检测到人脸',
  off_screen_attention: '视线离开屏幕',
  page_hidden: '页面离开',
  window_blur: '窗口失焦',
};

const RISK_SCORE_BY_SEVERITY: Record<ProctoringSeverity, number> = {
  high: 30,
  medium: 15,
  low: 5,
};

export function shouldOpenTimedEvent(type: ProctoringEventType, durationMs: number): boolean {
  const thresholdMs = TIMED_EVENT_THRESHOLDS_MS[type];
  return thresholdMs !== undefined && durationMs >= thresholdMs;
}

export function deriveProctoringSeverity(input: ProctoringEventInput): ProctoringSeverity {
  if (input.type === 'camera_closed' || input.type === 'multiple_faces') {
    return 'high';
  }

  if (
    input.type === 'no_face' ||
    input.type === 'off_screen_attention' ||
    input.type === 'page_hidden'
  ) {
    return shouldOpenTimedEvent(input.type, input.durationMs ?? 0) ? 'medium' : 'low';
  }

  return 'low';
}

export function buildSnapshotPath(input: SnapshotPathInput): string {
  const timestamp = new Date(input.timestamp).toISOString().replaceAll(':', '-').replace('.', '-');
  return `${input.interviewId}/${input.sessionId}/${input.eventType}-${timestamp}.webp`;
}

export function summarizeProctoringEvents(events: ProctoringEventRow[]): ProctoringSummary {
  const highCount = events.filter((event) => event.severity === 'high').length;
  const mediumCount = events.filter((event) => event.severity === 'medium').length;
  const lowCount = events.filter((event) => event.severity === 'low').length;
  const riskScore = events.reduce(
    (total, event) => total + RISK_SCORE_BY_SEVERITY[event.severity],
    0
  );
  const labels = [...new Set(events.map((event) => EVENT_LABELS[event.type]))];
  const summaryText =
    labels.length > 0
      ? `共记录 ${events.length} 次异常：${labels.join('、')}`
      : '未记录面试监考异常';

  return {
    eventCount: events.length,
    highCount,
    mediumCount,
    lowCount,
    riskScore,
    summaryText,
  };
}

export async function uploadProctoringSnapshot(
  storage: StorageClient,
  bucketName: string,
  path: string,
  snapshot: Blob | ArrayBuffer | Uint8Array
): Promise<StorageUploadResult> {
  const { error } = await storage.from(bucketName).upload(path, snapshot, {
    contentType: 'image/webp',
    upsert: false,
  });

  return { path, error };
}
