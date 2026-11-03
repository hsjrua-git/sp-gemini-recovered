import { request } from './http.js';

export function deleteAlert(id) { return request(`/api/alerts/${id}`, { method: 'DELETE' }); }

export async function listAlerts({ status = 'open' } = {}) {
  const query = status !== 'open' ? `?status=${encodeURIComponent(status)}` : '';
  const data = await request(`/api/alerts${query}`);
  return { alerts: data.alerts, truncated: data.truncated };
}

export function scanAlerts() {
  return request('/api/alerts/scan', { method: 'POST' });
}

export function resolveAlert(id, resolved) {
  return request(`/api/alerts/${id}`, {
    method: 'PATCH',
    body: JSON.stringify({ resolved }),
  });
}
