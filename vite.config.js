import { defineConfig } from 'vite';
export default defineConfig({ server: { middlewareMode: true, watch: { ignored: ['**/.venv/**', '**/.local/**'] } }, appType: 'spa' });
