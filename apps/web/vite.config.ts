import { existsSync } from 'node:fs';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

if (typeof process.loadEnvFile === 'function' && existsSync('../api/.env')) {
  try { process.loadEnvFile('../api/.env'); } catch {}
}

export default defineConfig({
  plugins: [react()],
  server: { port: 5173, proxy: { '/api': `http://localhost:${process.env.PORT ?? 3000}` } },
});
