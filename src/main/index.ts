import { app, shell, BrowserWindow, nativeTheme, Menu, ipcMain } from 'electron'
import { join } from 'node:path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { registerIpc } from './ipc'
import { getPrefs } from './store'

let mainWindow: BrowserWindow | null = null

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 600,
    show: false,
    autoHideMenuBar: true,
    title: 'ADeep',
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#12141a' : '#f4f5f7',
    icon: join(__dirname, '../../build/icon.png'),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false
    }
  })

  mainWindow.on('ready-to-show', () => mainWindow?.show())

  mainWindow.webContents.setWindowOpenHandler((details) => {
    void shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (is.dev && process.env.ELECTRON_RENDERER_URL) {
    void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(async () => {
  electronApp.setAppUserModelId('ar.com.adeep')
  Menu.setApplicationMenu(null)

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  registerIpc()

  // El renderer necesita saber el tema del sistema para el modo "system".
  ipcMain.handle('theme.get', () => (nativeTheme.shouldUseDarkColors ? 'dark' : 'light'))
  ipcMain.handle('theme.set', (_e, theme: 'system' | 'light' | 'dark') => {
    nativeTheme.themeSource = theme
    return nativeTheme.shouldUseDarkColors ? 'dark' : 'light'
  })
  nativeTheme.on('updated', () => {
    mainWindow?.webContents.send('theme.changed', nativeTheme.shouldUseDarkColors ? 'dark' : 'light')
  })

  const prefs = await getPrefs().catch(() => null)
  if (prefs) nativeTheme.themeSource = prefs.theme

  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
