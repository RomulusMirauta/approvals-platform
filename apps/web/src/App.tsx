import type { LoginResponse } from '@approvals/contracts';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { getToken, setToken, setUnauthorizedHandler } from './api';
import { Dashboard } from './components/Dashboard';
import { Login } from './components/Login';

export function App() {
  const queryClient = useQueryClient();
  const [signedIn, setSignedIn] = useState(() => getToken() !== null);

  function signOut() {
    setToken(null);
    // Drop everything cached for this user so the next one starts clean.
    queryClient.clear();
    setSignedIn(false);
  }

  // The API client lives outside React, so it is handed a callback for expired sessions.
  useEffect(() => {
    setUnauthorizedHandler(signOut);
  });

  function signIn({ token, user }: LoginResponse) {
    setToken(token);
    // The login response already has the user, so the dashboard doesn't have to ask /v1/me again.
    queryClient.setQueryData(['me'], user);
    setSignedIn(true);
  }

  return signedIn ? <Dashboard onSignOut={signOut} /> : <Login onSignedIn={signIn} />;
}
