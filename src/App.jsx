import { useAuth } from './context/AuthContext';
import { isConfigured } from './api/sheets';
import Login from './pages/Login';
import Home from './pages/Home';

export default function App() {
  const { user } = useAuth();

  if (!isConfigured) {
    return (
      <main className="mx-auto max-w-md p-6">
        <h1 className="text-lg font-semibold">App not configured</h1>
        <p className="mt-2 text-sm text-gray-600">
          Set <code>VITE_SCRIPT_URL</code> in <code>.env</code> to the Apps Script <code>/exec</code> URL, then restart.
        </p>
      </main>
    );
  }
  return user ? <Home /> : <Login />;
}
