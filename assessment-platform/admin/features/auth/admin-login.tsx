'use client';
import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { ArrowRight, Code2, Eye, EyeOff, LoaderCircle, ShieldCheck } from 'lucide-react';
import { authApi } from '@/services/api-client';
const loginSchema = z.object({
  identifier: z
    .string()
    .trim()
    .min(1, 'Enter your administrator email.')
    .email('Enter a valid email address.')
    .max(128),
  password: z.string().min(1, 'Enter your password.').max(1024),
  remember: z.boolean(),
});
export function AdminLogin() {
  const router = useRouter();
  const cache = useQueryClient();
  const [visible, setVisible] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const login = useMutation({
    mutationFn: authApi.login,
    onSuccess: (session) => {
      if (session.data.user.role !== 'ADMIN') throw new Error('Administrator access is required.');
      cache.clear();
      cache.setQueryData(['admin-session'], session);
      router.replace('/dashboard');
      router.refresh();
    },
  });
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const parsed = loginSchema.safeParse({
      identifier: data.get('identifier'),
      password: data.get('password'),
      remember: data.get('remember') === 'on',
    });
    if (!parsed.success) {
      setErrors(
        Object.fromEntries(
          parsed.error.issues.map((issue) => [String(issue.path[0]), issue.message]),
        ),
      );
      return;
    }
    setErrors({});
    login.mutate(parsed.data);
  }
  return (
    <main className="login-page">
      <section className="login-story">
        <div className="brand">
          <span className="brand-mark">
            <Code2 size={25} />
          </span>
          <span>
            Assess<span className="brand-dot">.</span>
          </span>
        </div>
        <div>
          <p className="eyebrow">ASSESSMENT OPERATIONS</p>
          <h1>
            Thoughtful assessments.
            <br />
            Confident decisions.
          </h1>
          <p>
            A dedicated workspace for your question bank, assessment schedules, student progress,
            and results.
          </p>
          <div className="login-trust">
            <ShieldCheck size={22} />
            <span>
              Secure access. Auditable decisions.
              <br />
              Immutable published questions.
            </span>
          </div>
        </div>
        <small>Assessment platform · Administrator workspace</small>
      </section>
      <section className="login-card">
        <div className="login-card-inner">
          <span className="login-icon">
            <ShieldCheck size={28} />
          </span>
          <h2>Welcome back</h2>
          <p>Sign in to your administration workspace.</p>
          <form onSubmit={submit} noValidate>
            <div className="field">
              <label htmlFor="identifier">Administrator email</label>
              <input
                id="identifier"
                name="identifier"
                type="email"
                autoComplete="username"
                autoCapitalize="none"
                required
                aria-invalid={Boolean(errors.identifier)}
                aria-describedby={errors.identifier ? 'identifier-error' : undefined}
                disabled={login.isPending}
                placeholder="you@institution.edu"
              />
              {errors.identifier && (
                <p className="field-error" id="identifier-error">
                  {errors.identifier}
                </p>
              )}
            </div>
            <div className="field">
              <label htmlFor="password">Password</label>
              <div className="password-input">
                <input
                  id="password"
                  name="password"
                  type={visible ? 'text' : 'password'}
                  autoComplete="current-password"
                  required
                  aria-invalid={Boolean(errors.password)}
                  aria-describedby={errors.password ? 'password-error' : undefined}
                  disabled={login.isPending}
                />
                <button
                  type="button"
                  className="icon-button"
                  aria-label={visible ? 'Hide password' : 'Show password'}
                  aria-pressed={visible}
                  onClick={() => setVisible(!visible)}
                >
                  {visible ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
              {errors.password && (
                <p className="field-error" id="password-error">
                  {errors.password}
                </p>
              )}
            </div>
            <label className="checkbox">
              <input type="checkbox" name="remember" disabled={login.isPending} />
              <span>
                Keep me signed in on this device<small>Use only on your own trusted device.</small>
              </span>
            </label>
            {login.error && (
              <p role="alert" className="alert">
                {login.error.message}
              </p>
            )}
            <button type="submit" className="button login-button" disabled={login.isPending}>
              {login.isPending ? (
                <>
                  <LoaderCircle size={18} className="spin" />
                  Signing in…
                </>
              ) : (
                <>
                  Sign in
                  <ArrowRight size={18} />
                </>
              )}
            </button>
          </form>
          <p className="login-help">
            Use the administrator credentials issued by your institution. Contact your platform
            owner if you need access.
          </p>
        </div>
      </section>
    </main>
  );
}
