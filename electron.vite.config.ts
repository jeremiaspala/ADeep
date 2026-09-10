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
          uitest: resolve(__dirname, 'src/main/uitest.ts'),
          probe: resolve(__dirname, 'src/main/probe.ts'),
          'uitest-menu': resolve(__dirname, 'src/main/uitest-menu.ts'),
          'uitest-audit': resolve(__dirname, 'src/main/uitest-audit.ts'),
          'uitest-export': resolve(__dirname, 'src/main/uitest-export.ts'),
          'uitest-about': resolve(__dirname, 'src/main/uitest-about.ts'),
          'uitest-switch': resolve(__dirname, 'src/main/uitest-switch.ts'),
          'uitest-shots': resolve(__dirname, 'src/main/uitest-shots.ts'),
          'uitest-rename': resolve(__dirname, 'src/main/uitest-rename.ts')
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
          dfs: resolve(__dirname, 'src/renderer/dfs.html'),
          dns: resolve(__dirname, 'src/renderer/dns.html'),
          dhcp: resolve(__dirname, 'src/renderer/dhcp.html'),
          ldap: resolve(__dirname, 'src/renderer/ldap.html'),
          gpo: resolve(__dirname, 'src/renderer/gpo.html'),
          adcs: resolve(__dirname, 'src/renderer/adcs.html')
        }
      }
    },
    plugins: [react()]
  }
})
