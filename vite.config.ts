import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The screens live in web/. In development, Vite serves them on port 5173 and
// forwards /api requests to the Node server on 4321.
export default defineConfig({
  root: 'web',
  plugins: [react()],
  build: { outDir: '../dist/web', emptyOutDir: true },
  server: {
    port: 5173,
    host: '127.0.0.1',
    proxy: { '/api': 'http://127.0.0.1:4321' },
  },
});
