export type SalaryDecisionStatus = 'proceed' | 'negotiate' | 'hold';

export type InterviewStrength = 'strong' | 'mixed' | 'weak';

export type SalaryDecisionRiskFlag =
  | 'expectation_above_market'
  | 'budget_pressure'
  | 'weak_interview_signal'
  | 'insufficient_expectation_data';

export interface SalaryDecisionInput {
  marketMin: number;
  marketMedian: number;
  marketMax: number;
  expectedMin?: number | null;
  expectedMax?: number | null;
  budgetMin?: number | null;
  budgetMax?: number | null;
  interviewStrength?: InterviewStrength;
}

export interface SalaryDecisionOutcome {
  status: SalaryDecisionStatus;
  statusLabel: string;
  riskFlags: SalaryDecisionRiskFlag[];
  recommendedOfferMin: number;
  recommendedOfferMax: number;
}

export interface SalaryDecisionRowInput extends SalaryDecisionInput {
  candidateName: string;
  positionTitle: string;
  candidateId?: string | null;
  positionId?: string | null;
}

export interface SalaryDecisionRowViewModel extends SalaryDecisionOutcome {
  candidateName: string;
  positionTitle: string;
  candidateId?: string | null;
  positionId?: string | null;
  marketRangeLabel: string;
  expectedRangeLabel: string;
  budgetRangeLabel: string;
  recommendedOfferRangeLabel: string;
}

const STATUS_LABELS: Record<SalaryDecisionStatus, string> = {
  proceed: '可推进',
  negotiate: '需谈判',
  hold: '暂缓',
};

function toFiniteAmount(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.round(value);
  }

  if (typeof value === 'string') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return Math.round(parsed);
    }
  }

  return null;
}

function pickUpperBound(minValue?: number | null, maxValue?: number | null): number | null {
  const values = [toFiniteAmount(minValue), toFiniteAmount(maxValue)].filter((value): value is number => value !== null);
  if (values.length === 0) {
    return null;
  }

  return Math.max(...values);
}

function pickLowerBound(minValue?: number | null, maxValue?: number | null): number | null {
  const values = [toFiniteAmount(minValue), toFiniteAmount(maxValue)].filter((value): value is number => value !== null);
  if (values.length === 0) {
    return null;
  }

  return Math.min(...values);
}

function formatAmount(value: number | null | undefined): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return '未提供';
  }

  return new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 0 }).format(value);
}

function formatRange(minValue: number | null | undefined, maxValue: number | null | undefined): string {
  if (minValue == null && maxValue == null) {
    return '未提供';
  }

  if (minValue == null) {
    return formatAmount(maxValue);
  }

  if (maxValue == null || minValue === maxValue) {
    return formatAmount(minValue);
  }

  return `${formatAmount(minValue)} - ${formatAmount(maxValue)}`;
}

function buildRiskFlags(input: SalaryDecisionInput, expectedTop: number | null, budgetTop: number | null): SalaryDecisionRiskFlag[] {
  const risks: SalaryDecisionRiskFlag[] = [];

  if (expectedTop === null) {
    risks.push('insufficient_expectation_data');
  }

  if (expectedTop !== null && expectedTop > input.marketMax) {
    risks.push('expectation_above_market');
  }

  if (expectedTop !== null && budgetTop !== null && expectedTop > budgetTop) {
    risks.push('budget_pressure');
  }

  if (input.interviewStrength === 'weak') {
    risks.push('weak_interview_signal');
  }

  return risks;
}

function evaluateStatus(input: SalaryDecisionInput, expectedTop: number | null, budgetTop: number | null): SalaryDecisionStatus {
  if (expectedTop === null) {
    return 'hold';
  }

  const withinMarket = expectedTop <= input.marketMax;
  const withinBudget = budgetTop === null || expectedTop <= budgetTop;

  if (withinMarket && withinBudget && input.interviewStrength !== 'weak') {
    return 'proceed';
  }

  const marketStretch = input.interviewStrength === 'strong' ? 1.2 : 1.1;
  const budgetStretch = input.interviewStrength === 'strong' ? 1.15 : 1.08;
  const marketCeiling = Math.round(input.marketMax * marketStretch);
  const budgetCeiling = budgetTop === null ? null : Math.round(budgetTop * budgetStretch);

  if (expectedTop <= marketCeiling && (budgetCeiling === null || expectedTop <= budgetCeiling) && input.interviewStrength !== 'weak') {
    return 'negotiate';
  }

  return 'hold';
}

function buildOutcome(input: SalaryDecisionInput): SalaryDecisionOutcome {
  const expectedTop = pickUpperBound(input.expectedMin, input.expectedMax);
  const budgetTop = pickUpperBound(input.budgetMin, input.budgetMax);
  const recommendedOfferMax = budgetTop ?? input.marketMax;
  const recommendedOfferMin = Math.min(Math.max(input.marketMin, input.marketMedian), recommendedOfferMax);
  const status = evaluateStatus(input, expectedTop, budgetTop);

  return {
    status,
    statusLabel: STATUS_LABELS[status],
    riskFlags: buildRiskFlags(input, expectedTop, budgetTop),
    recommendedOfferMin,
    recommendedOfferMax,
  };
}

export function evaluateSalaryDecision(input: SalaryDecisionInput): SalaryDecisionOutcome {
  return buildOutcome(input);
}

export function mapSalaryDecisionRow(input: SalaryDecisionRowInput): SalaryDecisionRowViewModel {
  const outcome = buildOutcome(input);
  const expectedMin = pickLowerBound(input.expectedMin, input.expectedMax);
  const expectedMax = pickUpperBound(input.expectedMin, input.expectedMax);
  const budgetMin = pickLowerBound(input.budgetMin, input.budgetMax);
  const budgetMax = pickUpperBound(input.budgetMin, input.budgetMax);

  return {
    ...outcome,
    candidateName: input.candidateName,
    positionTitle: input.positionTitle,
    candidateId: input.candidateId ?? null,
    positionId: input.positionId ?? null,
    marketRangeLabel: formatRange(input.marketMin, input.marketMax),
    expectedRangeLabel: formatRange(expectedMin, expectedMax),
    budgetRangeLabel: formatRange(budgetMin, budgetMax),
    recommendedOfferRangeLabel: formatRange(outcome.recommendedOfferMin, outcome.recommendedOfferMax),
  };
}
