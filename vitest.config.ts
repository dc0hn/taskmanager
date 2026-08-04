import { defineConfig } from 'vitest/config';

// Unit tests target the pure logic modules (parser, scheduler) — no DOM needed.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
