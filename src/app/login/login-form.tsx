'use client';

import { useActionState, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useFormStatus } from 'react-dom';
import { login, type LoginState } from './actions';
import { Button, Field, Input } from '@/components/ui';

const DEMO_PASSWORD = 'Coastal2026!';

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="primary" className="w-full" disabled={pending}>
      {pending ? 'Signing in…' : 'Sign in'}
    </Button>
  );
}

export function LoginForm() {
  const searchParams = useSearchParams();
  const presetEmail = searchParams.get('email') ?? '';
  const [state, formAction] = useActionState<LoginState, FormData>(login, {});
  const [email, setEmail] = useState(presetEmail);
  const [password, setPassword] = useState(presetEmail ? DEMO_PASSWORD : '');

  useEffect(() => {
    if (presetEmail) {
      setEmail(presetEmail);
      setPassword(DEMO_PASSWORD);
    }
  }, [presetEmail]);

  return (
    <form action={formAction} className="space-y-4">
      <Field label="Email">
        <Input
          name="email"
          type="email"
          autoComplete="username"
          required
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          placeholder="you@coastaleats.com"
        />
      </Field>
      <Field label="Password">
        <Input
          name="password"
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />
      </Field>

      {state.error ? (
        <p
          role="alert"
          className="rounded-lg border border-block/25 bg-block-soft px-3 py-2 text-sm text-block"
        >
          {state.error}
        </p>
      ) : null}

      <SubmitButton />
    </form>
  );
}
