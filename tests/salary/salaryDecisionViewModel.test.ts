import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { evaluateSalaryDecision, mapSalaryDecisionRow } from '../../src/lib/salaryDecisionViewModel.ts';

const migrationSql = readFileSync(
  'D:/project/RecruitPro_/supabase/migrations/20260418_candidate_salary_profiles.sql',
  'utf8',
);

assert.match(
  migrationSql.toLowerCase(),
  /create table if not exists public\.candidate_salary_profiles/,
  'expected candidate_salary_profiles migration to exist',
);

const proceed = evaluateSalaryDecision({
  marketMin: 25000,
  marketMedian: 32000,
  marketMax: 40000,
  expectedMin: 28000,
  expectedMax: 34000,
  budgetMin: 26000,
  budgetMax: 38000,
  interviewStrength: 'strong',
});

assert.equal(proceed.status, 'proceed');
assert.equal(proceed.statusLabel, '可推进');
assert.deepEqual(proceed.riskFlags, []);
assert.equal(proceed.recommendedOfferMin, 32000);
assert.equal(proceed.recommendedOfferMax, 38000);

const negotiate = evaluateSalaryDecision({
  marketMin: 25000,
  marketMedian: 32000,
  marketMax: 40000,
  expectedMin: 39000,
  expectedMax: 45000,
  budgetMin: 30000,
  budgetMax: 42000,
  interviewStrength: 'strong',
});

assert.equal(negotiate.status, 'negotiate');
assert.equal(negotiate.statusLabel, '需谈判');
assert.ok(negotiate.riskFlags.includes('expectation_above_market'));
assert.ok(negotiate.riskFlags.includes('budget_pressure'));

const hold = evaluateSalaryDecision({
  marketMin: 25000,
  marketMedian: 32000,
  marketMax: 40000,
  expectedMin: 48000,
  expectedMax: 55000,
  budgetMin: 28000,
  budgetMax: 36000,
  interviewStrength: 'mixed',
});

assert.equal(hold.status, 'hold');
assert.equal(hold.statusLabel, '暂缓');
assert.ok(hold.riskFlags.includes('expectation_above_market'));
assert.ok(hold.riskFlags.includes('budget_pressure'));

const row = mapSalaryDecisionRow({
  candidateName: '吕德佳',
  positionTitle: '计算机视觉算法工程师',
  expectedMin: 38000,
  expectedMax: 45000,
  marketMin: 26000,
  marketMedian: 34000,
  marketMax: 42000,
  budgetMin: 30000,
  budgetMax: 40000,
  interviewStrength: 'strong',
});

assert.equal(row.statusLabel, '需谈判');
assert.match(row.marketRangeLabel, /26,000/);
assert.match(row.recommendedOfferRangeLabel, /34,000/);

console.log('salaryDecisionViewModel tests passed');
