import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: {
    rolldownOptions: { input: { app: 'index.html', voice: 'voice.html' } },
  },
  server: {
    proxy: { '/api': 'http://127.0.0.1:3001' },
  },
});
