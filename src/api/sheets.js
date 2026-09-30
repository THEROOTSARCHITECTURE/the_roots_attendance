const URL = import.meta.env.VITE_SCRIPT_URL;
const SECRET = import.meta.env.VITE_SHARED_SECRET;

export const isConfigured = Boolean(URL) && !URL.includes('XXXX');

// The server answered and said no (wrong PIN, already checked in…). Retrying won't help.
export class ServerError extends Error {}

async function call(action, payload) {
  const res = await fetch(URL, {
    method: 'POST',
    // text/plain keeps this a "simple" request — Apps Script can't answer CORS preflights
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ action, secret: SECRET, ...payload }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  if (!data.ok) throw new ServerError(data.error || 'Request failed');
  return data;
}

export const login = (employeeId, pin) => call('login', { employeeId, pin });
export const punch = (entry) => call('punch', entry);
export const getToday = (employeeId, pin) => call('today', { employeeId, pin });
