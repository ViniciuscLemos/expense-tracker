import { defineConfig, devices } from '@playwright/test';

// End to end tests: a real browser clicking through the built page (npm run build first),
// served by the real API on a real Postgres (E2E_DATABASE_URL).
const PORT = 4321;
const URL = `http://localhost:${PORT}/`;
const DATABASE = process.env.E2E_DATABASE_URL || 'postgresql://postgres@localhost:54329/expenses_e2e';

export default defineConfig({
  testDir: 'e2e',
  retries: process.env.CI ? 1 : 0,
  reporter: 'list',
  use: { baseURL: URL, trace: 'retain-on-failure' },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'phone', use: { ...devices['Pixel 7'] } },
  ].map((project) => ({
    ...project,
    // locally it uses the Edge that is already installed instead of downloading Chromium
    use: { ...project.use, channel: process.env.CI ? undefined : 'msedge' },
  })),
  webServer: {
    command: `python -m uvicorn --factory app.main:create_app --app-dir api --port ${PORT}`,
    url: `${URL}api/health`,
    reuseExistingServer: false,
    env: { DATABASE_URL: DATABASE, DEMO: 'true', SITE_DIR: 'dist' },
  },
});
