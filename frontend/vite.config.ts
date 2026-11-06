import { loadEnv } from 'vite';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'BACKEND_');
  const target = process.env.BACKEND_PROXY_TARGET ?? env.BACKEND_PROXY_TARGET ?? 'http://127.0.0.1:8080';
  return {
    plugins: [react()],
    server: {
      host: '127.0.0.1',
      port: Number(process.env.FRONTEND_PORT ?? 5173),
      strictPort: true,
      proxy: { '/api': { target, changeOrigin: true }, '/actuator/health': { target, changeOrigin: true } },
    },
    test: {
      include: ['src/**/*.test.{ts,tsx}'],
      environment: 'jsdom',
      globals: true,
      setupFiles: './src/test/setup.ts',
      css: true,
      exclude: ['e2e/**', 'node_modules/**'],
    },
  };
});

