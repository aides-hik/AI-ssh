import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'
import renderer from 'vite-plugin-electron-renderer'
import { resolve } from 'node:path'

// An independent browser entry for design prototypes, with no Electron startup.
export default defineConfig({
  root: import.meta.dirname,
  plugins: [
    {
      name: 'browser-preview-entry',
      transformIndexHtml: {
        order: 'pre',
        handler: html => html.replace('src="/src/main.ts"', 'src="/src/browser-preview/main.ts"')
      }
    },
    vue(),
    tailwindcss(),
    renderer()
  ],
  resolve: {
    alias: {
      '@': resolve(import.meta.dirname, 'src'),
      '@ai-ssh/shared': resolve(import.meta.dirname, '../../packages/shared/src')
    }
  },
  server: { host: '127.0.0.1', port: 5173, strictPort: true, open: false },
  build: {
    outDir: resolve(import.meta.dirname, '../../tmp/preview/design-build'),
    emptyOutDir: true,
    rolldownOptions: {
      input: {
        app: resolve(import.meta.dirname, 'index.html'),
        design: resolve(import.meta.dirname, 'design-preview.html')
      }
    }
  }
})
