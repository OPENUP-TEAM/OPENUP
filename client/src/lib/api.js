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
    // A 401 means the token is gone or expired. Showing "sign in to
    // continue" on a page the person cannot act on is a dead end, so send
    // them to the login form instead, remembering where they were.
    if (res.status === 401 && token) {
      setToken(null);
      const here = window.location.pathname + window.location.search;
      window.location.replace(`/login?next=${encodeURIComponent(here)}`);
    }

    const err = new Error(payload.error || 'Could not reach the server.');
    err.status = res.status;
    err.details = payload.details;
    throw err;
  }

  return payload;
}
