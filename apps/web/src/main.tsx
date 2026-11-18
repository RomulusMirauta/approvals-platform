import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles.css';

const queryClient = new QueryClient({
  defaultOptions: {
    // Client errors (bad filter, missing request, no permission) won't fix themselves; only retry the rest.
    queries: { retry: (failureCount, error) => failureCount < 2 && !isClientError(error), staleTime: 15_000 },
  },
});

function isClientError(error: unknown) {
  return typeof error === 'object' && error !== null && 'status' in error && Number(error.status) < 500;
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </StrictMode>,
);
