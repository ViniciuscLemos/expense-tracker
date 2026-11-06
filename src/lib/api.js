export class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// every call goes through here: same address as the page, the session cookie goes along on
// its own, and the header is what the API asks for before it changes anything
export async function api(path, { method = 'GET', body } = {}) {
  const headers = { 'X-Requested-With': 'fetch' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  let response;
  try {
    response = await fetch(`/api${path}`, {
      method,
      headers,
      credentials: 'same-origin',
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, "Can't reach the server. Check the connection and try again.");
  }
  if (response.status === 204) return null;
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    // FastAPI sends a list for validation errors and a sentence for everything else
    const detail = typeof data?.detail === 'string' ? data.detail : 'Something in there is not right.';
    throw new ApiError(response.status, detail);
  }
  return data;
}

export const query = (params) => {
  const clean = Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== '');
  return clean.length ? `?${new URLSearchParams(clean)}` : '';
};
