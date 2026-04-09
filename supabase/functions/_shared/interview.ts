export type QuestionDimension =
  | 'role_fit'
  | 'technical_depth'
  | 'project_evidence'
  | 'problem_solving'
  | 'communication'
  | 'ownership';

export interface InterviewQuestion {
  id: string;
  dimension: QuestionDimension;
  prompt: string;
  difficulty: 'easy' | 'medium' | 'hard';
  expected_signals: string[];
}

export interface CandidateLight {
  id: string;
  name: string;
  title: string | null;
  prev_company: string | null;
  highlight: string | null;
  resume_skills?: string[];
  resume_projects?: string[];
  resume_work_items?: string[];
}

export interface PositionLight {
  id: string;
  title: string;
  department: string | null;
  technical_requirements: string | null;
  min_exp: number | null;
  min_edu: string | null;
}

export interface InterviewTurnLite {
  id: string;
  turn_no: number;
  speaker: 'system' | 'ai' | 'candidate' | 'interviewer';
  content: string;
  metadata: Record<string, unknown> | null;
  created_at: string;
}

export interface ScoreOutput {
  overall_score: number;
  dimension_scores: Record<QuestionDimension, number>;
  strengths: string[];
  risks: string[];
  recommendation: 'hire' | 'hold' | 'reject' | 'needs_review';
  risk_score: number;
  evidence: Array<{ turn_id: string; turn_no: number; excerpt: string }>;
  summary: string;
  scoring_profile: 'general' | 'technical' | 'business' | 'leadership';
  min_answer_required: number;
  answered_count: number;
  question_count: number;
  low_quality_count: number;
  low_quality_ratio: number;
  hard_reject_triggered: boolean;
}

export interface FollowUpDecision {
  should_followup: boolean;
  reason: string;
  missing_signals: string[];
  answer_quality: 'low' | 'medium' | 'good';
}

type ScoreWeightProfile = {
  name: 'general' | 'technical' | 'business' | 'leadership';
  weights: Record<QuestionDimension, number>;
};

type AnalyzedAnswer = {
  turn: InterviewTurnLite;
  text: string;
  dimension: QuestionDimension | null;
  lowQuality: boolean;
  lowQualityReason: string;
};

const DETAIL_KEYWORDS = ['指标', '延迟', 'qps', '吞吐', '故障', '成本', '稳定性', '压测', '优化', '权衡'];
const PROBLEM_KEYWORDS = ['原因', '分析', '方案', '取舍', '验证', '复盘', '回滚', '监控', '风险'];
const OWNERSHIP_KEYWORDS = ['我负责', '我主导', '推动', '协调', 'owner', '主导', '带领', '跨团队'];
const DIMENSION_KEYS: QuestionDimension[] = [
  'role_fit',
  'technical_depth',
  'project_evidence',
  'problem_solving',
  'communication',
  'ownership'
];
const DIMENSION_ZH: Record<QuestionDimension, string> = {
  role_fit: '岗位匹配度',
  technical_depth: '技术深度',
  project_evidence: '项目证据',
  problem_solving: '问题解决',
  communication: '沟通表达',
  ownership: '主导力'
};
const RECOMMENDATION_ZH: Record<'hire' | 'hold' | 'reject' | 'needs_review', string> = {
  hire: '建议通过',
  hold: '建议保留',
  reject: '建议淘汰',
  needs_review: '建议复核'
};

function clamp(value: number, min = 0, max = 100): number {
  return Math.max(min, Math.min(max, Math.round(value)));
}

function normalizeText(input: string | null | undefined): string {
  return (input ?? '').trim();
}

function splitSkills(text: string): string[] {
  return text
    .split(/[\n,，;；、|/ ]+/)
    .map((item) => item.trim())
    .filter((item) => item.length >= 2)
    .slice(0, 20);
}

function unique(items: string[]): string[] {
  return [...new Set(items.map((item) => item.toLowerCase()))];
}

function countHits(text: string, keywords: string[]): number {
  if (!text) return 0;
  const normalized = text.toLowerCase();
  return keywords.reduce((sum, keyword) => (normalized.includes(keyword.toLowerCase()) ? sum + 1 : sum), 0);
}

function average(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function isDimension(value: unknown): value is QuestionDimension {
  return (
    value === 'role_fit' ||
    value === 'technical_depth' ||
    value === 'project_evidence' ||
    value === 'problem_solving' ||
    value === 'communication' ||
    value === 'ownership'
  );
}

function getMetaKind(metadata: Record<string, unknown> | null): string {
  if (!metadata || typeof metadata !== 'object') return '';
  const kind = metadata.kind;
  return typeof kind === 'string' ? kind : '';
}

function getMetaDimension(metadata: Record<string, unknown> | null): QuestionDimension | null {
  if (!metadata || typeof metadata !== 'object') return null;
  const dimension = metadata.dimension;
  return isDimension(dimension) ? dimension : null;
}

function getMetaBasedTurnNo(metadata: Record<string, unknown> | null): number | null {
  if (!metadata || typeof metadata !== 'object') return null;
  const raw = metadata.based_on_turn_no;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

function toPercent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function extractTokens(text: string): string[] {
  const tokens = text.match(/[\u4e00-\u9fa5]{1,}|[a-zA-Z]+|\d+/g);
  return tokens ? tokens.map((token) => token.toLowerCase()) : [];
}

function isLowQualityAnswer(text: string): { low: boolean; reason: string } {
  const normalized = normalizeText(text);
  if (!normalized) return { low: true, reason: '空回答' };

  const compact = normalized.replace(/\s+/g, '');
  if (compact.length < 12) return { low: true, reason: '回答过短' };
  if (/^([0-9a-zA-Z\u4e00-\u9fa5])\1{9,}$/u.test(compact)) {
    return { low: true, reason: '大量重复字符' };
  }

  const charCounts = new Map<string, number>();
  for (const char of compact) {
    charCounts.set(char, (charCounts.get(char) ?? 0) + 1);
  }
  const topCharCount = Math.max(...charCounts.values());
  const charDominance = topCharCount / compact.length;

  const tokens = extractTokens(normalized);
  const uniqueTokenCount = new Set(tokens).size;
  const uniqueTokenRate = tokens.length > 0 ? uniqueTokenCount / tokens.length : 0;

  const pureNumberLike = /^[\d\W_]+$/u.test(normalized) || /^\d{10,}$/u.test(compact);
  if (pureNumberLike) return { low: true, reason: '内容接近纯数字或无语义符号' };

  if (tokens.length >= 6 && uniqueTokenRate < 0.35 && charDominance > 0.42) {
    return { low: true, reason: '词汇重复度过高' };
  }

  if (tokens.length < 4 && normalized.length < 30) {
    return { low: true, reason: '信息量不足' };
  }

  return { low: false, reason: '' };
}

function resolveScoreWeightProfile(positionTitle: string): ScoreWeightProfile {
  const title = normalizeText(positionTitle).toLowerCase();

  if (
    title.includes('算法') ||
    title.includes('开发') ||
    title.includes('工程师') ||
    title.includes('架构') ||
    title.includes('ai')
  ) {
    return {
      name: 'technical',
      weights: {
        role_fit: 0.18,
        technical_depth: 0.3,
        project_evidence: 0.2,
        problem_solving: 0.16,
        communication: 0.08,
        ownership: 0.08
      }
    };
  }

  if (title.includes('产品') || title.includes('运营') || title.includes('销售') || title.includes('市场')) {
    return {
      name: 'business',
      weights: {
        role_fit: 0.22,
        technical_depth: 0.1,
        project_evidence: 0.13,
        problem_solving: 0.18,
        communication: 0.22,
        ownership: 0.15
      }
    };
  }

  if (title.includes('负责人') || title.includes('经理') || title.includes('总监') || title.includes('leader')) {
    return {
      name: 'leadership',
      weights: {
        role_fit: 0.18,
        technical_depth: 0.14,
        project_evidence: 0.12,
        problem_solving: 0.18,
        communication: 0.18,
        ownership: 0.2
      }
    };
  }

  return {
    name: 'general',
    weights: {
      role_fit: 0.2,
      technical_depth: 0.26,
      project_evidence: 0.18,
      problem_solving: 0.16,
      communication: 0.1,
      ownership: 0.1
    }
  };
}

export function extractSkillsFromRequirement(requirementText: string | null): string[] {
  const base = normalizeText(requirementText);
  if (!base) return [];
  return unique(splitSkills(base)).slice(0, 8);
}

function dedupeKeepOrder(items: string[]): string[] {
  const seen = new Set<string>();
  const output: string[] = [];
  for (const item of items) {
    const normalized = normalizeText(item);
    if (!normalized) continue;
    const key = normalized.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(normalized);
  }
  return output;
}

function mergeResumeSkillHints(candidate: CandidateLight): string[] {
  const titleSkills = splitSkills(normalizeText(candidate.title));
  const highlightSkills = splitSkills(normalizeText(candidate.highlight));
  const resumeSkills = Array.isArray(candidate.resume_skills) ? candidate.resume_skills : [];
  return dedupeKeepOrder([...resumeSkills, ...titleSkills, ...highlightSkills]).slice(0, 12);
}

function buildQuestionPromptWithSkill(baseSkill: string | null, fallbackPrompt: string): string {
  const skill = normalizeText(baseSkill);
  if (!skill) return fallbackPrompt;
  return `围绕 ${skill}，讲一个你亲自处理过的复杂场景：背景、关键动作、技术取舍与结果。`;
}

function pickPersonalizedProjectHint(candidate: CandidateLight): string {
  const projectHint = Array.isArray(candidate.resume_projects) ? candidate.resume_projects[0] : '';
  if (projectHint && normalizeText(projectHint)) return normalizeText(projectHint);
  if (candidate.prev_company) return `${candidate.prev_company} 相关项目`;
  return '你最近一个最有代表性的项目';
}

function pickPersonalizedWorkHint(candidate: CandidateLight): string {
  const workHint = Array.isArray(candidate.resume_work_items) ? candidate.resume_work_items[0] : '';
  if (workHint && normalizeText(workHint)) return normalizeText(workHint);
  if (candidate.title) return `${candidate.title} 岗位经历`;
  return '你最近一段工作经历';
}

export function buildQuestionPlan(candidate: CandidateLight, position: PositionLight): InterviewQuestion[] {
  const positionTitle = normalizeText(position.title) || '该岗位';
  const jdSkills = extractSkillsFromRequirement(position.technical_requirements);
  const candidateSkills = mergeResumeSkillHints(candidate);
  const projectHint = pickPersonalizedProjectHint(candidate);
  const workHint = pickPersonalizedWorkHint(candidate);

  const matchedSkills = jdSkills.filter((jdSkill) =>
    candidateSkills.some((candidateSkill) => {
      const left = jdSkill.toLowerCase();
      const right = candidateSkill.toLowerCase();
      return left.includes(right) || right.includes(left);
    })
  );

  const coreSkillA = jdSkills[0] ?? matchedSkills[0] ?? '岗位核心技术';
  const coreSkillB = jdSkills[1] ?? jdSkills[0] ?? '高并发与稳定性';
  const personalSkill = matchedSkills[0] ?? candidateSkills[0] ?? coreSkillA;

  const coreQuestions: InterviewQuestion[] = [
    {
      id: 'core-1-role-fit',
      dimension: 'role_fit',
      difficulty: 'easy',
      prompt: `请用 2 分钟介绍你与 ${positionTitle} 最相关的一段经历，并说明你选择这个岗位的核心原因。`,
      expected_signals: ['岗位动机', '相关经历', '职责匹配']
    },
    {
      id: 'core-2-tech-depth',
      dimension: 'technical_depth',
      difficulty: 'medium',
      prompt: buildQuestionPromptWithSkill(
        coreSkillA,
        '请讲一个你亲自处理过的复杂技术问题：背景、排查路径、最终方案与取舍。'
      ),
      expected_signals: ['技术细节', '排查路径', '方案取舍', '结果']
    },
    {
      id: 'core-3-problem-solving',
      dimension: 'problem_solving',
      difficulty: 'hard',
      prompt: `如果 ${coreSkillB} 相关链路在高峰期出现抖动，你会如何在 30 分钟内完成止损、定位和恢复？`,
      expected_signals: ['优先级', '应急动作', '验证与回滚']
    },
    {
      id: 'core-4-communication',
      dimension: 'communication',
      difficulty: 'medium',
      prompt: '讲一个你与产品/测试/业务存在明显分歧的案例，你如何达成一致并推进上线？',
      expected_signals: ['沟通对象', '分歧处理', '协作结果']
    },
    {
      id: 'core-5-ownership',
      dimension: 'ownership',
      difficulty: 'medium',
      prompt: '过去一年你主导推进的最有代表性改进是什么？你为何主导、如何推进、最终影响是什么？',
      expected_signals: ['主导动作', '跨团队推动', '业务/技术影响']
    }
  ];

  const personalizedQuestions: InterviewQuestion[] = [
    {
      id: 'per-1-project-evidence',
      dimension: 'project_evidence',
      difficulty: 'medium',
      prompt: `你简历里提到“${projectHint}”，请拆解这段经历：你的具体职责、关键决策、量化结果分别是什么？`,
      expected_signals: ['职责边界', '关键动作', '量化结果']
    },
    {
      id: 'per-2-skill-evidence',
      dimension: 'technical_depth',
      difficulty: 'hard',
      prompt: `结合你在 ${personalSkill} 上的实践，讲一个你做过技术取舍的案例：为什么这么选？备选方案是什么？`,
      expected_signals: ['方案对比', '取舍原因', '最终结果']
    },
    {
      id: 'per-3-work-fit',
      dimension: 'project_evidence',
      difficulty: 'medium',
      prompt: `围绕“${workHint}”，请说明你亲自负责的关键任务、你推动的改进，以及可验证的产出指标。`,
      expected_signals: ['亲自负责', '改进动作', '可验证证据']
    }
  ];

  const questions = [...coreQuestions, ...personalizedQuestions];
  return questions.slice(0, 8);
}

function hasMetricSignal(text: string): boolean {
  const metricPattern = /(\d+(\.\d+)?\s*(%|ms|s|秒|分钟|小时|天|周|月|年|万|千|qps|tps|k|w))|(\d+%)/i;
  return metricPattern.test(text);
}

function analyzeDimensionMissingSignals(dimension: QuestionDimension, text: string): string[] {
  const normalized = normalizeText(text);
  if (!normalized) return ['回答为空'];

  const checks: Record<QuestionDimension, Array<{ label: string; pattern: RegExp }>> = {
    role_fit: [
      { label: '岗位动机', pattern: /为什么|动机|原因|匹配|兴趣|选择/i },
      { label: '相关经历', pattern: /做过|负责|经历|项目|场景/i }
    ],
    technical_depth: [
      { label: '技术细节', pattern: /架构|模块|组件|链路|实现|优化|排查|调优/i },
      { label: '方案取舍', pattern: /取舍|权衡|对比|备选|折中/i }
    ],
    project_evidence: [
      { label: '职责边界', pattern: /我负责|我主导|我做了|owner|牵头/i },
      { label: '关键动作', pattern: /设计|实现|推进|改造|上线|复盘/i }
    ],
    problem_solving: [
      { label: '定位与分析', pattern: /定位|排查|分析|根因|监控/i },
      { label: '应急与恢复', pattern: /止损|回滚|降级|兜底|恢复|验证/i }
    ],
    communication: [
      { label: '沟通对象', pattern: /产品|测试|业务|研发|跨团队|同学|stakeholder/i },
      { label: '达成一致过程', pattern: /对齐|沟通|协调|共识|方案评审|推进/i }
    ],
    ownership: [
      { label: '主导动作', pattern: /我主导|我负责|推动|牵头|owner/i },
      { label: '结果影响', pattern: /结果|影响|收益|提升|下降|稳定|效率/i }
    ]
  };

  const missing = checks[dimension]
    .filter((item) => !item.pattern.test(normalized))
    .map((item) => item.label);

  const requiresMetric = dimension === 'technical_depth' || dimension === 'project_evidence' || dimension === 'problem_solving';
  if (requiresMetric && !hasMetricSignal(normalized)) {
    missing.push('量化结果');
  }

  return missing;
}

export function decideFollowUp(question: InterviewQuestion | null, answer: string): FollowUpDecision {
  const low = isLowQualityAnswer(answer);
  const dimension = question?.dimension ?? 'project_evidence';
  const missingSignals = analyzeDimensionMissingSignals(dimension, answer);

  if (low.low) {
    return {
      should_followup: true,
      reason: low.reason,
      missing_signals: missingSignals.slice(0, 3),
      answer_quality: 'low'
    };
  }

  const answerLen = normalizeText(answer).replace(/\s+/g, '').length;
  const shouldFollowUp = missingSignals.length >= 2 || (answerLen < 36 && missingSignals.length >= 1);

  return {
    should_followup: shouldFollowUp,
    reason: shouldFollowUp ? '关键信息缺失' : '',
    missing_signals: missingSignals.slice(0, 3),
    answer_quality: shouldFollowUp ? 'medium' : 'good'
  };
}

export function buildFollowUpPrompt(question: InterviewQuestion | null, answer: string, decision?: FollowUpDecision): string {
  const result = decision ?? decideFollowUp(question, answer);

  if (result.answer_quality === 'low') {
    return '追问：请按“背景-任务-动作-结果”补充作答，至少包含 1 个量化指标（如时延、成功率、成本或效率变化）。';
  }

  if (result.missing_signals.length > 0) {
    return `追问：请重点补充 ${result.missing_signals.join('、')}，并说明你亲自做了什么，以及最终如何验证结果。`;
  }

  return '追问：请补充这次决策背后的备选方案与最终取舍依据。';
}

export function normalizeQuestionPlan(raw: unknown): InterviewQuestion[] {
  if (!Array.isArray(raw)) return [];

  const output: InterviewQuestion[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const record = item as Record<string, unknown>;
    const id = normalizeText(String(record.id ?? ''));
    const prompt = normalizeText(typeof record.prompt === 'string' ? record.prompt : '');
    const dimension = normalizeText(typeof record.dimension === 'string' ? record.dimension : '') as QuestionDimension;
    const difficulty = normalizeText(typeof record.difficulty === 'string' ? record.difficulty : '') as 'easy' | 'medium' | 'hard';

    if (!id || !prompt) continue;

    output.push({
      id,
      prompt,
      dimension:
        dimension === 'role_fit' ||
        dimension === 'technical_depth' ||
        dimension === 'project_evidence' ||
        dimension === 'problem_solving' ||
        dimension === 'communication' ||
        dimension === 'ownership'
          ? dimension
          : 'technical_depth',
      difficulty: difficulty === 'easy' || difficulty === 'medium' || difficulty === 'hard' ? difficulty : 'medium',
      expected_signals: Array.isArray(record.expected_signals)
        ? record.expected_signals.map((entry) => String(entry)).filter(Boolean)
        : []
    });
  }

  return output;
}

export function buildNextQuestionPrompt(plan: InterviewQuestion[], askedQuestionCount: number): InterviewQuestion | null {
  if (askedQuestionCount < 0 || askedQuestionCount >= plan.length) return null;
  return plan[askedQuestionCount];
}


export function scoreInterview(
  turns: InterviewTurnLite[],
  questionPlan: InterviewQuestion[],
  positionTitle: string,
  positionSkills: string[],
  candidateTitle: string | null
): ScoreOutput {
  const sortedTurns = turns.slice().sort((a, b) => a.turn_no - b.turn_no);

  const aiDimensionByTurnNo = new Map<number, QuestionDimension>();
  for (const turn of sortedTurns) {
    if (turn.speaker !== 'ai') continue;

    const kind = getMetaKind(turn.metadata);
    if (kind === 'question') {
      const dimension = getMetaDimension(turn.metadata);
      if (dimension) aiDimensionByTurnNo.set(turn.turn_no, dimension);
      continue;
    }

    if (kind === 'followup') {
      const basedTurnNo = getMetaBasedTurnNo(turn.metadata);
      if (!basedTurnNo) continue;
      const baseDimension = aiDimensionByTurnNo.get(basedTurnNo);
      if (baseDimension) aiDimensionByTurnNo.set(turn.turn_no, baseDimension);
    }
  }

  const aiTimeline = [...aiDimensionByTurnNo.entries()]
    .map(([turnNo, dimension]) => ({ turnNo, dimension }))
    .sort((a, b) => a.turnNo - b.turnNo);

  const resolveAnswerDimension = (candidateTurnNo: number): QuestionDimension | null => {
    let selected: QuestionDimension | null = null;
    for (const point of aiTimeline) {
      if (point.turnNo >= candidateTurnNo) break;
      selected = point.dimension;
    }
    return selected;
  };

  const candidateTurns = sortedTurns.filter(
    (turn) => turn.speaker === 'candidate' && normalizeText(turn.content).length > 0
  );

  const analyzedAnswers: AnalyzedAnswer[] = candidateTurns.map((turn) => {
    const text = normalizeText(turn.content);
    const lowQuality = isLowQualityAnswer(text);
    return {
      turn,
      text,
      dimension: resolveAnswerDimension(turn.turn_no),
      lowQuality: lowQuality.low,
      lowQualityReason: lowQuality.reason
    };
  });

  const validAnswers = analyzedAnswers.filter((answer) => !answer.lowQuality);
  const lowQualityAnswers = analyzedAnswers.filter((answer) => answer.lowQuality);

  const allValidText = validAnswers.map((answer) => answer.text).join('\n');
  const normalizedAllValidText = allValidText.toLowerCase();

  const skillHitsGlobal = positionSkills.filter((skill) => normalizedAllValidText.includes(skill.toLowerCase())).length;
  const skillRateGlobal = positionSkills.length > 0 ? skillHitsGlobal / positionSkills.length : 0.45;
  const roleSignal = normalizeText(candidateTitle).toLowerCase().includes(normalizeText(positionTitle).toLowerCase()) ? 1 : 0;

  const questionCount = questionPlan.length;
  const minAnswerRequired = questionCount > 0 ? Math.max(4, Math.ceil(questionCount * 0.6)) : 4;

  const questionCountByDimension: Record<QuestionDimension, number> = {
    role_fit: 0,
    technical_depth: 0,
    project_evidence: 0,
    problem_solving: 0,
    communication: 0,
    ownership: 0
  };
  for (const question of questionPlan) {
    questionCountByDimension[question.dimension] += 1;
  }

  const validCountByDimension: Record<QuestionDimension, number> = {
    role_fit: 0,
    technical_depth: 0,
    project_evidence: 0,
    problem_solving: 0,
    communication: 0,
    ownership: 0
  };
  for (const answer of validAnswers) {
    if (answer.dimension) validCountByDimension[answer.dimension] += 1;
  }

  const scoringProfile = resolveScoreWeightProfile(positionTitle);

  const metricPattern = /(\d+(\.\d+)?\s*(%|ms|s|秒|分钟|小时|天|周|月|年|万|千|qps|tps|w|k))|(\d+%)/i;
  const structurePattern = /首先|其次|最后|第一|第二|第三|then|finally|because|therefore/i;

  const scoreByDimension = (dimension: QuestionDimension): number => {
    const answers = validAnswers.filter((answer) => answer.dimension === dimension);
    const text = answers.map((answer) => answer.text).join('\n');
    const normalizedText = text.toLowerCase();

    const avgLen = average(answers.map((answer) => answer.text.length));
    const detailHits = countHits(normalizedText, DETAIL_KEYWORDS);
    const problemHits = countHits(normalizedText, PROBLEM_KEYWORDS);
    const ownershipHits = countHits(normalizedText, OWNERSHIP_KEYWORDS);
    const metricSignal = metricPattern.test(text) ? 1 : 0;
    const structureSignal = structurePattern.test(text) ? 1 : 0;

    const skillHits = positionSkills.filter((skill) => normalizedText.includes(skill.toLowerCase())).length;
    const skillRate = positionSkills.length > 0 ? skillHits / positionSkills.length : skillRateGlobal;

    const askedCount = questionCountByDimension[dimension];
    const answeredCount = validCountByDimension[dimension];
    const coverage = askedCount > 0 ? answeredCount / askedCount : answeredCount > 0 ? 1 : 0;

    let raw = 35;
    if (dimension === 'role_fit') {
      raw = 26 + roleSignal * 20 + skillRateGlobal * 20 + Math.min(16, avgLen / 12) + (answeredCount > 0 ? 10 : 0);
    } else if (dimension === 'technical_depth') {
      raw = 22 + skillRate * 44 + Math.min(24, detailHits * 4) + metricSignal * 8 + Math.min(10, answeredCount * 4);
    } else if (dimension === 'project_evidence') {
      raw = 22 + metricSignal * 18 + Math.min(24, detailHits * 4) + Math.min(18, avgLen / 10);
    } else if (dimension === 'problem_solving') {
      raw = 24 + Math.min(36, problemHits * 5) + Math.min(14, detailHits * 2) + structureSignal * 8;
    } else if (dimension === 'communication') {
      raw = 30 + structureSignal * 20 + Math.min(20, avgLen / 11) + Math.min(10, answeredCount * 3);
    } else if (dimension === 'ownership') {
      raw = 24 + Math.min(40, ownershipHits * 7) + Math.min(12, detailHits * 2) + Math.min(8, answeredCount * 3);
    }

    if (askedCount > 0 && answeredCount === 0) {
      raw = Math.min(raw, 38);
    }

    const coveragePenalty = askedCount > 0 && coverage < 0.6 ? Math.min(20, Math.round((0.6 - coverage) * 35)) : 0;
    return clamp(raw - coveragePenalty);
  };

  const dimensionScores = DIMENSION_KEYS.reduce((acc, dimension) => {
    acc[dimension] = scoreByDimension(dimension);
    return acc;
  }, {} as Record<QuestionDimension, number>);

  const weightedOverall =
    dimensionScores.role_fit * scoringProfile.weights.role_fit +
    dimensionScores.technical_depth * scoringProfile.weights.technical_depth +
    dimensionScores.project_evidence * scoringProfile.weights.project_evidence +
    dimensionScores.problem_solving * scoringProfile.weights.problem_solving +
    dimensionScores.communication * scoringProfile.weights.communication +
    dimensionScores.ownership * scoringProfile.weights.ownership;

  const validAnswerCoverage = questionCount > 0 ? validAnswers.length / questionCount : 0;
  const coveragePenalty = validAnswerCoverage < 0.6 ? Math.min(24, Math.round((0.6 - validAnswerCoverage) * 45)) : 0;

  const lowQualityCount = lowQualityAnswers.length;
  const lowQualityRatio = analyzedAnswers.length > 0 ? lowQualityCount / analyzedAnswers.length : 1;
  const waterPenalty = lowQualityCount > 0 ? Math.min(35, Math.round(lowQualityRatio * 28 + lowQualityCount * 3)) : 0;

  const hardRejectTriggered =
    (lowQualityCount >= 3 && lowQualityRatio >= 0.5) ||
    (analyzedAnswers.length >= 4 && validAnswers.length <= 1);

  const overall = clamp(weightedOverall - coveragePenalty - waterPenalty);

  const strengths = Object.entries(dimensionScores)
    .filter(([, score]) => score >= 75)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([dimension, score]) => `${DIMENSION_ZH[dimension as QuestionDimension]}表现较强（${score}分）`);

  const weakDimensionRisks = Object.entries(dimensionScores)
    .filter(([, score]) => score < 60)
    .sort((a, b) => a[1] - b[1])
    .slice(0, 3)
    .map(([dimension, score]) => `${DIMENSION_ZH[dimension as QuestionDimension]}偏弱（${score}分），建议人工复核`);

  const deductionReasons: string[] = [];
  if (validAnswers.length < minAnswerRequired) {
    deductionReasons.push(`有效回答不足（${validAnswers.length}/${minAnswerRequired}）`);
  }
  if (lowQualityCount > 0) {
    const topLowQualityReasons = unique(lowQualityAnswers.map((answer) => answer.lowQualityReason).filter(Boolean)).slice(0, 3);
    deductionReasons.push(
      `检测到低质量回答 ${lowQualityCount} 条，占比 ${toPercent(lowQualityRatio)}${
        topLowQualityReasons.length > 0 ? `（${topLowQualityReasons.join('、')}）` : ''
      }`
    );
  }
  if (hardRejectTriggered) {
    deductionReasons.push('触发灌水硬拒绝规则：低质量回答占比过高');
  }

  const risks = [...weakDimensionRisks, ...deductionReasons].slice(0, 5);

  let recommendation: 'hire' | 'hold' | 'reject' | 'needs_review' =
    overall >= 80 && risks.length <= 1
      ? 'hire'
      : overall >= 68
        ? 'hold'
        : overall >= 55
          ? 'needs_review'
          : 'reject';

  if (hardRejectTriggered) {
    recommendation = 'reject';
  } else {
    if (validAnswers.length < minAnswerRequired && recommendation !== 'reject') {
      recommendation = 'needs_review';
    }
    if (lowQualityRatio >= 0.4 && recommendation === 'hire') {
      recommendation = 'hold';
    }
    if (lowQualityRatio >= 0.55 && recommendation !== 'reject') {
      recommendation = 'needs_review';
    }
  }

  const riskScore = clamp((100 - overall) + risks.length * 8 + Math.round(lowQualityRatio * 25) + (hardRejectTriggered ? 12 : 0));

  const evidenceSource = validAnswers.length > 0 ? validAnswers : analyzedAnswers;
  const evidence = evidenceSource
    .slice()
    .sort((a, b) => b.text.length - a.text.length)
    .slice(0, 5)
    .map((answer) => ({
      turn_id: answer.turn.id,
      turn_no: answer.turn.turn_no,
      excerpt: `${answer.dimension ? `【${DIMENSION_ZH[answer.dimension]}】` : ''}${answer.text.slice(0, 180)}`
    }));

  const conclusionLine = `结论：${RECOMMENDATION_ZH[recommendation]}（总分 ${overall}，风险评分 ${riskScore}）。`;
  const evidenceLines = [
    `- 有效回答 ${validAnswers.length}/${questionCount}（最低要求 ${minAnswerRequired}）`,
    `- 低质量回答 ${lowQualityCount} 条，占比 ${toPercent(lowQualityRatio)}`
  ];
  if (strengths.length > 0) {
    evidenceLines.push(`- 主要优势：${strengths.join('；')}`);
  }

  const deductionLines =
    deductionReasons.length > 0 ? deductionReasons.map((item) => `- ${item}`) : ['- 暂无明显额外扣分项。'];

  const summary = [
    conclusionLine,
    '证据：',
    ...evidenceLines,
    '扣分原因：',
    ...deductionLines
  ].join('\n');

  return {
    overall_score: overall,
    dimension_scores: dimensionScores,
    strengths,
    risks,
    recommendation,
    risk_score: riskScore,
    evidence,
    summary,
    scoring_profile: scoringProfile.name,
    min_answer_required: minAnswerRequired,
    answered_count: validAnswers.length,
    question_count: questionCount,
    low_quality_count: lowQualityCount,
    low_quality_ratio: lowQualityRatio,
    hard_reject_triggered: hardRejectTriggered
  };
}




