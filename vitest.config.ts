import { defineConfig } from 'vitest/config';

// Tests live next to the code they test: server/*.test.ts, web/src/*.test.ts.
// They use small fake folders made in a temp directory, never your real Drive.
export default defineConfig({
  test: {
    root: '.',
    include: ['server/**/*.test.ts', 'web/src/**/*.test.ts'],
    environment: 'node',
    // Tests never read John's choice of AI. They use Claude, unless a test asks for the other one.
    env: { HQ_AI_FILE: 'no-such-folder/ai-choice.json' },
  },
});
