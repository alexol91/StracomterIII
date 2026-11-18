import { defineConfig, type Plugin } from 'vite';
import { rmSync } from 'node:fs';
import { resolve } from 'node:path';

// public/preview/ son modelos de prueba para galeria.html (solo desarrollo): no deben ir al build final.
const sinPreview = (): Plugin => ({
  name: 'sin-preview',
  apply: 'build',
  closeBundle() { rmSync(resolve('dist/preview'), { recursive: true, force: true }); },
});

// base relativa: el build se puede abrir desde cualquier ruta o empotrar en una app (WebView).
export default defineConfig({ base: './', plugins: [sinPreview()], build: { target: 'es2020', chunkSizeWarningLimit: 1500 } });
