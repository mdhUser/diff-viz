import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath, URL } from 'node:url';

// The hub requires an access token on every `/api/*` call. In dev the browser
// talks to Vite, not the hub, so the proxy has to add the header it reads from
// the same state directory the CLI uses.
function hubToken(): string | undefined {
  if (process.env.DIFF_VIZ_TOKEN) return process.env.DIFF_VIZ_TOKEN.trim() || undefined;
  const home = process.env.DIFF_VIZ_HOME || path.join(os.homedir(), '.diff-viz');
  try {
    return fs.readFileSync(path.join(home, 'token'), 'utf8').trim() || undefined;
  } catch {
    return undefined;
  }
}

const token = hubToken();

export default defineConfig({
  root: fileURLToPath(new URL('./web', import.meta.url)),
  plugins: [react(), tailwindcss()],
  base: '/',
  build: {
    outDir: fileURLToPath(new URL('./dist', import.meta.url)),
    emptyOutDir: true,
    chunkSizeWarningLimit: 1500,
  },
  server: {
    port: 5199,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:5173',
        headers: token ? { 'X-Diff-Viz-Token': token } : {},
      },
    },
  },
});
