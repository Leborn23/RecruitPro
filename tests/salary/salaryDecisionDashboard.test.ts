import assert from 'node:assert/strict';
import { buildSalaryDecisionDashboardPayload } from '../../src/lib/salaryDecisionDashboard.ts';

const payload = buildSalaryDecisionDashboardPayload({
  profiles: [
    {
      id: 'profile-1',
      candidate_id: 'candidate-1',
      position_id: 'position-1',
      expected_salary_min: 38000,
      expected_salary_max: 42000,
      budget_min: 36000,
      budget_max: 41000,
      offer_salary: 40000,
      offer_status: 'offered',
      notes: 'ready',
      updated_at: '2026-04-21T08:00:00Z',
    },
  ],
  candidates: [
    {
      id: 'candidate-1',
      name: 'Alex',
      title: 'Senior Frontend Engineer',
      location: 'Shanghai',
      exp: '6 years',
      prev_company: 'Example Tech',
    },
  ],
  positions: [
    {
      id: 'position-1',
      title: 'Senior Frontend Engineer',
      location: 'Shanghai',
      min_exp: 5,
      min_edu: 'Bachelor',
    },
  ],
  benchmarks: [
    {
      role_key: 'frontend',
      city_key: 'shanghai',
      level_key: 'senior',
      min_salary: 32000,
      median_salary: 36000,
      max_salary: 39000,
      sample_size: 8,
      source_count: 3,
      updated_at: '2026-04-20T08:00:00Z',
    },
  ],
});

assert.equal(payload.summary?.profile_count, 1);
assert.equal(payload.profiles?.[0]?.candidate?.name, 'Alex');
assert.equal(payload.profiles?.[0]?.market_benchmark?.median_salary, 36000);
assert.equal(payload.profiles?.[0]?.offer_vs_market?.position, 'above_market');
assert.equal(payload.profiles?.[0]?.offer_status, 'offered');

console.log('salaryDecisionDashboard tests passed');
