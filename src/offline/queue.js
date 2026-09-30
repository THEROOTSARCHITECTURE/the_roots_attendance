import { get, set } from 'idb-keyval';
import { punch, ServerError } from '../api/sheets';

const KEY = 'pending-punches';
const listeners = new Set();

export const onQueueChange = (fn) => (listeners.add(fn), () => listeners.delete(fn));
const notify = (n) => listeners.forEach((fn) => fn(n));

export async function enqueue(entry) {
  const q = (await get(KEY)) || [];
  q.push({ ...entry, queued: true }); // server uses the device time for queued punches
  await set(KEY, q);
  notify(q.length);
}

export async function pendingCount() {
  return ((await get(KEY)) || []).length;
}

let flushing = null;

// Sends queued punches in order (check-in before check-out). Returns how many are still pending.
export function flush() {
  if (flushing) return flushing;
  flushing = (async () => {
    const q = (await get(KEY)) || [];
    const remaining = [];
    for (const entry of q) {
      if (remaining.length) { remaining.push(entry); continue; } // keep order once one fails
      try {
        await punch(entry);
      } catch (e) {
        if (!(e instanceof ServerError)) remaining.push(entry); // network problem → retry later
      }
    }
    await set(KEY, remaining);
    notify(remaining.length);
    return remaining.length;
  })().finally(() => { flushing = null; });
  return flushing;
}

window.addEventListener('online', () => flush());
