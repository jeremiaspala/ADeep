/** Captura el diálogo Acerca de, para revisarlo. */
import { app, ipcMain, nativeTheme } from 'electron'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { registerIpc } from './ipc'
import { openConsole, setPaths } from './windows'

const OUT = process.env.ADEEP_SHOT_DIR ?? '/tmp'
const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

async function main(): Promise<void> {
  app.setName('adeep')
  app.setPath('userData', join(app.getPath('appData'), 'adeep'))
  setPaths(__dirname)
  app.disableHardwareAcceleration()
  app.on('window-all-closed', () => undefined)
  await app.whenReady()
  registerIpc()
  ipcMain.handle('theme.get', () => (nativeTheme.shouldUseDarkColors ? 'dark' : 'light'))
  ipcMain.handle('theme.set', () => 'light')
  ipcMain.handle('app.openConsole', () => true)
  ipcMain.handle('app.consoles', () => [])

  const win = openConsole('aduc')
  win.webContents.on('console-message', (_e, level, message) => {
    if (level >= 1) console.log('[renderer]', message.slice(0, 300))
  })
  win.webContents.on('render-process-gone', (_e, d) => console.log('[renderer muerto]', JSON.stringify(d)))
  await new Promise<void>((r) => win.webContents.once('did-finish-load', () => r()))
  await wait(2500)
  await win.webContents.executeJavaScript(`(async () => {
    // Cerrar el diálogo de conexión como lo haría una persona, no sacándolo del DOM.
    document.querySelector('.modal-head .x')?.click()
    await new Promise(r => setTimeout(r, 400))
    const b = [...document.querySelectorAll('.menu-btn')].find(x => x.textContent.trim() === 'Ayuda')
    b.click()
    await new Promise(r => setTimeout(r, 300))
    const it = [...document.querySelectorAll('.menu-pop .menu-item')].find(x => x.textContent.includes('Acerca'))
    it.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    it.click()
  })()`)
  await wait(1200)
  const image = await win.webContents.capturePage()
  await writeFile(join(OUT, 'about.png'), image.toPNG())
  console.log('listo')
  app.exit(0)
}
main().catch((e) => { console.error(e); app.exit(1) })
