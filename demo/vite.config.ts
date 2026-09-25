import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

const src = (path: string) => fileURLToPath(new URL(`../src/${path}`, import.meta.url))

// The demo imports the package by its public names, resolved to the source, so
// what runs here is exactly what `npm test` covers.
export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  base: './',
  plugins: [react()],
  resolve: {
    alias: [
      { find: 'call-a11y/styles.css', replacement: src('styles.css') },
      { find: 'call-a11y/react', replacement: src('react/index.ts') },
      { find: 'call-a11y', replacement: src('index.ts') },
    ],
  },
  build: { outDir: '../demo-dist', emptyOutDir: true },
})
