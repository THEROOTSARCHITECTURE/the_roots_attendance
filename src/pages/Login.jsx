import { useState } from 'react';
import { login, ServerError } from '../api/sheets';
import { useAuth } from '../context/AuthContext';

export default function Login() {
  const { signIn } = useAuth();
  const [employeeId, setEmployeeId] = useState('');
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const id = employeeId.trim().toUpperCase();
      const { employee } = await login(id, pin.trim());
      signIn({ ...employee, pin: pin.trim() });
    } catch (err) {
      setError(err instanceof ServerError ? err.message : 'Could not reach the server. Check your connection.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-full max-w-sm flex-col justify-center px-6 py-10">
      <img src="/icons/icon.svg" alt="" className="mx-auto h-20 w-20" />
      <h1 className="mt-4 text-center text-2xl font-semibold text-roots-900">The Roots</h1>
      <p className="text-center text-sm text-gray-600">Attendance</p>

      <form onSubmit={submit} className="mt-8 space-y-4">
        <label className="block">
          <span className="text-sm font-medium">Employee ID</span>
          <input
            value={employeeId}
            onChange={(e) => setEmployeeId(e.target.value)}
            placeholder="TR-EM0001"
            autoCapitalize="characters"
            autoComplete="username"
            required
            className="mt-1 w-full rounded-xl border border-gray-300 bg-white px-4 py-3 text-base uppercase outline-none focus:border-roots-600 focus:ring-2 focus:ring-roots-200"
          />
        </label>
        <label className="block">
          <span className="text-sm font-medium">PIN</span>
          <input
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
            type="password"
            inputMode="numeric"
            autoComplete="current-password"
            maxLength={8}
            required
            className="mt-1 w-full rounded-xl border border-gray-300 bg-white px-4 py-3 text-base tracking-widest outline-none focus:border-roots-600 focus:ring-2 focus:ring-roots-200"
          />
        </label>
        {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
        <button
          disabled={busy}
          className="w-full rounded-xl bg-roots-700 py-3 text-base font-semibold text-white active:bg-roots-900 disabled:opacity-60"
        >
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </main>
  );
}
