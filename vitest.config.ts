import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['agent/test/**/*.test.ts'],
    environment: 'node',
    testTimeout: 20000,
    // Logs structurés silencieux pendant les tests (le logger lit LOG_LEVEL à l'import).
    env: { LOG_LEVEL: 'silent', LOG_FORMAT: 'json' },
  },
});
