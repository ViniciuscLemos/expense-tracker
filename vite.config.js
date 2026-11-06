import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // the API serves the built page from its own address, so /api is on the same origin;
  // in dev, Vite passes /api on to the API running on port 8000
  server: { proxy: { '/api': 'http://localhost:8000' } },
  // the Playwright tests in e2e/ run in a real browser (npm run e2e), not in vitest
  test: { exclude: ['e2e/**', 'node_modules/**'] },
});
