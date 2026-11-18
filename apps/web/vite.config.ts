import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

// Where the dev server forwards API calls. The E2E suite points it at its own API instance.
const apiUrl = process.env.API_URL ?? 'http://localhost:3000';

export default defineConfig({
  plugins: [react()],
  server: {
    // Same-origin requests in development, so the API needs no CORS setup for the dashboard.
    proxy: {
      '/v1': apiUrl,
      '/health': apiUrl,
    },
  },
  test: {
    environment: 'jsdom',
    include: ['tests/**/*.test.{ts,tsx}'],
  },
});
