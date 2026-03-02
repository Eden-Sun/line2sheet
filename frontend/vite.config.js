import { defineConfig } from 'vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'
import path from 'node:path'

export default defineConfig({
  plugins: [svelte()],
  build: {
    outDir: path.resolve(__dirname, '../dist'),
    emptyOutDir: true,
    sourcemap: false
  }
})
