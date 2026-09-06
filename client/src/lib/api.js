const TOKEN_KEY = 'openup.token';

export const getToken = () => localStorage.getItem(TOKEN_KEY);
export const setToken = (t) =>
  t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY);

/** Thin fetch wrapper: attaches the token and surfaces server messages. */
export async function api(path, { method = 'GET', body, ...rest } = {}) {
  const token = getToken();
  const res = await fetch(`/api${path}`, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...rest.headers,
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

  const payload = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(payload.error || 'Could not reach the server.');
    err.status = res.status;
    err.details = payload.details;
    throw err;
  }
  return payload;
}
