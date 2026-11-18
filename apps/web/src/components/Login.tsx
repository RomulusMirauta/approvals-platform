import type { LoginResponse } from '@approvals/contracts';
import { useMutation } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { api } from '../api';
import { ErrorMessage } from './ErrorMessage';

const DEMO_PASSWORD = 'demo-password';
const DEMO_ACCOUNTS = [
  { email: 'alice@example.com', role: 'Requester' },
  { email: 'bob@example.com', role: 'Approver' },
  { email: 'carol@example.com', role: 'Admin' },
];

export function Login({ onSignedIn }: { onSignedIn: (response: LoginResponse) => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const login = useMutation({ mutationFn: () => api.login(email, password), onSuccess: onSignedIn });

  function submit(event: FormEvent) {
    event.preventDefault();
    login.mutate();
  }

  return (
    <main className="login">
      <form className="card login-card" onSubmit={submit}>
        <h1>Approvals</h1>
        <p className="muted">Review what your agents need a human for.</p>

        <label htmlFor="email">Email</label>
        <input id="email" type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} />

        <label htmlFor="password">Password</label>
        <input
          id="password"
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />

        <ErrorMessage error={login.error} />

        <button type="submit" className="button primary" disabled={login.isPending}>
          {login.isPending ? 'Signing in…' : 'Sign in'}
        </button>

        <fieldset className="demo-accounts">
          <legend>Demo accounts</legend>
          {DEMO_ACCOUNTS.map((account) => (
            <button
              key={account.email}
              type="button"
              className="button"
              onClick={() => {
                setEmail(account.email);
                setPassword(DEMO_PASSWORD);
              }}
            >
              <span>{account.role}</span>
              <span className="muted">{account.email}</span>
            </button>
          ))}
        </fieldset>
      </form>
    </main>
  );
}
