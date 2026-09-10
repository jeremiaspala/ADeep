import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/main/index.ts'),
          // Arnés de validación de sólo lectura: `npm run validate`.
          validate: resolve(__dirname, 'src/main/validate.ts'),
          uitest: resolve(__dirname, 'src/main/uitest.ts')
        }
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, 'src/preload/index.ts') }
      }
    }
  },
  renderer: {
    root: resolve(__dirname, 'src/renderer'),
    resolve: {
      alias: {
        '@': resolve(__dirname, 'src/renderer/src'),
        '@shared': resolve(__dirname, 'src/shared')
      }
    },
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/renderer/index.html'),
          sites: resolve(__dirname, 'src/renderer/sites.html'),
          trusts: resolve(__dirname, 'src/renderer/trusts.html'),
          dfs: resolve(__dirname, 'src/renderer/dfs.html')
        }
      }
    },
    plugins: [react()]
  }
})
