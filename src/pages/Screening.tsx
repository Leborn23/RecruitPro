import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, CheckCircle2, CircleAlert, Eye, Loader2, Target, Trash2, UploadCloud, X } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { runPhase1ResumePipeline, type ActivePositionRow, type PipelineProgressStage } from '../lib/screeningPipeline';
import InterviewInviteModal from '../components/interviews/InterviewInviteModal';

type CandidateRow = {
  id: string;
  match_id: string | null;
  position_id: string | null;
  name: string;
  title: string | null;
  exp_years: number | null;
  match: number | null;
  recommendation: string | null;
  prev_company: string | null;
  tag: string | null;
  highlight: string | null;
  human_decision: 'pass' | 'pending' | 'reject' | null;
  review_note: string | null;
  reviewed_at: string | null;
};

type CandidateBaseRow = {
  id: string;
  name: string;
  title: string | null;
  exp_years: number | null;
  prev_company: string | null;
  tag: string | null;
  highlight: string | null;
};

type PositionMatchRow = {
  id: string;
  candidate_id: string;
  position_id: string;
  overall_score: number | null;
  recommendation: string | null;
  summary_reason: string | null;
  human_decision: 'pass' | 'pending' | 'reject' | null;
  review_note: string | null;
  reviewed_at: string | null;
  created_at: string;
};

type UploadRow = {
  id: string;
  file_name: string;
  file_path: string | null;
  position_id: string | null;
  mime_type: string | null;
  status: string;
  pipeline_stage: string;
  error_code: string | null;
  error_message: string | null;
  retry_count: number | null;
  created_at: string;
};

type BatchItemStatus = 'queued' | 'processing' | 'success' | 'failed';

type BatchUploadItem = {
  id: string;
  file_name: string;
  status: BatchItemStatus;
  stage: PipelineProgressStage;
  message: string;
  error_message: string | null;
  candidate_id: string | null;
  match_id: string | null;
  started_at: number | null;
  ended_at: number | null;
  cancel_requested: boolean;
};

const BATCH_CONCURRENCY = 2;
const MAX_BATCH_FILES = 30;

const STAGE_LABELS: Record<PipelineProgressStage, string> = {
  uploaded: '已上传',
  text_extraction: '解析中',
  profile_extraction: '提炼中',
  matching: '匹配中',
  completed: '已完成',
  failed: '失败'
};

const STATUS_LABELS: Record<string, string> = {
  pending: '待处理',
  processing: '处理中',
  completed: '完成',
  failed: '失败'
};

const recommendationTag = (recommendation: string | null): string => {
  if (recommendation === 'strong_match') return '强匹配';
  if (recommendation === 'partial_match') return '待评估';
  if (recommendation === 'weak_match') return '弱匹配';
  if (recommendation === 'reject') return '不匹配';
  return '待评估';
};
const humanDecisionTag = (decision: 'pass' | 'pending' | 'reject' | null): string | null => {
  if (decision === 'pass') return '人工通过';
  if (decision === 'pending') return '人工待定';
  if (decision === 'reject') return '人工淘汰';
  return null;
};

const humanDecisionClass = (decision: 'pass' | 'pending' | 'reject' | null): string => {
  if (decision === 'pass') return 'text-primary border-primary/30 bg-primary/10';
  if (decision === 'pending') return 'text-secondary border-secondary/30 bg-secondary/10';
  if (decision === 'reject') return 'text-error border-error/30 bg-error/10';
  return 'text-on-surface-variant border-outline-variant/20 bg-surface-container';
};



const uploadErrorCodeLabel = (code: string | null): string | null => {
  if (!code) return null;
  if (code === 'USER_CANCELLED') return '用户取消';
  if (code === 'STORAGE_UPLOAD_ERROR') return '文件上传失败';
  if (code === 'OCR_PROVIDER_ERROR') return 'OCR 服务异常';
  if (code === 'LLM_PROVIDER_ERROR') return '模型服务异常';
  if (code === 'TEXT_EXTRACTION_ERROR') return '文本提取失败';
  if (code === 'JOB_REQUIREMENT_ERROR') return '岗位解析失败';
  if (code === 'CANDIDATE_INSERT_ERROR') return '候选人写入失败';
  if (code === 'PROFILE_PERSIST_ERROR') return '简历结构化写入失败';
  if (code === 'PROJECTS_PERSIST_ERROR') return '项目写入失败';
  if (code === 'MATCH_PERSIST_ERROR') return '匹配结果写入失败';
  return '处理失败';
};

const humanizeUploadError = (message: string | null, code: string | null): string => {
  const codeLabel = uploadErrorCodeLabel(code);
  if (!message || !message.trim()) return codeLabel ?? '处理失败';

  const raw = message.trim();
  const lower = raw.toLowerCase();
  const normalized = lower
    .replace('：', ':')
    .replace(/\s+/g, ' ')
    .trim();

  // 先处理中英混合的常见底层英文报错
  if (normalized.includes('object exceeded the maximum allowed size')) return '文件过大，超出系统允许的上传大小';
  if (normalized.includes('payload too large') || normalized.includes('request entity too large')) {
    return '文件过大，超出系统允许的上传大小';
  }
  if (normalized.includes('schema cache')) {
    return '系统数据库结构与当前版本不一致，请先同步数据库迁移';
  }
  if (normalized.includes('relation') && normalized.includes('does not exist')) {
    return '系统数据库结构不完整，请先同步数据库迁移';
  }
  if (normalized.includes('null value in column') && normalized.includes('violates not-null constraint')) {
    return '存在必填信息缺失，请检查字段映射配置';
  }
  if (normalized.includes('violates foreign key constraint')) return '关联数据不存在，请检查岗位或候选人是否有效';
  if (normalized.includes('duplicate key value') && normalized.includes('unique constraint')) return '数据重复，系统中已存在相同记录';
  if (normalized.includes('permission denied')) return '数据库权限不足，无法写入数据';
  if (normalized.includes('invalid input syntax')) return '字段格式不正确，请检查输入数据格式';
  if (lower.includes('timeout') || lower.includes('timed out')) return '请求超时，请稍后重试';
  if (lower.includes('network') || lower.includes('fetch failed')) return '网络异常，请稍后重试';
  if (lower.includes('unauthorized') || lower.includes('forbidden') || lower.includes('apikey') || lower.includes('api key')) {
    return '鉴权失败，请检查模型密钥或权限设置';
  }
  if (lower.includes('storage')) return '文件上传失败，请稍后重试';
  if (lower.includes('ocr')) return 'OCR 服务异常，请稍后重试';
  if (lower.includes('llm')) return '模型服务异常，请稍后重试';

  // 纯中文错误直接透传
  if (/[\u4e00-\u9fa5]/.test(raw)) return raw;
  return codeLabel ?? '处理失败';
};

export default function Screening() {
  const navigate = useNavigate();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [allCandidates, setAllCandidates] = useState<CandidateRow[]>([]);
  const [positions, setPositions] = useState<ActivePositionRow[]>([]);
  const [uploads, setUploads] = useState<UploadRow[]>([]);
  const [selectedPositionId, setSelectedPositionId] = useState('');

  const [activeTab, setActiveTab] = useState<'strong' | 'pending' | 'eliminated'>('strong');
  const [passScore, setPassScore] = useState(80);
  const [failScore] = useState(60);

  const [isDragging, setIsDragging] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const [stage, setStage] = useState<PipelineProgressStage>('uploaded');
  const [stageMessage, setStageMessage] = useState('等待上传简历');
  const [pipelineError, setPipelineError] = useState<string | null>(null);
  const [selectedFailedUploadIds, setSelectedFailedUploadIds] = useState<string[]>([]);
  const [isDeletingUploads, setIsDeletingUploads] = useState(false);
  const [taskListMode, setTaskListMode] = useState<'focused' | 'all'>('focused');
  const [batchItems, setBatchItems] = useState<BatchUploadItem[]>([]);
  const [isBatchRunning, setIsBatchRunning] = useState(false);
  const [showBatchModal, setShowBatchModal] = useState(false);
  const [batchStartedAt, setBatchStartedAt] = useState<number | null>(null);
  const [batchEndedAt, setBatchEndedAt] = useState<number | null>(null);
  const [inviteCandidate, setInviteCandidate] = useState<CandidateRow | null>(null);
  const batchFileMapRef = useRef<Record<string, File>>({});
  const cancelledBatchItemIdsRef = useRef<Set<string>>(new Set());

  const selectedPosition = useMemo(
    () => positions.find((p) => p.id === selectedPositionId) ?? null,
    [positions, selectedPositionId]
  );

  useEffect(() => {
    if (selectedPosition) {
      setPassScore(selectedPosition.threshold_score ?? 80);
    }
  }, [selectedPosition]);

  const fetchData = async () => {
    const [posRes, uploadRes] = await Promise.all([
      supabase
        .from('active_positions')
        .select('id,title,technical_requirements,min_exp,min_edu,threshold_score,department,location')
        .order('created_at', { ascending: false }),
      supabase
        .from('resume_uploads')
        .select('id,file_name,file_path,position_id,mime_type,status,pipeline_stage,error_code,error_message,retry_count,created_at')
        .order('created_at', { ascending: false })
        .limit(8)
    ]);

    let nextSelectedPositionId = selectedPositionId;
    if (posRes.data) {
      const nextPositions = posRes.data as ActivePositionRow[];
      setPositions(nextPositions);

      if (!nextSelectedPositionId && nextPositions.length > 0) {
        nextSelectedPositionId = nextPositions[0].id;
        setSelectedPositionId(nextSelectedPositionId);
      }

      const selected = nextPositions.find((p) => p.id === nextSelectedPositionId);
      if (selected) {
        setPassScore(selected.threshold_score ?? 80);
      }
    }

    if (uploadRes.data) setUploads(uploadRes.data as UploadRow[]);

    if (!nextSelectedPositionId) {
      setAllCandidates([]);
      return;
    }

    const { data: matchRowsData, error: matchRowsError } = await supabase
      .from('candidate_position_matches')
      .select('id,candidate_id,position_id,overall_score,recommendation,summary_reason,human_decision,review_note,reviewed_at,created_at')
      .eq('position_id', nextSelectedPositionId)
      .order('created_at', { ascending: false });

    if (matchRowsError || !matchRowsData) {
      setAllCandidates([]);
      return;
    }

    const latestMatchByCandidate = new Map<string, PositionMatchRow>();
    for (const row of matchRowsData as PositionMatchRow[]) {
      if (!latestMatchByCandidate.has(row.candidate_id)) {
        latestMatchByCandidate.set(row.candidate_id, row);
      }
    }

    const candidateIds = Array.from(latestMatchByCandidate.keys());
    if (candidateIds.length === 0) {
      setAllCandidates([]);
      return;
    }

    const { data: candidateRowsData } = await supabase
      .from('candidates')
      .select('id,name,title,exp_years,prev_company,tag,highlight')
      .in('id', candidateIds);

    const candidateMap = new Map<string, CandidateBaseRow>();
    for (const row of (candidateRowsData ?? []) as CandidateBaseRow[]) {
      candidateMap.set(row.id, row);
    }

    const mergedCandidates: CandidateRow[] = [];
    for (const matchRow of latestMatchByCandidate.values()) {
      const base = candidateMap.get(matchRow.candidate_id);
      if (!base) continue;
      mergedCandidates.push({
        id: base.id,
        match_id: matchRow.id,
        position_id: matchRow.position_id,
        name: base.name,
        title: base.title,
        exp_years: base.exp_years,
        match: matchRow.overall_score,
        recommendation: matchRow.recommendation,
        prev_company: base.prev_company,
        tag: base.tag ?? recommendationTag(matchRow.recommendation),
        highlight: matchRow.summary_reason ?? base.highlight,
        human_decision: matchRow.human_decision,
        review_note: matchRow.review_note,
        reviewed_at: matchRow.reviewed_at
      });
    }

    setAllCandidates(mergedCandidates);
  };

  useEffect(() => {
    void fetchData();
  }, []);

  useEffect(() => {
    if (!selectedPositionId) return;
    void fetchData();
  }, [selectedPositionId]);

  useEffect(() => {
    if (!isRunning && !isBatchRunning) return;

    const timer = setInterval(() => {
      void fetchData();
    }, 2500);

    return () => clearInterval(timer);
  }, [isRunning, isBatchRunning]);

  useEffect(() => {
    const failedIdSet = new Set(
      uploads
        .filter((u) => u.status === 'failed' && u.error_code !== 'USER_CANCELLED')
        .map((u) => u.id)
    );
    setSelectedFailedUploadIds((prev) => prev.filter((id) => failedIdSet.has(id)));
  }, [uploads]);

  const resolveCandidateBucket = (candidate: CandidateRow): 'strong' | 'pending' | 'eliminated' => {
    if (candidate.human_decision === 'pass') return 'strong';
    if (candidate.human_decision === 'pending') return 'pending';
    if (candidate.human_decision === 'reject') return 'eliminated';
    const score = candidate.match ?? 0;
    if (score >= passScore) return 'strong';
    if (score >= failScore) return 'pending';
    return 'eliminated';
  };
  const strongList = allCandidates.filter((c) => resolveCandidateBucket(c) === 'strong');
  const pendingList = allCandidates.filter((c) => resolveCandidateBucket(c) === 'pending');
  const eliminatedList = allCandidates.filter((c) => resolveCandidateBucket(c) === 'eliminated');
  const isUploadCancelled = (upload: UploadRow) => upload.status === 'failed' && upload.error_code === 'USER_CANCELLED';
  const failedUploads = uploads.filter((u) => u.status === 'failed');
  const focusUploads = uploads.filter(
    (u) => u.status === 'processing' || u.status === 'pending' || (u.status === 'failed' && !isUploadCancelled(u))
  );
  const visibleUploads = taskListMode === 'focused' ? focusUploads : uploads;
  const hiddenCompletedOrCancelledCount = uploads.length - focusUploads.length;
  const selectedFailedUploads = failedUploads.filter((u) => selectedFailedUploadIds.includes(u.id));
  const tabCandidates = activeTab === 'strong' ? strongList : activeTab === 'pending' ? pendingList : eliminatedList;
  const displayedCandidates = tabCandidates;
  const buildCandidateDetailQuery = (positionId: string, matchId?: string | null) => {
    const params = new URLSearchParams();
    if (positionId) params.set('positionId', positionId);
    if (matchId) params.set('matchId', matchId);
    const query = params.toString();
    return query ? `?${query}` : '';
  };
  const batchSummary = useMemo(() => {
    const total = batchItems.length;
    const success = batchItems.filter((item) => item.status === 'success').length;
    const failed = batchItems.filter((item) => item.status === 'failed').length;
    const processing = batchItems.filter((item) => item.status === 'processing').length;
    const queued = batchItems.filter((item) => item.status === 'queued').length;
    return { total, success, failed, processing, queued, completed: success + failed };
  }, [batchItems]);
  const batchDurationMs =
    batchStartedAt == null
      ? 0
      : (batchEndedAt ?? Date.now()) - batchStartedAt;
  const batchProgressPercent =
    batchSummary.total === 0 ? 0 : Math.round((batchSummary.completed / batchSummary.total) * 100);
  const activeUploadCount = uploads.filter((u) => u.status === 'processing' || u.status === 'pending').length;
  const reviewQueueCount = pendingList.length + failedUploads.filter((u) => !isUploadCancelled(u)).length;
  const currentPositionHighlights = (selectedPosition?.technical_requirements ?? '')
    .split(/[\n,，。；;]/)
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 4);
  const currentDecisionNotes = [
    selectedPosition ? `当前阈值 ${passScore} 分，60 到 ${passScore - 1} 分进入待定池。` : '请先选择岗位后再执行上传与分池。',
    activeUploadCount > 0 ? `当前有 ${activeUploadCount} 个任务正在处理。` : '当前没有处理中任务。',
    focusUploads.length > 0 ? `任务列表优先展示待处理和失败记录，共 ${focusUploads.length} 条。` : '当前没有待处理或失败记录。'
  ];

  const onPipelineStageChange = (nextStage: PipelineProgressStage, message: string) => {
    setStage(nextStage);
    setStageMessage(message);
  };

  const updateBatchItem = (id: string, patch: Partial<BatchUploadItem>) => {
    setBatchItems((prev) => prev.map((item) => (item.id === id ? { ...item, ...patch } : item)));
  };

  const isSupportedResumeFile = (file: File): boolean => /\.(pdf|doc|docx)$/i.test(file.name);

  const runSingleFile = async (
    file: File,
    options?: {
      batchItemId?: string;
      positionOverride?: ActivePositionRow;
      refreshAfterDone?: boolean;
    }
  ): Promise<{ success: boolean; overallScore?: number; candidateId?: string; matchId?: string }> => {
    const isBatchItem = Boolean(options?.batchItemId);
    const batchItemId = options?.batchItemId;
    const targetPosition = options?.positionOverride ?? selectedPosition;
    const isCancelled = () => Boolean(batchItemId && cancelledBatchItemIdsRef.current.has(batchItemId));

    if (!targetPosition) {
      const message = '请先选择岗位';
      if (isBatchItem && batchItemId) {
        updateBatchItem(batchItemId, {
          status: 'failed',
          stage: 'failed',
          message,
          error_message: message,
          ended_at: Date.now(),
          cancel_requested: false
        });
        return { success: false };
      }
      setPipelineError(message);
      return { success: false };
    }

    if (isBatchItem && batchItemId && isCancelled()) {
      updateBatchItem(batchItemId, {
        status: 'failed',
        stage: 'failed',
        message: '已取消识别',
        error_message: '用户已取消',
        ended_at: Date.now(),
        cancel_requested: true
      });
      return { success: false };
    }

    if (!isBatchItem) {
      setPipelineError(null);
      setIsRunning(true);
      setStage('uploaded');
      setStageMessage('准备开始处理简历');
    }

    try {
      const result = await runPhase1ResumePipeline(file, targetPosition, (nextStage, message) => {
        if (isBatchItem && batchItemId) {
          updateBatchItem(batchItemId, { stage: nextStage, message });
          return;
        }
        onPipelineStageChange(nextStage, message);
      }, {
        shouldCancel: isCancelled
      });

      if (options?.refreshAfterDone ?? true) {
        await fetchData();
      }

      if (!isBatchItem) {
        if (result.overallScore >= passScore) {
          setActiveTab('strong');
        } else if (result.overallScore >= failScore) {
          setActiveTab('pending');
        } else {
          setActiveTab('eliminated');
        }
      }

      if (isBatchItem && batchItemId) {
        if (isCancelled()) {
          updateBatchItem(batchItemId, {
            status: 'failed',
            stage: 'failed',
            message: '已取消识别',
            error_message: '用户已取消',
            ended_at: Date.now(),
            cancel_requested: true
          });
          return { success: false };
        }
        updateBatchItem(batchItemId, {
          status: 'success',
          stage: 'completed',
          message: '识别完成',
          error_message: null,
          candidate_id: result.candidateId,
          match_id: result.matchId,
          ended_at: Date.now(),
          cancel_requested: false
        });
      }

      return { success: true, overallScore: result.overallScore, candidateId: result.candidateId, matchId: result.matchId };
    } catch (error) {
      const message = error instanceof Error ? error.message : '处理失败';
      const cancelled = /取消/.test(message) || (isBatchItem && isCancelled());

      if (isBatchItem && batchItemId) {
        updateBatchItem(batchItemId, {
          status: 'failed',
          stage: 'failed',
          message: cancelled ? '已取消识别' : '识别失败',
          error_message: cancelled ? '用户已取消' : message,
          ended_at: Date.now(),
          cancel_requested: cancelled
        });
      } else {
        setPipelineError(message);
      }

      return { success: false };
    } finally {
      if (!isBatchItem) {
        setIsRunning(false);
      }
    }
  };

  const runBatchFiles = async (files: File[]) => {
    if (!selectedPosition) {
      setPipelineError('请先选择岗位');
      return;
    }

    const supported = files.filter((file) => isSupportedResumeFile(file));
    if (supported.length === 0) {
      setPipelineError('未检测到可上传文件，仅支持 PDF / DOC / DOCX');
      return;
    }

    const limitedFiles = supported.slice(0, MAX_BATCH_FILES);
    if (supported.length > MAX_BATCH_FILES) {
      setPipelineError(`单次最多处理 ${MAX_BATCH_FILES} 份，已自动截取前 ${MAX_BATCH_FILES} 份`);
    } else {
      setPipelineError(null);
    }

    const now = Date.now();
    cancelledBatchItemIdsRef.current = new Set();
    const items: BatchUploadItem[] = limitedFiles.map((file, index) => {
      const id = `${now}-${index}-${file.name}`;
      return {
        id,
        file_name: file.name,
        status: 'queued',
        stage: 'uploaded',
        message: '排队中',
        error_message: null,
        candidate_id: null,
        match_id: null,
        started_at: null,
        ended_at: null,
        cancel_requested: false
      };
    });

    const fileMap: Record<string, File> = {};
    items.forEach((item, index) => {
      fileMap[item.id] = limitedFiles[index];
    });
    batchFileMapRef.current = fileMap;

    setBatchItems(items);
    setShowBatchModal(true);
    setBatchStartedAt(now);
    setBatchEndedAt(null);
    setIsBatchRunning(true);
    setIsRunning(false);

    let cursor = 0;
    const worker = async () => {
      while (true) {
        const currentIndex = cursor;
        cursor += 1;
        if (currentIndex >= items.length) return;

        const item = items[currentIndex];
        if (cancelledBatchItemIdsRef.current.has(item.id)) {
          updateBatchItem(item.id, {
            status: 'failed',
            stage: 'failed',
            message: '已取消识别',
            error_message: '用户已取消',
            ended_at: Date.now(),
            cancel_requested: true
          });
          continue;
        }

        const file = fileMap[item.id];
        if (!file) {
          updateBatchItem(item.id, {
            status: 'failed',
            stage: 'failed',
            message: '识别失败',
            error_message: '文件已失效，请重新上传',
            ended_at: Date.now(),
            cancel_requested: false
          });
          continue;
        }

        updateBatchItem(item.id, {
          status: 'processing',
          stage: 'uploaded',
          message: '准备识别',
          started_at: Date.now(),
          cancel_requested: false
        });

        await runSingleFile(file, {
          batchItemId: item.id,
          positionOverride: selectedPosition,
          refreshAfterDone: false
        });
      }
    };

    try {
      const workerCount = Math.max(1, Math.min(BATCH_CONCURRENCY, items.length));
      await Promise.all(Array.from({ length: workerCount }, () => worker()));
      await fetchData();
    } finally {
      setIsBatchRunning(false);
      setBatchEndedAt(Date.now());
    }
  };

  const handleIncomingFiles = async (files: File[]) => {
    if (files.length === 0) return;
    if (isRunning || isBatchRunning || isDeletingUploads) return;

    await runBatchFiles(files);
  };

  const handleClickUploadZone = () => {
    if (isRunning || isBatchRunning || isDeletingUploads) return;
    setPipelineError(null);
    setBatchItems([]);
    setBatchStartedAt(null);
    setBatchEndedAt(null);
    cancelledBatchItemIdsRef.current = new Set();
    fileInputRef.current?.click();
  };

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    if (!isRunning && !isBatchRunning) setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);

    const files = Array.from(e.dataTransfer.files ?? []);
    if (files.length > 0) void handleIncomingFiles(files);
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    if (files.length > 0) {
      void handleIncomingFiles(files);
    } else if (!isBatchRunning) {
      setShowBatchModal(false);
    }
    e.target.value = '';
  };

  const handleCancelBatchItem = (itemId: string) => {
    cancelledBatchItemIdsRef.current.add(itemId);
    setBatchItems((prev) =>
      prev.map((item) => {
        if (item.id !== itemId) return item;
        if (item.status === 'queued') {
          return {
            ...item,
            status: 'failed',
            stage: 'failed',
            message: '已取消识别',
            error_message: '用户已取消',
            ended_at: Date.now(),
            cancel_requested: true
          };
        }
        if (item.status === 'processing') {
          return {
            ...item,
            message: '取消中，等待当前步骤结束',
            cancel_requested: true
          };
        }
        return item;
      })
    );
  };

  const handleCancelAllBatchItems = () => {
    const activeIds = batchItems.filter((item) => item.status === 'queued' || item.status === 'processing').map((item) => item.id);
    activeIds.forEach((id) => cancelledBatchItemIdsRef.current.add(id));
    setBatchItems((prev) =>
      prev.map((item) => {
        if (!activeIds.includes(item.id)) return item;
        if (item.status === 'queued') {
          return {
            ...item,
            status: 'failed',
            stage: 'failed',
            message: '已取消识别',
            error_message: '用户已取消',
            ended_at: Date.now(),
            cancel_requested: true
          };
        }
        return {
          ...item,
          message: '取消中，等待当前步骤结束',
          cancel_requested: true
        };
      })
    );
  };

  const handleSelectFailedUpload = (uploadId: string, checked: boolean) => {
    setSelectedFailedUploadIds((prev) => {
      if (checked) {
        if (prev.includes(uploadId)) return prev;
        return [...prev, uploadId];
      }
      return prev.filter((id) => id !== uploadId);
    });
  };

  const handleDeleteSelectedFailedUploads = async () => {
    if (selectedFailedUploads.length === 0 || isDeletingUploads) return;

    const confirmed = window.confirm(
      `确认删除 ${selectedFailedUploads.length} 条失败任务记录吗？\n此操作不可撤销。`
    );
    if (!confirmed) return;

    setIsDeletingUploads(true);
    setPipelineError(null);

    try {
      const uploadIds = selectedFailedUploads.map((item) => item.id);
      const storagePaths = selectedFailedUploads
        .map((item) => item.file_path)
        .filter((path): path is string => Boolean(path && path.trim()));

      if (storagePaths.length > 0) {
        const { error: storageError } = await supabase.storage.from('resume-files').remove(storagePaths);
        if (storageError) {
          console.warn('删除简历文件失败（将继续删除任务记录）:', storageError.message);
        }
      }

      const { error } = await supabase.from('resume_uploads').delete().in('id', uploadIds);
      if (error) {
        throw new Error(error.message);
      }

      setSelectedFailedUploadIds((prev) => prev.filter((id) => !uploadIds.includes(id)));
      await fetchData();
    } catch (error) {
      const message = error instanceof Error ? error.message : '未知错误';
      setPipelineError(`删除失败：${message}`);
    } finally {
      setIsDeletingUploads(false);
    }
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-500 pb-12">
      <section className="overflow-hidden rounded-[28px] border border-[#cddcf0] bg-white shadow-[0_14px_30px_-28px_rgba(15,23,42,0.1)]">
        <div className="grid gap-4 px-6 py-5 lg:grid-cols-[1.35fr_0.85fr] lg:px-8">
          <div className="space-y-4">
            <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
              <div className="space-y-3">
                <div className="inline-flex items-center gap-2 rounded-full border border-[#c7daf6] bg-[#f4f8ff] px-3 py-1 text-[11px] font-semibold tracking-[0.24em] text-[#426a9a]">
                  <Target className="h-3.5 w-3.5" />
                  筛选中枢
                </div>
                <div>
                  <h2 className="text-3xl font-semibold tracking-tight text-[#16355f]">简历筛选</h2>
                  <p className="mt-1 text-sm text-[#5d7896]">
                    先看当前岗位的筛选状态、待复核数量和处理任务，再执行上传与推进。
                  </p>
                </div>
              </div>

              <div className="relative">
                <span className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.2em] text-[#6b86a4]">
                  当前岗位
                </span>
                <select
                  value={selectedPositionId}
                  onChange={(e) => setSelectedPositionId(e.target.value)}
                  aria-label="切换当前筛选岗位"
                  className="appearance-none rounded-2xl border border-[#c7daf6] bg-[#f4f8ff] pl-10 pr-10 py-3 text-sm font-semibold text-[#1f5fbf] outline-none transition hover:border-[#aac6ea] hover:bg-[#eef5ff]"
                >
                  {positions.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.title}
                    </option>
                  ))}
                </select>
                <Target className="absolute left-3 top-[calc(50%+10px)] h-4 w-4 -translate-y-1/2 text-[#1f5fbf]" />
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <div className="rounded-[20px] border border-[#d8e4f4] bg-[#f8fbff] p-4">
                <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[#6b86a4]">当前岗位候选人</p>
                <p className="mt-2 text-3xl font-semibold text-[#16355f]">{allCandidates.length}</p>
              </div>
              <button
                type="button"
                onClick={() => setActiveTab('strong')}
                className={`rounded-[20px] border p-4 text-left transition ${
                  activeTab === 'strong'
                    ? 'border-[#86aee7] bg-[#f3f8ff]'
                    : 'border-[#d8e4f4] bg-white hover:border-[#aac6ea]'
                }`}
              >
                <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[#6b86a4]">强匹配池</p>
                <p className="mt-2 text-3xl font-semibold text-[#1f5fbf]">{strongList.length}</p>
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('pending')}
                className={`rounded-[20px] border p-4 text-left transition ${
                  activeTab === 'pending'
                    ? 'border-[#dccde8] bg-[#fbf7ff]'
                    : 'border-[#d8e4f4] bg-white hover:border-[#cdbce0]'
                }`}
              >
                <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[#6b86a4]">待复核</p>
                <p className="mt-2 text-3xl font-semibold text-[#7551a6]">{reviewQueueCount}</p>
              </button>
              <div className="rounded-[20px] border border-[#d8e4f4] bg-white p-4">
                <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[#6b86a4]">当前阈值</p>
                <p className="mt-2 text-3xl font-semibold text-[#16355f]">{passScore}</p>
              </div>
            </div>

            <div className="grid gap-3 md:grid-cols-4">
              <div className="rounded-[16px] border border-[#d6e2f1] bg-[#f8fbff] px-4 py-3">
                <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#6b86a4]">处理中任务</p>
                <p className="mt-1 text-base font-semibold text-[#16355f]">{activeUploadCount} 条</p>
              </div>
              <div className="rounded-[16px] border border-[#f1d8de] bg-[#fff6f8] px-4 py-3">
                <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#9d6576]">失败任务</p>
                <p className="mt-1 text-base font-semibold text-[#8e3550]">{failedUploads.filter((u) => !isUploadCancelled(u)).length} 条</p>
              </div>
              <div className="rounded-[16px] border border-[#d6e2f1] bg-[#f8fbff] px-4 py-3">
                <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#6b86a4]">当前列表</p>
                <p className="mt-1 text-base font-semibold text-[#16355f]">{displayedCandidates.length} 人</p>
              </div>
              <div className="rounded-[16px] border border-[#d6e2f1] bg-[#f8fbff] px-4 py-3">
                <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#6b86a4]">任务视图</p>
                <p className="mt-1 text-base font-semibold text-[#16355f]">{taskListMode === 'focused' ? '待处理优先' : '全部任务'}</p>
              </div>
            </div>

            <div className="rounded-[20px] border border-[#d6e2f1] bg-[#f8fbff] px-4 py-3">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                <div className="space-y-1">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#6b86a4]">快速操作</p>
                  <p className="text-sm text-[#5d7896]">
                    {isBatchRunning
                      ? `批量识别进行中，已完成 ${batchSummary.completed}/${batchSummary.total}。`
                      : isRunning
                        ? stageMessage
                        : `支持 PDF / DOC / DOCX，单次最多 ${MAX_BATCH_FILES} 份。`}
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={handleClickUploadZone}
                    disabled={isRunning || isBatchRunning}
                    className="inline-flex items-center gap-2 rounded-xl border border-[#c7daf6] bg-white px-4 py-2 text-sm font-medium text-[#1f5fbf] transition hover:bg-[#eef5ff] disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {isRunning || isBatchRunning ? <Loader2 className="h-4 w-4 animate-spin" /> : <UploadCloud className="h-4 w-4" />}
                    上传简历
                  </button>
                  {batchItems.length > 0 ? (
                    <button
                      type="button"
                      onClick={() => setShowBatchModal(true)}
                      className="cursor-pointer rounded-xl border border-[#d6e2f1] bg-white px-3 py-2 text-xs font-medium text-[#355b87] hover:bg-[#eef5ff]"
                    >
                      批量结果 {batchSummary.total}
                    </button>
                  ) : null}
                </div>
              </div>
            </div>
          </div>

          <div className="rounded-[24px] border border-[#d6e2f1] bg-[#f7fbff] p-4">
            <div className="flex items-center gap-2 text-sm font-semibold text-[#24476b]">
              <CheckCircle2 className="h-4 w-4 text-[#1f5fbf]" />
              当前岗位规则摘要
            </div>
            <div className="mt-3 space-y-2.5">
              <div className="rounded-[16px] border border-[#d6e2f1] bg-white px-4 py-3 text-sm text-[#24476b]">
                <div className="font-medium">{selectedPosition?.title || '未选择岗位'}</div>
                <div className="mt-1 text-[#5d7896]">
                  {selectedPosition
                    ? `${selectedPosition.department || '未设置部门'} · ${selectedPosition.location || '未设置地点'}`
                    : '选择岗位后显示规则摘要'}
                </div>
              </div>
              <div className="rounded-[16px] border border-[#d6e2f1] bg-white px-4 py-3">
                <div className="flex flex-wrap gap-2">
                  {currentPositionHighlights.length > 0 ? (
                    currentPositionHighlights.slice(0, 3).map((item) => (
                      <span key={item} className="rounded-full border border-[#c7daf6] bg-[#f4f8ff] px-3 py-1 text-xs text-[#1f5fbf]">
                        {item}
                      </span>
                    ))
                  ) : (
                    <span className="text-sm text-[#5d7896]">当前岗位尚未填写技术要求摘要。</span>
                  )}
                </div>
              </div>
              <div className="rounded-[16px] border border-[#d6e2f1] bg-white px-4 py-3 text-sm text-[#5d7896]">
                {currentDecisionNotes.slice(0, 2).map((item) => (
                  <p key={item} className="leading-6">
                    {item}
                  </p>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {pipelineError && (
        <div className="rounded-2xl border border-error/30 bg-error-container/20 px-4 py-3 text-sm text-error">{pipelineError}</div>
      )}

      {batchItems.length > 0 && (
        <div className="flex flex-col gap-3 rounded-2xl border border-outline-variant/20 bg-surface-container-lowest px-4 py-3 md:flex-row md:items-center md:justify-between">
          <div className="text-sm text-on-surface">
            批量任务：成功 {batchSummary.success}，失败 {batchSummary.failed}，共 {batchSummary.total} 份
          </div>
          <button
            type="button"
            onClick={() => setShowBatchModal(true)}
            className="cursor-pointer rounded-xl border border-primary/30 px-3 py-2 text-xs font-medium text-primary hover:bg-primary/8"
          >
            查看批量结果
          </button>
        </div>
      )}

      <div className="grid gap-6 xl:grid-cols-[1.18fr_0.82fr]">
        <div className="space-y-6">
          <div className="grid md:grid-cols-4 gap-4">
        <button
          onClick={() => setActiveTab('strong')}
          className={`border rounded-xl p-5 text-center transition-all ${
            activeTab === 'strong'
              ? 'bg-primary/5 border-primary shadow-sm scale-[1.02]'
              : 'bg-surface-container-lowest border-outline-variant/15 hover:border-primary/50'
          }`}
        >
          <p className="text-xs font-bold uppercase tracking-widest text-on-surface-variant mb-2">强匹配池</p>
          <p className="text-3xl font-semibold text-primary">{strongList.length}</p>
        </button>

        <button
          onClick={() => setActiveTab('pending')}
          className={`border rounded-xl p-5 text-center transition-all ${
            activeTab === 'pending'
              ? 'bg-secondary-container/30 border-secondary shadow-sm scale-[1.02]'
              : 'bg-surface-container-lowest border-outline-variant/15 hover:border-secondary/50'
          }`}
        >
          <p className="text-xs font-bold uppercase tracking-widest text-on-surface-variant mb-2">待定池</p>
          <p className="text-3xl font-semibold text-secondary">{pendingList.length}</p>
        </button>

        <button
          onClick={() => setActiveTab('eliminated')}
          className={`border rounded-xl p-5 text-center transition-all ${
            activeTab === 'eliminated'
              ? 'bg-error-container/30 border-error shadow-sm scale-[1.02]'
              : 'bg-surface-container-lowest border-outline-variant/15 hover:border-error/50'
          }`}
        >
          <p className="text-xs font-bold uppercase tracking-widest text-on-surface-variant mb-2">淘汰池</p>
          <p className="text-3xl font-semibold text-error">{eliminatedList.length}</p>
        </button>

        <div className="bg-surface-container-lowest border border-outline-variant/15 rounded-xl p-5 text-center">
          <p className="text-xs font-bold uppercase tracking-widest text-on-surface-variant mb-2">通过阈值</p>
          <p className="text-3xl font-semibold text-on-surface">{passScore}</p>
        </div>
          </div>

          <div className="bg-surface-container-lowest border border-outline-variant/15 rounded-xl overflow-hidden shadow-sm">
            <div className="px-6 py-4 border-b border-outline-variant/10 bg-surface/50 flex flex-col md:flex-row md:items-center md:justify-between gap-3">
              <div className="flex items-center gap-3">
                <h3 className="font-medium text-sm text-on-surface">候选人列表</h3>
                <span className="text-xs text-on-surface-variant">
                  {selectedPosition ? `当前岗位：${selectedPosition.title}` : '按综合分展示'}
                </span>
              </div>
            </div>

            {displayedCandidates.length === 0 ? (
              <div className="p-8 text-center text-sm text-on-surface-variant">当前分组暂无数据</div>
            ) : (
              <div className="divide-y divide-outline-variant/10">
                {displayedCandidates.map((item) => (
                  <div
                    key={item.id}
                    className="p-6 hover:bg-surface-container-low/50 transition-colors grid md:grid-cols-[1fr_2fr_auto] gap-6 items-center"
                  >
                    <div>
                      <div className="flex items-center gap-3 mb-1">
                        <h4 className="font-medium text-base text-on-surface">{item.name}</h4>
                        <span className="text-[10px] font-bold uppercase tracking-wider bg-primary-container text-primary px-2 py-0.5 rounded">
                          匹配度 {item.match ?? 0}%
                        </span>
                      </div>
                      <p className="text-sm font-medium text-on-surface-variant">
                        {item.title || '未识别职位'} @ <span className="text-on-surface">{item.prev_company || '未知公司'}</span>
                      </p>
                      <div className="mt-2 flex flex-wrap items-center gap-1.5">
                        <span className="inline-block rounded border border-primary/20 bg-primary/5 px-1.5 py-0.5 text-xs text-primary">
                          {item.tag || '待评估'}
                        </span>
                        {item.human_decision && (
                          <span className={`inline-block rounded border px-1.5 py-0.5 text-xs ${humanDecisionClass(item.human_decision)}`}>
                            {humanDecisionTag(item.human_decision)}
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="bg-surface-container-low rounded-lg p-3 text-sm">
                      <p className="text-xs font-semibold text-on-surface-variant mb-1 uppercase tracking-wider">匹配结论</p>
                      <p className="text-on-surface leading-loose">{item.highlight || '暂无说明'}</p>
                      {item.review_note && (
                        <p className="mt-2 text-xs text-on-surface-variant">
                          人工备注：{item.review_note}
                        </p>
                      )}
                    </div>

                    <div className="flex flex-col gap-2 min-w-[120px]">
                      <button
                        onClick={() => setInviteCandidate(item)}
                        className="cursor-pointer bg-primary text-white text-xs font-medium px-4 py-2 rounded shadow-sm hover:bg-primary/90 transition-colors flex justify-center items-center gap-1.5"
                      >
                        邀约面试 <ArrowRight className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() =>
                          navigate(`/candidates/${item.id}${buildCandidateDetailQuery(selectedPositionId, item.match_id)}`, {
                            state: { positionId: selectedPositionId, matchId: item.match_id }
                          })
                        }
                        className="cursor-pointer bg-surface-container border border-outline-variant/20 text-on-surface text-xs font-medium px-4 py-2 rounded hover:bg-surface-container-high transition-colors flex justify-center items-center gap-1.5"
                      >
                        查看详情 <Eye className="w-3 h-3" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
        <aside className="space-y-6">
          <div className="rounded-xl border border-outline-variant/15 bg-surface-container-lowest shadow-sm">
            <div className="border-b border-outline-variant/10 px-5 py-4">
              <h3 className="text-sm font-medium text-on-surface">上传与处理</h3>
            </div>
            <div className="space-y-4 p-5">
              <div
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                onClick={handleClickUploadZone}
                className={`relative flex flex-col items-center justify-center rounded-[24px] border-2 border-dashed p-8 text-center transition-all ${
                  isRunning || isBatchRunning
                    ? 'border-primary/30 bg-primary/5 pointer-events-none'
                    : isDragging
                      ? 'border-primary bg-primary/10'
                      : 'border-outline-variant/30 bg-surface hover:border-primary/50 hover:bg-surface-container-low cursor-pointer'
                }`}
              >
                <input ref={fileInputRef} type="file" className="hidden" accept=".pdf,.doc,.docx" multiple onChange={handleFileSelect} />

                {isRunning || isBatchRunning ? (
                  <div className="flex max-w-md w-full flex-col items-center text-center">
                    <Loader2 className="mb-4 h-10 w-10 animate-spin text-primary" />
                    <h3 className="mb-2 text-base font-semibold text-on-surface">{isBatchRunning ? '批量识别中' : STAGE_LABELS[stage]}</h3>
                    <p className="text-sm text-on-surface-variant">
                      {isBatchRunning ? `已完成 ${batchSummary.completed}/${batchSummary.total}，请在弹窗查看明细` : stageMessage}
                    </p>
                  </div>
                ) : (
                  <div className="flex flex-col items-center text-center">
                    <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-primary-container text-primary">
                      <UploadCloud className="h-8 w-8" />
                    </div>
                    <h3 className="mb-2 text-lg font-medium text-on-surface">上传简历批次</h3>
                    <p className="max-w-md text-sm text-on-surface-variant">
                      支持 PDF / DOC / DOCX，单次最多 {MAX_BATCH_FILES} 份。
                    </p>
                  </div>
                )}
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-2xl border border-outline-variant/15 bg-surface px-4 py-3">
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-on-surface-variant">处理中任务</p>
                  <p className="mt-2 text-2xl font-semibold text-on-surface">{activeUploadCount}</p>
                </div>
                <div className="rounded-2xl border border-outline-variant/15 bg-surface px-4 py-3">
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-on-surface-variant">失败任务</p>
                  <p className="mt-2 text-2xl font-semibold text-error">{failedUploads.filter((u) => !isUploadCancelled(u)).length}</p>
                </div>
              </div>
            </div>
          </div>

          <div className="rounded-xl border border-outline-variant/15 bg-surface-container-lowest overflow-hidden shadow-sm">
            <div className="border-b border-outline-variant/10 bg-surface/50 px-5 py-4">
              <h3 className="text-sm font-medium text-on-surface">任务监控</h3>
            </div>
            <div className="space-y-3 p-5 text-sm">
              <div className="rounded-2xl border border-outline-variant/15 bg-surface px-4 py-3 text-on-surface">
                当前展示 {visibleUploads.length} 条任务记录
              </div>
              <div className="inline-flex items-center rounded-xl border border-outline-variant/20 bg-surface-container-low p-0.5">
                <button
                  type="button"
                  onClick={() => setTaskListMode('focused')}
                  className={`cursor-pointer rounded-lg px-3 py-1.5 text-xs transition-colors ${
                    taskListMode === 'focused' ? 'bg-primary/15 text-primary' : 'text-on-surface-variant hover:text-on-surface'
                  }`}
                >
                  待处理/失败（{focusUploads.length}）
                </button>
                <button
                  type="button"
                  onClick={() => setTaskListMode('all')}
                  className={`cursor-pointer rounded-lg px-3 py-1.5 text-xs transition-colors ${
                    taskListMode === 'all' ? 'bg-primary/15 text-primary' : 'text-on-surface-variant hover:text-on-surface'
                  }`}
                >
                  全部（{uploads.length}）
                </button>
              </div>
              {taskListMode === 'focused' && hiddenCompletedOrCancelledCount > 0 && (
                <p className="text-xs text-on-surface-variant">已隐藏完成或取消任务 {hiddenCompletedOrCancelledCount} 条</p>
              )}
              {selectedFailedUploadIds.length > 0 && (
                <button
                  type="button"
                  onClick={() => void handleDeleteSelectedFailedUploads()}
                  disabled={isDeletingUploads}
                  className="inline-flex cursor-pointer items-center gap-1.5 rounded-xl border border-error/30 bg-error/10 px-3 py-2 text-xs font-medium text-error hover:bg-error/15 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  {isDeletingUploads ? '删除中...' : `删除选中（${selectedFailedUploadIds.length}）`}
                </button>
              )}
            </div>
          </div>
        </aside>
      </div>

      <div className="bg-surface-container-lowest border border-outline-variant/15 rounded-xl overflow-hidden shadow-sm">
        <div className="px-6 py-4 border-b border-outline-variant/10 bg-surface/50 flex flex-col md:flex-row md:items-center md:justify-between gap-3">
          <div className="flex items-center gap-3 flex-wrap">
            <h3 className="font-medium text-sm text-on-surface">最近处理任务</h3>
            <div className="inline-flex items-center rounded-lg border border-outline-variant/20 bg-surface-container-low p-0.5">
              <button
                type="button"
                onClick={() => setTaskListMode('focused')}
                className={`cursor-pointer text-xs px-3 py-1 rounded-md transition-colors ${
                  taskListMode === 'focused' ? 'bg-primary/15 text-primary' : 'text-on-surface-variant hover:text-on-surface'
                }`}
              >
                仅看待处理/失败（{focusUploads.length}）
              </button>
              <button
                type="button"
                onClick={() => setTaskListMode('all')}
                className={`cursor-pointer text-xs px-3 py-1 rounded-md transition-colors ${
                  taskListMode === 'all' ? 'bg-primary/15 text-primary' : 'text-on-surface-variant hover:text-on-surface'
                }`}
              >
                全部（{uploads.length}）
              </button>
            </div>
            {taskListMode === 'focused' && hiddenCompletedOrCancelledCount > 0 && (
              <span className="text-xs text-on-surface-variant">已隐藏完成/取消 {hiddenCompletedOrCancelledCount} 条</span>
            )}
          </div>
          {selectedFailedUploadIds.length > 0 && (
            <button
              type="button"
              onClick={() => void handleDeleteSelectedFailedUploads()}
              disabled={isDeletingUploads}
              className="cursor-pointer inline-flex items-center gap-1.5 rounded-md border border-error/30 bg-error/10 px-3 py-1.5 text-xs font-medium text-error hover:bg-error/15 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Trash2 className="w-3.5 h-3.5" />
              {isDeletingUploads ? '删除中...' : `删除选中（${selectedFailedUploadIds.length}）`}
            </button>
          )}
        </div>
        {visibleUploads.length === 0 ? (
          <div className="p-6 text-sm text-on-surface-variant">暂无任务记录</div>
        ) : (
          <div className="divide-y divide-outline-variant/10">
            {visibleUploads.map((u) => (
              <div key={u.id} className="px-6 py-4 hover:bg-surface-container-low/40 transition-colors">
                <div className="flex items-start gap-3">
                  <div className="pt-1 w-5">
                    {u.status === 'failed' && !isUploadCancelled(u) && (
                      <input
                        type="checkbox"
                        checked={selectedFailedUploadIds.includes(u.id)}
                        onChange={(e) => handleSelectFailedUpload(u.id, e.target.checked)}
                        className="w-4 h-4 cursor-pointer accent-primary"
                        aria-label={`选择失败任务 ${u.file_name}`}
                      />
                    )}
                  </div>
                  <div className="flex-1 flex flex-col md:flex-row md:items-center md:justify-between gap-2">
                    <div>
                      <p className="text-sm text-on-surface">{u.file_name}</p>
                      <p className="text-xs text-on-surface-variant">{new Date(u.created_at).toLocaleString()}</p>
                      {u.status === 'failed' && !isUploadCancelled(u) && (
                        <p className="mt-1 text-xs text-error max-w-[780px] truncate">
                          {humanizeUploadError(u.error_message, u.error_code)}
                        </p>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      {(() => {
                        const isCancelled = isUploadCancelled(u);
                        const primaryLabel =
                          u.status === 'completed'
                            ? '已完成'
                            : isCancelled
                              ? '已取消'
                              : u.status === 'failed'
                                ? '失败'
                                : STAGE_LABELS[u.pipeline_stage as PipelineProgressStage] || STATUS_LABELS[u.status] || '处理中';
                        const primaryClass =
                          u.status === 'completed'
                            ? 'bg-primary-container text-primary'
                            : isCancelled
                              ? 'bg-surface-container-high text-on-surface-variant'
                              : u.status === 'failed'
                                ? 'bg-error-container text-error'
                                : 'bg-secondary-container text-secondary';
                        return (
                          <span className={`text-xs px-2 py-1 rounded ${primaryClass}`}>
                            {primaryLabel}
                          </span>
                        );
                      })()}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {showBatchModal && (
        <div className="fixed inset-0 z-50 bg-black/35 backdrop-blur-[1px] flex items-center justify-center p-4">
          <div className="w-full max-w-3xl max-h-[86vh] overflow-hidden rounded-2xl border border-outline-variant/20 bg-surface shadow-xl">
            <div className="px-5 py-4 border-b border-outline-variant/15 flex items-start justify-between gap-4">
              <div>
                <h3 className="text-base font-semibold text-on-surface">{isBatchRunning ? '批量识别进行中' : '批量识别结果'}</h3>
                <p className="text-xs text-on-surface-variant mt-1">
                  共 {batchSummary.total} 份，已完成 {batchSummary.completed} 份，耗时 {Math.max(1, Math.round(batchDurationMs / 1000))} 秒
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  if (!isBatchRunning) setShowBatchModal(false);
                }}
                disabled={isBatchRunning}
                className="cursor-pointer p-1.5 rounded-md text-on-surface-variant hover:text-on-surface hover:bg-surface-container disabled:opacity-40 disabled:cursor-not-allowed"
                aria-label="关闭批量识别结果弹窗"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="px-5 py-4 border-b border-outline-variant/10 bg-surface-container-low/50">
              <div className="w-full h-2 rounded-full bg-surface-container overflow-hidden">
                <div className="h-full bg-primary transition-all" style={{ width: `${batchProgressPercent}%` }} />
              </div>
              <div className="mt-3 grid grid-cols-4 gap-3 text-center">
                <div className="rounded-lg border border-outline-variant/15 bg-surface px-2 py-2">
                  <div className="text-[11px] text-on-surface-variant">成功</div>
                  <div className="text-sm font-semibold text-primary">{batchSummary.success}</div>
                </div>
                <div className="rounded-lg border border-outline-variant/15 bg-surface px-2 py-2">
                  <div className="text-[11px] text-on-surface-variant">失败</div>
                  <div className="text-sm font-semibold text-error">{batchSummary.failed}</div>
                </div>
                <div className="rounded-lg border border-outline-variant/15 bg-surface px-2 py-2">
                  <div className="text-[11px] text-on-surface-variant">处理中</div>
                  <div className="text-sm font-semibold text-secondary">{batchSummary.processing}</div>
                </div>
                <div className="rounded-lg border border-outline-variant/15 bg-surface px-2 py-2">
                  <div className="text-[11px] text-on-surface-variant">排队中</div>
                  <div className="text-sm font-semibold text-on-surface">{batchSummary.queued}</div>
                </div>
              </div>
            </div>

            <div className="max-h-[46vh] overflow-auto divide-y divide-outline-variant/10">
              {batchItems.length === 0 ? (
                <div className="px-5 py-10 text-center text-sm text-on-surface-variant">
                  请选择一个或多个简历文件，系统会在此弹窗实时展示识别进度与结果。
                </div>
              ) : (
                batchItems.map((item) => (
                  <div key={item.id} className="px-5 py-3 flex flex-col gap-2">
                    <div className="flex items-center justify-between gap-3">
                      <div className="text-sm text-on-surface truncate">{item.file_name}</div>
                      <div className="flex items-center gap-2">
                        {item.stage !== 'failed' && item.stage !== 'completed' && (
                          <span className="text-xs px-2 py-1 rounded bg-surface-container-high text-on-surface-variant">
                            {STAGE_LABELS[item.stage]}
                          </span>
                        )}
                        {item.status === 'success' && (
                          <span className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded bg-primary-container text-primary">
                            <CheckCircle2 className="w-3.5 h-3.5" />
                            成功
                          </span>
                        )}
                        {item.status === 'failed' && (
                          <span className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded bg-error-container text-error">
                            <CircleAlert className="w-3.5 h-3.5" />
                            失败
                          </span>
                        )}
                        {(item.status === 'queued' || item.status === 'processing') && (
                          <span className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded bg-secondary-container text-secondary">
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            {item.status === 'queued' ? '排队中' : '处理中'}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="text-xs text-on-surface-variant">
                      {item.error_message ? `失败原因：${humanizeUploadError(item.error_message, null)}` : item.message}
                    </div>
                    {(item.status === 'queued' || item.status === 'processing') && (
                      <div>
                        <button
                          type="button"
                          onClick={() => handleCancelBatchItem(item.id)}
                          disabled={item.cancel_requested}
                          className="cursor-pointer text-xs px-2.5 py-1 rounded border border-error/30 text-error hover:bg-error/10 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          {item.cancel_requested ? '取消中...' : '取消识别'}
                        </button>
                      </div>
                    )}
                    {item.candidate_id && (
                      <div>
                        <button
                          type="button"
                          onClick={() => {
                            setShowBatchModal(false);
                            navigate(`/candidates/${item.candidate_id}${buildCandidateDetailQuery(selectedPositionId, item.match_id)}`, {
                              state: { positionId: selectedPositionId, matchId: item.match_id ?? undefined }
                            });
                          }}
                          className="cursor-pointer text-xs px-2.5 py-1 rounded border border-primary/30 text-primary hover:bg-primary/8"
                        >
                          查看候选人详情
                        </button>
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>

            <div className="px-5 py-4 border-t border-outline-variant/15 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={handleCancelAllBatchItems}
                disabled={!isBatchRunning || (batchSummary.processing + batchSummary.queued === 0)}
                className="cursor-pointer text-xs px-3 py-1.5 rounded border border-error/30 text-error hover:bg-error/10 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                取消全部识别
              </button>
              <button
                type="button"
                onClick={() => setShowBatchModal(false)}
                disabled={isBatchRunning}
                className="cursor-pointer text-xs px-3 py-1.5 rounded bg-primary text-white hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isBatchRunning ? '处理中...' : '关闭'}
              </button>
            </div>
          </div>
        </div>
      )}

      <InterviewInviteModal
        open={Boolean(inviteCandidate)}
        candidate={inviteCandidate}
        onClose={() => setInviteCandidate(null)}
        onSaved={() => navigate('/interviews')}
      />
    </div>
  );
}





