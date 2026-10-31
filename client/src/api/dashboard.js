import { request } from './http.js';

export function getHomeOverview() {
  return request('/api/dashboard/home');
}

// Cohort trend lines: the average of ONE dimension per (parameter, assignment,
// period). Optional group scope narrows the roster tree.
export async function getTrends({ groupId = null, dimension = 'quality' } = {}) {
  const params = new URLSearchParams({ dimension });
  if (groupId) params.set('groupId', groupId);
  const data = await request(`/api/dashboard/trends?${params}`);
  return data.trends;
}

// The constellation's per-student expectation vs answer counts (expected =
// selected cells; a stored row IS the expectation). Whole-group rows expand
// per current member; member rows shadow the group row.
export async function getSummary({ groupId = null, assignmentId = null } = {}) {
  const params = new URLSearchParams();
  if (groupId) params.set('groupId', groupId);
  if (assignmentId) params.set('assignmentId', assignmentId);
  const data = await request(`/api/dashboard/summary?${params}`);
  return data;
}
