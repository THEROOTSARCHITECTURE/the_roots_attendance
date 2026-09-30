import { useCallback, useEffect, useState } from 'react';
import { getToday, punch, ServerError } from '../api/sheets';
import { enqueue, flush, onQueueChange, pendingCount } from '../offline/queue';
import { useAuth } from '../context/AuthContext';
import { getLocation } from '../lib/location';
import { newId } from '../lib/id';
import { useOnline } from '../lib/useOnline';
import StatusBanner from '../components/StatusBanner';
import InstallPrompt from '../components/InstallPrompt';

const EMPTY = { checkIn: '', checkOut: '', hours: '' };
const localDay = () => new Date().toLocaleDateString('en-CA'); // yyyy-mm-dd, device time zone
const prettyTime = (d = new Date()) =>
  d.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true }).toLowerCase();

// Last known state of today's row, so the right button shows even when offline
function readCache(id) {
  try {
    const c = JSON.parse(localStorage.getItem(`roots-today-${id}`));
    return c?.day === localDay() ? c.today : EMPTY;
  } catch { return EMPTY; }
}
function writeCache(id, today) {
  try { localStorage.setItem(`roots-today-${id}`, JSON.stringify({ day: localDay(), today })); } catch { /* ignore */ }
}

export default function Home() {
  const { user, signOut } = useAuth();
  const online = useOnline();
  const [today, setToday] = useState(() => readCache(user.id));
  const [pending, setPending] = useState(0);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState(null);
  const [now, setNow] = useState(new Date());

  const show = (text, kind = 'ok') => {
    setToast({ text, kind });
    setTimeout(() => setToast((t) => (t?.text === text ? null : t)), kind === 'ok' ? 4000 : 8000);
  };

  const saveToday = useCallback((t) => { setToday(t); writeCache(user.id, t); }, [user.id]);

  const refresh = useCallback(async () => {
    try {
      const r = await getToday(user.id, user.pin);
      saveToday({ checkIn: r.checkIn, checkOut: r.checkOut, hours: r.hours });
    } catch (e) {
      if (e instanceof ServerError && /invalid/i.test(e.message)) signOut(); // PIN changed or access removed
      // network errors: keep showing the cached state
    }
  }, [user.id, user.pin, saveToday, signOut]);

  useEffect(() => {
    pendingCount().then(setPending);
    const off = onQueueChange((n) => { setPending(n); if (n === 0) refresh(); });
    flush().then(refresh);
    const tick = setInterval(() => setNow(new Date()), 15000);
    const onVisible = () => { if (document.visibilityState === 'visible') flush().then(refresh); };
    document.addEventListener('visibilitychange', onVisible);
    return () => { off(); clearInterval(tick); document.removeEventListener('visibilitychange', onVisible); };
  }, [refresh]);

  async function handlePunch(type) {
    setBusy(true);
    const loc = await getLocation();
    const entry = {
      employeeId: user.id,
      pin: user.pin,
      type,
      ...loc,
      device: navigator.userAgent,
      clientId: newId(),
      clientTime: new Date().toISOString(),
    };
    const locNote = loc.locationError ? ' (location off)' : '';
    try {
      if (!navigator.onLine) throw new TypeError('offline');
      const r = await punch(entry);
      show(`${type === 'CHECK_IN' ? 'Checked in' : 'Checked out'} at ${r.time}${locNote}`);
      await refresh();
    } catch (e) {
      if (e instanceof ServerError) {
        show(e.message, 'error');
        await refresh();
      } else {
        await enqueue(entry);
        const t = prettyTime();
        saveToday(type === 'CHECK_IN' ? { ...EMPTY, checkIn: `${t} *` } : { ...today, checkOut: `${t} *`, hours: '' });
        show('No connection. Saved on this phone and will sync automatically.', 'warn');
      }
    } finally {
      setBusy(false);
    }
  }

  const checkedIn = Boolean(today.checkIn);
  const checkedOut = Boolean(today.checkOut);
  const firstName = (user.name || user.id).split(' ')[0];

  return (
    <div className="flex min-h-full flex-col">
      <StatusBanner online={online} pending={pending} />

      <header className="flex items-center justify-between px-5 pt-5">
        <div>
          <p className="text-sm text-gray-600">Hello,</p>
          <h1 className="text-xl font-semibold text-roots-900">{firstName}</h1>
          {user.designation && <p className="text-xs text-gray-500">{user.designation} · {user.id}</p>}
        </div>
        <button onClick={signOut} className="rounded-lg px-3 py-1.5 text-sm text-gray-600 active:bg-gray-200">
          Sign out
        </button>
      </header>

      <InstallPrompt />

      <main className="flex flex-1 flex-col items-center px-5 pt-8 pb-10">
        <p className="text-sm text-gray-600">
          {now.toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' })}
        </p>
        <p className="text-5xl font-light tabular-nums text-roots-900">{prettyTime(now)}</p>

        <div className="mt-10">
          {!checkedIn && (
            <PunchButton color="bg-roots-700 active:bg-roots-900" busy={busy} onClick={() => handlePunch('CHECK_IN')}>
              Check In
            </PunchButton>
          )}
          {checkedIn && !checkedOut && (
            <PunchButton color="bg-red-600 active:bg-red-800" busy={busy} onClick={() => handlePunch('CHECK_OUT')}>
              Check Out
            </PunchButton>
          )}
          {checkedIn && checkedOut && (
            <div className="flex h-52 w-52 flex-col items-center justify-center rounded-full bg-roots-100 text-center">
              <span className="text-4xl">✓</span>
              <span className="mt-1 font-medium text-roots-900">Done for today</span>
            </div>
          )}
        </div>

        <dl className="mt-10 grid w-full max-w-sm grid-cols-3 gap-2 rounded-2xl bg-white p-4 text-center shadow-sm">
          <Stat label="Check In" value={today.checkIn} />
          <Stat label="Check Out" value={today.checkOut} />
          <Stat label="Hours" value={today.hours} />
        </dl>
        {(today.checkIn.endsWith('*') || today.checkOut.endsWith('*')) && (
          <p className="mt-2 text-xs text-gray-500">* waiting to sync</p>
        )}

        {checkedIn && checkedOut && (
          <button
            disabled={busy}
            onClick={() => handlePunch('CHECK_OUT')}
            className="mt-6 text-sm font-medium text-roots-700 underline disabled:opacity-50"
          >
            {busy ? 'Updating…' : 'Update check-out time'}
          </button>
        )}
      </main>

      {toast && (
        <div
          role="status"
          className={`fixed inset-x-4 bottom-6 mx-auto max-w-sm rounded-xl px-4 py-3 text-center text-sm font-medium text-white shadow-lg ${
            { ok: 'bg-roots-700', warn: 'bg-amber-600', error: 'bg-red-600' }[toast.kind]
          }`}
        >
          {toast.text}
        </div>
      )}
    </div>
  );
}

function PunchButton({ children, color, busy, onClick }) {
  return (
    <button
      onClick={onClick}
      disabled={busy}
      className={`h-52 w-52 rounded-full text-2xl font-semibold text-white shadow-xl transition-transform active:scale-95 disabled:opacity-70 ${color}`}
    >
      {busy ? 'Please wait…' : children}
    </button>
  );
}

function Stat({ label, value }) {
  return (
    <div>
      <dt className="text-xs text-gray-500">{label}</dt>
      <dd className="mt-1 font-semibold tabular-nums">{value || '—'}</dd>
    </div>
  );
}
