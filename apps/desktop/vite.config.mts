import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'
import electron from 'vite-plugin-electron'
import renderer from 'vite-plugin-electron-renderer'
import { resolve } from 'node:path'

const desktopRoot = import.meta.dirname

export default defineConfig({
  plugins: [
    vue(),
    tailwindcss(),
    electron([
      {
        // Main process entry file
        entry: 'electron/main/index.ts',
        onstart({ startup }) {
          startup()
        },
        vite: {
          build: {
            sourcemap: true,
            minify: process.env.NODE_ENV === 'production',
            outDir: 'dist-electron/main',
            rolldownOptions: {
              external: [
                'electron',
                'sqlite3',
                'better-sqlite3',
                'ssh2',
                '@ai-ssh/database', // 不打包 database 包
                '@prisma/client', // 不打包 Prisma Client
                '.prisma/client' // 不打包生成的客户端
              ]
            }
          }
        }
      },
      {
        // Preload scripts
        entry: 'electron/preload/index.ts',
        onstart({ reload }) {
          reload()
        },
        vite: {
          build: {
            sourcemap: 'inline',
            minify: process.env.NODE_ENV === 'production',
            outDir: 'dist-electron/preload',
            rolldownOptions: {
              external: ['electron']
            }
          }
        }
      }
    ]),
    renderer()
  ],
  resolve: {
    alias: {
      '@': resolve(desktopRoot, 'src'),
      '@ai-ssh/shared': resolve(desktopRoot, '../../packages/shared/src')
    }
  },
  build: {
    sourcemap: true,
    outDir: 'dist'
  },
  server: {
    port: 5173,
    host: true
  }
})
