'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { ArrowRight, Eye, EyeOff, LoaderCircle, LockKeyhole, UserRound } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { loginSchema, type LoginValues } from './login-schema';
import { useLogin } from './use-auth';
export function LoginForm() {
  const router = useRouter();
  const login = useLogin();
  const [visible, setVisible] = useState(false);
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<LoginValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: { identifier: '', password: '', remember: false },
    mode: 'onTouched',
  });
  const submit = handleSubmit(async (values) => {
    try {
      await login.mutateAsync(values);
      router.replace('/dashboard');
      router.refresh();
    } catch {
      /* Error is rendered below. */
    }
  });
  return (
    <form onSubmit={submit} noValidate className="login-form">
      <div className="form-field">
        <label htmlFor="identifier">Student ID</label>
        <div className="input-wrap">
          <UserRound size={18} aria-hidden="true" />
          <input
            {...register('identifier')}
            id="identifier"
            placeholder="Enter your student ID"
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            aria-invalid={Boolean(errors.identifier)}
            aria-describedby={errors.identifier ? 'identifier-error' : undefined}
            disabled={login.isPending}
          />
        </div>
        {errors.identifier && (
          <p className="field-error" id="identifier-error">
            {errors.identifier.message}
          </p>
        )}
      </div>
      <div className="form-field">
        <label htmlFor="password">Password</label>
        <div className="input-wrap">
          <LockKeyhole size={18} aria-hidden="true" />
          <input
            {...register('password')}
            id="password"
            type={visible ? 'text' : 'password'}
            placeholder="Enter your password"
            autoComplete="current-password"
            aria-invalid={Boolean(errors.password)}
            aria-describedby={errors.password ? 'password-error' : undefined}
            disabled={login.isPending}
          />
          <button
            type="button"
            className="password-toggle"
            aria-label={visible ? 'Hide password' : 'Show password'}
            aria-pressed={visible}
            onClick={() => setVisible(!visible)}
          >
            {visible ? <EyeOff size={18} /> : <Eye size={18} />}
          </button>
        </div>
        {errors.password && (
          <p className="field-error" id="password-error">
            {errors.password.message}
          </p>
        )}
      </div>
      <label className="remember">
        <input {...register('remember')} type="checkbox" disabled={login.isPending} />
        <span>
          Keep me signed in on this device
          <span className="remember-detail">For a limited time. Use only on your own device.</span>
        </span>
      </label>
      {login.error && (
        <p role="alert" className="form-alert">
          {login.error.message}
        </p>
      )}
      <Button type="submit" className="primary-button login-submit" disabled={login.isPending}>
        {login.isPending ? (
          <>
            <LoaderCircle size={18} className="spin" aria-hidden="true" />
            Signing in…
          </>
        ) : (
          <>
            Sign in to your workspace
            <ArrowRight size={18} aria-hidden="true" />
          </>
        )}
      </Button>
      <p className="login-help">
        Use the credentials provided by your institution.
        <br />
        Need access? Contact your assessment coordinator.
      </p>
    </form>
  );
}
