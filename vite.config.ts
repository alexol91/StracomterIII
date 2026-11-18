import { defineConfig } from 'vite';
// base relativa: el build se puede abrir desde cualquier ruta o empotrar en una app (WebView).
export default defineConfig({ base: './', build: { target: 'es2020', chunkSizeWarningLimit: 1500 } });
