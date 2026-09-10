import { app, nativeTheme, Menu, ipcMain, BrowserWindow } from 'electron'
import { join } from 'node:path'
import { electronApp, optimizer } from '@electron-toolkit/utils'
import { registerIpc } from './ipc'
import { getPrefs } from './store'
import { CONSOLES, broadcast, consoleIdFromArgv, openConsole, setPaths, type ConsoleId } from './windows'

// Sin esto, ejecutar el bundle suelto guarda los perfiles en ~/.config/Electron.
app.setName('adeep')
app.setPath('userData', join(app.getPath('appData'), 'adeep'))
setPaths(__dirname)

app.whenReady().then(async () => {
  electronApp.setAppUserModelId('ar.com.adeep')
  Menu.setApplicationMenu(null)

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  registerIpc()

  ipcMain.handle('app.openConsole', (_e, id: ConsoleId) => {
    openConsole(id)
    return true
  })
  ipcMain.handle('app.consoles', () =>
    Object.values(CONSOLES).map((c) => ({ id: c.id, title: c.title }))
  )

  // El renderer necesita saber el tema del sistema para el modo "system".
  ipcMain.handle('theme.get', () => (nativeTheme.shouldUseDarkColors ? 'dark' : 'light'))
  ipcMain.handle('theme.set', (_e, theme: 'system' | 'light' | 'dark') => {
    nativeTheme.themeSource = theme
    return nativeTheme.shouldUseDarkColors ? 'dark' : 'light'
  })
  nativeTheme.on('updated', () => {
    broadcast('theme.changed', nativeTheme.shouldUseDarkColors ? 'dark' : 'light')
  })

  const prefs = await getPrefs().catch(() => null)
  if (prefs) nativeTheme.themeSource = prefs.theme

  openConsole(consoleIdFromArgv(process.argv))

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) openConsole('aduc')
  })
})

// Una segunda ejecución abre la consola pedida en la instancia que ya corre, para
// que todas compartan la misma sesión LDAP.
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', (_e, argv) => {
    openConsole(consoleIdFromArgv(argv))
  })
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
