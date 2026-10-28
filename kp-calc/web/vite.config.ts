import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// В разработке запросы к серверу идут через прокси на kp-calc/api (порт 8787).
const API = process.env.KP_API ?? 'http://127.0.0.1:8787';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: { '/api': API, '/healthz': API },
    fs: { allow: ['..'] },
  },
  build: { outDir: 'dist', emptyOutDir: true },
});
