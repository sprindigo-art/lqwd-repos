import { useState, useRef, type FormEvent } from 'react';
import { cn } from '@/lib/utils';
import { Loader2, AlertCircle } from 'lucide-react';

interface LoginFormProps {
  onSuccess: () => void;
}

export function LoginForm({ onSuccess }: LoginFormProps) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const usernameRef = useRef<HTMLInputElement>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const res = await fetch('/admin/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
        credentials: 'same-origin',
      });

      const data = await res.json();

      if (res.status === 200 && data.ok) {
        onSuccess();
      } else if (res.status === 429) {
        const minutes = data.retry_after_minutes ?? 5;
        setError(`Too many login attempts. Try again in ${minutes} minutes.`);
      } else {
        setError('Invalid username or password.');
      }
    } catch {
      setError('Unable to connect. Check the gateway connection and try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <div
        className={cn(
          'w-full max-w-sm rounded-lg border p-6',
          'bg-[var(--card)] border-[var(--border)]'
        )}
      >
        <div className="mb-6 text-center">
          <h1
            className="text-2xl font-semibold"
            style={{ color: 'var(--primary)' }}
          >
            LQWD
          </h1>
          <p className="mt-1 text-sm" style={{ color: 'var(--muted-foreground)' }}>
            Admin Dashboard
          </p>
        </div>

        {error && (
          <div
            className={cn(
              'mb-4 flex items-start gap-2 rounded-md border p-3 text-sm',
              'border-[var(--destructive)] bg-[var(--destructive)]/10 text-[var(--destructive)]'
            )}
          >
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label
              htmlFor="username"
              className="mb-1.5 block text-xs"
              style={{ color: 'var(--muted-foreground)' }}
            >
              Username
            </label>
            <input
              ref={usernameRef}
              id="username"
              type="text"
              autoFocus
              autoComplete="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              disabled={loading}
              className={cn(
                'flex h-10 w-full rounded-md border px-3 py-2 text-sm',
                'bg-transparent border-[var(--input)] text-[var(--foreground)]',
                'placeholder:text-[var(--muted-foreground)]',
                'focus:outline-none focus:ring-2 focus:ring-[var(--ring)]',
                'disabled:cursor-not-allowed disabled:opacity-50'
              )}
            />
          </div>

          <div>
            <label
              htmlFor="password"
              className="mb-1.5 block text-xs"
              style={{ color: 'var(--muted-foreground)' }}
            >
              Password
            </label>
            <input
              id="password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={loading}
              className={cn(
                'flex h-10 w-full rounded-md border px-3 py-2 text-sm',
                'bg-transparent border-[var(--input)] text-[var(--foreground)]',
                'placeholder:text-[var(--muted-foreground)]',
                'focus:outline-none focus:ring-2 focus:ring-[var(--ring)]',
                'disabled:cursor-not-allowed disabled:opacity-50'
              )}
            />
          </div>

          <button
            type="submit"
            disabled={loading || !username || !password}
            className={cn(
              'flex h-11 w-full items-center justify-center rounded-md text-sm font-medium',
              'bg-[var(--primary)] text-[var(--primary-foreground)]',
              'hover:opacity-90 transition-opacity',
              'disabled:cursor-not-allowed disabled:opacity-50'
            )}
          >
            {loading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              'Sign In'
            )}
          </button>
        </form>
      </div>
    </div>
  );
}
