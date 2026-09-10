/**
 * Cada consola es una ventana propia con su propio documento HTML, igual que los
 * complementos de MMC. Todas comparten el mismo proceso principal y, por lo tanto,
 * la misma conexión LDAP.
 */
import { app, BrowserWindow, nativeImage, nativeTheme, shell } from 'electron'
import { join } from 'node:path'
import { is } from '@electron-toolkit/utils'

export type ConsoleId = 'aduc' | 'sites' | 'trusts' | 'dfs'

export interface ConsoleDef {
  id: ConsoleId
  title: string
  /** Archivo HTML del renderer. */
  page: string
  width: number
  height: number
}

export const CONSOLES: Record<ConsoleId, ConsoleDef> = {
  aduc: {
    id: 'aduc',
    title: 'ADeep — Usuarios y equipos de Active Directory',
    page: 'index.html',
    width: 1440,
    height: 900
  },
  sites: {
    id: 'sites',
    title: 'ADeep — Sitios y servicios de Active Directory',
    page: 'sites.html',
    width: 1280,
    height: 820
  },
  trusts: {
    id: 'trusts',
    title: 'ADeep — Dominios y confianzas de Active Directory',
    page: 'trusts.html',
    width: 1180,
    height: 780
  },
  dfs: {
    id: 'dfs',
    title: 'ADeep — Administración de DFS',
    page: 'dfs.html',
    width: 1340,
    height: 860
  }
}

const windows = new Map<ConsoleId, BrowserWindow>()

/**
 * Directorios resueltos por el archivo de entrada: es el único lugar donde
 * __dirname apunta a out/main (el código compartido se bundlea en out/main/chunks).
 */
let paths = {
  renderer: join(app.getAppPath(), 'out/renderer'),
  preload: join(app.getAppPath(), 'out/preload/index.js'),
  icons: join(app.getAppPath(), 'build/icons')
}

export function setPaths(mainDir: string): void {
  paths = {
    renderer: join(mainDir, '../renderer'),
    preload: join(mainDir, '../preload/index.js'),
    icons: join(mainDir, '../../build/icons')
  }
}

function iconFor(id: ConsoleId): string {
  return join(paths.icons, `${id}.png`)
}

export function openConsole(id: ConsoleId): BrowserWindow {
  const existing = windows.get(id)
  if (existing && !existing.isDestroyed()) {
    if (existing.isMinimized()) existing.restore()
    existing.focus()
    return existing
  }

  const def = CONSOLES[id]
  const win = new BrowserWindow({
    width: def.width,
    height: def.height,
    minWidth: 940,
    minHeight: 580,
    show: false,
    autoHideMenuBar: true,
    title: def.title,
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#12141a' : '#f4f5f7',
    icon: iconFor(id),
    webPreferences: {
      preload: paths.preload,
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false,
      // El renderer lee esto para saber qué consola dibujar.
      additionalArguments: [`--adeep-console=${id}`]
    }
  })

  // En X11 el ícono de la barra de tareas sale de _NET_WM_ICON, que se fija así.
  // Las cuatro consolas corren en el mismo proceso, por eso va por ventana.
  const icon = nativeImage.createFromPath(iconFor(id))
  if (!icon.isEmpty()) win.setIcon(icon)

  win.on('ready-to-show', () => win.show())
  win.on('closed', () => windows.delete(id))
  win.webContents.setWindowOpenHandler((details) => {
    void shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (is.dev && process.env.ELECTRON_RENDERER_URL) {
    void win.loadURL(`${process.env.ELECTRON_RENDERER_URL}/${def.page}`)
  } else {
    void win.loadFile(join(paths.renderer, def.page))
  }

  windows.set(id, win)
  return win
}

export function allWindows(): BrowserWindow[] {
  return [...windows.values()].filter((w) => !w.isDestroyed())
}

/** Avisa a todas las consolas abiertas de un cambio de sesión o de datos. */
export function broadcast(channel: string, ...args: unknown[]): void {
  for (const win of allWindows()) win.webContents.send(channel, ...args)
}

export function consoleIdFromArgv(argv: string[]): ConsoleId {
  const arg = argv.find((a) => a.startsWith('--console='))
  const id = arg?.split('=')[1] as ConsoleId | undefined
  return id && id in CONSOLES ? id : 'aduc'
}
