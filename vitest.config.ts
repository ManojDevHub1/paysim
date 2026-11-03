import { defineConfig } from 'vitest/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['**/*.test.ts', '**/*.test.tsx'],
    exclude: ['**/node_modules/**', '**/dist/**', '**/.turbo/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
    },
  },
  resolve: {
    alias: {
      '@paysim/shared': path.resolve(__dirname, './packages/shared/src/index.ts'),
      '@paysim/contracts': path.resolve(__dirname, './packages/contracts/src/index.ts'),
      '@paysim/crypto': path.resolve(__dirname, './packages/crypto/src/index.ts'),
      '@paysim/domain': path.resolve(__dirname, './packages/domain/src/index.ts'),
      '@paysim/storage-memory': path.resolve(__dirname, './packages/storage-memory/src/index.ts'),
    },
  },
});
