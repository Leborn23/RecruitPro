export type SalaryDecisionDashboardProfile = {
  id: string;
  candidate_id?: string | null;
  position_id?: string | null;
  expected_salary_min?: number | string | null;
  expected_salary_max?: number | string | null;
  current_salary?: number | string | null;
  budget_min?: number | string | null;
  budget_max?: number | string | null;
  offer_salary?: number | string | null;
  offer_status?: string | null;
  notes?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
};

export type SalaryDecisionDashboardCandidate = {
  id?: string | null;
  name?: string | null;
  title?: string | null;
  department?: string | null;
  location?: string | null;
  edu?: string | null;
  exp?: string | null;
  prev_company?: string | null;
  highlight?: string | null;
};

export type SalaryDecisionDashboardPosition = {
  id?: string | null;
  title?: string | null;
  department?: string | null;
  location?: string | null;
  status?: string | null;
  min_exp?: number | string | null;
  min_edu?: string | null;
};

export type SalaryDecisionDashboardBenchmark = {
  role_key?: string | null;
  city_key?: string | null;
  level_key?: string | null;
  min_salary?: number | string | null;
  median_salary?: number | string | null;
  max_salary?: number | string | null;
  sample_size?: number | string | null;
  source_count?: number | string | null;
  latest_source_at?: string | null;
  updated_at?: string | null;
};

export type SalaryDecisionDashboardResponse = {
  summary: {
    profile_count: number;
    candidate_count: number;
    position_count: number;
    benchmark_count: number;
    offer_status_counts: Record<string, number>;
    market_position_counts: Record<string, number>;
    latest_profile_updated_at: string | null;
  };
  profiles: Array<Record<string, unknown>>;
  benchmarks: Array<Record<string, unknown>>;
  meta: {
    as_of: string;
    source: 'supabase_fallback';
  };
};

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function toNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function nowIso(): string {
  return new Date().toISOString();
}

function normalizeOfferStatus(value: unknown): string {
  const normalized = normalizeText(value).toLowerCase();
  return normalized || 'draft';
}

function inferRoleKey(title: unknown): string {
  const text = normalizeText(title).toLowerCase();
  if (!text) return 'unknown';
  if (text.includes('前端') || text.includes('frontend') || text.includes('react') || text.includes('vue')) return 'frontend';
  if (text.includes('后端') || text.includes('backend') || text.includes('java') || text.includes('golang') || text.includes('python')) return 'backend';
  if (text.includes('全栈') || text.includes('fullstack')) return 'fullstack';
  if (text.includes('算法') || text.includes('ai') || text.includes('机器学习') || text.includes('llm')) return 'algorithm';
  if (text.includes('数据')) return 'data';
  if (text.includes('测试') || text.includes('qa')) return 'qa';
  if (text.includes('运维') || text.includes('devops') || text.includes('sre')) return 'devops';
  if (text.includes('产品')) return 'product';
  return 'unknown';
}

function inferCityKey(location: unknown): string {
  const text = normalizeText(location).toLowerCase();
  if (!text) return 'unknown';
  if (text.includes('上海') || text.includes('shanghai')) return 'shanghai';
  if (text.includes('北京') || text.includes('beijing')) return 'beijing';
  if (text.includes('深圳') || text.includes('shenzhen')) return 'shenzhen';
  if (text.includes('杭州') || text.includes('hangzhou')) return 'hangzhou';
  if (text.includes('广州') || text.includes('guangzhou')) return 'guangzhou';
  if (text.includes('remote') || text.includes('远程')) return 'remote';
  return 'unknown';
}

function estimateLevelKey(position: SalaryDecisionDashboardPosition | undefined): string {
  const minExp = toNumber(position?.min_exp);
  if (minExp === null) return 'unknown';
  if (minExp >= 5) return 'senior';
  if (minExp >= 3) return 'mid';
  return 'junior';
}

function benchmarkKey(roleKey: unknown, cityKey: unknown, levelKey: unknown): string {
  return `${normalizeText(roleKey) || 'unknown'}::${normalizeText(cityKey) || 'unknown'}::${normalizeText(levelKey) || 'unknown'}`;
}

function buildBenchmarkCard(row: SalaryDecisionDashboardBenchmark): Record<string, unknown> {
  const roleKey = normalizeText(row.role_key) || 'unknown';
  const cityKey = normalizeText(row.city_key) || 'unknown';
  const levelKey = normalizeText(row.level_key) || 'unknown';

  return {
    key: benchmarkKey(roleKey, cityKey, levelKey),
    role_key: roleKey,
    city_key: cityKey,
    level_key: levelKey,
    min_salary: Math.round(toNumber(row.min_salary) ?? 0),
    median_salary: Math.round(toNumber(row.median_salary) ?? 0),
    max_salary: Math.round(toNumber(row.max_salary) ?? 0),
    sample_size: Math.round(toNumber(row.sample_size) ?? 0),
    source_count: Math.round(toNumber(row.source_count) ?? 0),
    latest_source_at: normalizeText(row.latest_source_at) || null,
    updated_at: normalizeText(row.updated_at) || null,
  };
}

function findBenchmark(
  lookup: Map<string, Record<string, unknown>>,
  roleKey: string,
  cityKey: string,
  levelKey: string,
): { benchmark: Record<string, unknown> | null; matchType: string } {
  const candidates = [
    { roleKey, cityKey, levelKey, matchType: 'exact' },
    { roleKey, cityKey: 'unknown', levelKey, matchType: 'city_fallback' },
    { roleKey, cityKey, levelKey: 'unknown', matchType: 'level_fallback' },
    { roleKey, cityKey: 'unknown', levelKey: 'unknown', matchType: 'broad_fallback' },
  ];

  for (const candidate of candidates) {
    const match = lookup.get(benchmarkKey(candidate.roleKey, candidate.cityKey, candidate.levelKey));
    if (match) return { benchmark: match, matchType: candidate.matchType };
  }

  return { benchmark: null, matchType: 'none' };
}

function pickFields<T extends Record<string, unknown>>(row: T | undefined, fields: string[]): Record<string, unknown> | null {
  if (!row) return null;
  const output: Record<string, unknown> = {};
  for (const field of fields) {
    if (field in row) output[field] = row[field];
  }
  return output;
}

function buildProfileCard(
  profile: SalaryDecisionDashboardProfile,
  candidateLookup: Map<string, SalaryDecisionDashboardCandidate>,
  positionLookup: Map<string, SalaryDecisionDashboardPosition>,
  benchmarkLookup: Map<string, Record<string, unknown>>,
): Record<string, unknown> {
  const candidateId = normalizeText(profile.candidate_id) || null;
  const positionId = normalizeText(profile.position_id) || null;
  const candidate = candidateId ? candidateLookup.get(candidateId) : undefined;
  const position = positionId ? positionLookup.get(positionId) : undefined;

  const roleKey = inferRoleKey(position?.title ?? candidate?.title);
  const cityKey = inferCityKey(position?.location ?? candidate?.location);
  const levelKey = estimateLevelKey(position);
  const { benchmark, matchType } = findBenchmark(benchmarkLookup, roleKey, cityKey, levelKey);
  const offerSalary = toNumber(profile.offer_salary);

  let marketPosition = 'unknown';
  let offerVsMarket: Record<string, unknown> = {
    delta_to_min: null,
    delta_to_median: null,
    delta_to_max: null,
    position: 'unknown',
  };

  const minSalary = toNumber(benchmark?.min_salary);
  const medianSalary = toNumber(benchmark?.median_salary);
  const maxSalary = toNumber(benchmark?.max_salary);

  if (benchmark && offerSalary !== null && minSalary !== null && medianSalary !== null && maxSalary !== null) {
    marketPosition = offerSalary < minSalary ? 'below_market' : offerSalary > maxSalary ? 'above_market' : 'within_market';
    offerVsMarket = {
      delta_to_min: Math.round(offerSalary - minSalary),
      delta_to_median: Math.round(offerSalary - medianSalary),
      delta_to_max: Math.round(offerSalary - maxSalary),
      position: marketPosition,
    };
  }

  return {
    id: profile.id,
    candidate_id: candidateId,
    position_id: positionId,
    expected_salary_min: profile.expected_salary_min ?? null,
    expected_salary_max: profile.expected_salary_max ?? null,
    current_salary: profile.current_salary ?? null,
    budget_min: profile.budget_min ?? null,
    budget_max: profile.budget_max ?? null,
    offer_salary: offerSalary,
    offer_status: normalizeOfferStatus(profile.offer_status),
    notes: normalizeText(profile.notes) || null,
    created_at: normalizeText(profile.created_at) || null,
    updated_at: normalizeText(profile.updated_at) || null,
    candidate: pickFields(candidate, ['id', 'name', 'title', 'department', 'location', 'edu', 'exp', 'prev_company', 'highlight']),
    position: pickFields(position, ['id', 'title', 'department', 'location', 'status', 'min_exp', 'min_edu']),
    market_benchmark: benchmark ? { ...benchmark, match_type: matchType } : null,
    market_position: marketPosition,
    offer_vs_market: offerVsMarket,
  };
}

export function buildSalaryDecisionDashboardPayload(input: {
  profiles: SalaryDecisionDashboardProfile[];
  candidates: SalaryDecisionDashboardCandidate[];
  positions: SalaryDecisionDashboardPosition[];
  benchmarks: SalaryDecisionDashboardBenchmark[];
}): SalaryDecisionDashboardResponse {
  const candidateLookup = new Map(
    input.candidates
      .map((candidate) => [normalizeText(candidate.id), candidate] as const)
      .filter(([id]) => Boolean(id)),
  );

  const positionLookup = new Map(
    input.positions
      .map((position) => [normalizeText(position.id), position] as const)
      .filter(([id]) => Boolean(id)),
  );

  const benchmarkCards = input.benchmarks.map(buildBenchmarkCard);
  const benchmarkLookup = new Map(benchmarkCards.map((benchmark) => [String(benchmark.key), benchmark] as const));
  const profiles = input.profiles.map((profile) => buildProfileCard(profile, candidateLookup, positionLookup, benchmarkLookup));

  const offerStatusCounts: Record<string, number> = {};
  const marketPositionCounts: Record<string, number> = {};

  for (const profile of profiles) {
    const offerStatus = normalizeOfferStatus(profile.offer_status);
    offerStatusCounts[offerStatus] = (offerStatusCounts[offerStatus] ?? 0) + 1;

    const marketPosition = normalizeText(profile.market_position) || 'unknown';
    marketPositionCounts[marketPosition] = (marketPositionCounts[marketPosition] ?? 0) + 1;
  }

  return {
    summary: {
      profile_count: profiles.length,
      candidate_count: candidateLookup.size,
      position_count: positionLookup.size,
      benchmark_count: benchmarkCards.length,
      offer_status_counts: offerStatusCounts,
      market_position_counts: marketPositionCounts,
      latest_profile_updated_at: (profiles[0]?.updated_at as string | null | undefined) ?? null,
    },
    profiles,
    benchmarks: benchmarkCards,
    meta: {
      as_of: nowIso(),
      source: 'supabase_fallback',
    },
  };
}
