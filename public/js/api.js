// Thin wrappers around the server's JSON endpoints.

class ApiError extends Error {
  constructor(status, message) {
    super(message || `Request failed with status ${status}`);
    this.name = 'ApiError';
    this.status = status;
  }
}

async function request(path, options = {}) {
  const response = await fetch(path, { cache: 'no-store', ...options });
  if (!response.ok) throw new ApiError(response.status, await response.text().catch(() => ''));
  return response.json();
}

/** @returns {Promise<{count: number, eventText: string, clicked: boolean}>} */
export function getState() {
  return request('/api/state');
}

/** @returns {Promise<{count: number, clicked: boolean, extraClicks: number}>} */
export function increment() {
  return request('/api/increment', { method: 'POST' });
}

/**
 * @param {{password: string, eventText?: string, count?: number, resetCount?: boolean}} payload
 * @returns {Promise<{count: number, eventText: string}>}
 */
export function updateAdmin(payload) {
  return request('/api/admin', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
}

export { ApiError };
