import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    alias: {
      vscode: fileURLToPath(new URL('./test/stubs/vscode.ts', import.meta.url)),
    },
  },
});
