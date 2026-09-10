/** Verifica que desde cada consola se pueda abrir cualquier otra. */
import { app, ipcMain, nativeTheme } from 'electron'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { registerIpc } from './ipc'
import { CONSOLES, openConsole, setPaths, type ConsoleId } from './windows'

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
  ipcMain.handle('app.consoles', () => [])

  const pedidas: string[] = []
  ipcMain.handle('app.openConsole', (_e, id: string) => { pedidas.push(id); return true })

  let fallos = 0
  for (const id of Object.keys(CONSOLES) as ConsoleId[]) {
    const win = openConsole(id)
    await new Promise<void>((r) => win.webContents.once('did-finish-load', () => r()))
    await wait(2200)
    await win.webContents.executeJavaScript(`document.querySelector('.modal-head .x')?.click()`)
    await wait(400)

    const menus = await win.webContents.executeJavaScript(
      `[...document.querySelectorAll('.menu-btn')].map(b => b.textContent.trim())`
    ) as string[]
    const tieneMenu = menus.includes('Consolas')

    const tieneBoton = await win.webContents.executeJavaScript(
      `!!document.querySelector('.toolbar .tool[title="Abrir otra consola"]')`
    ) as boolean

    // Se prueba de verdad: abrir el menú y clickear otra consola.
    pedidas.length = 0
    await win.webContents.executeJavaScript(`(async () => {
      const b = [...document.querySelectorAll('.menu-btn')].find(x => x.textContent.trim() === 'Consolas')
      if (!b) return
      b.click()
      await new Promise(r => setTimeout(r, 300))
      const it = [...document.querySelectorAll('.menu-pop .menu-item')].find(x => !x.classList.contains('disabled'))
      if (!it) return
      it.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
      it.click()
    })()`)
    await wait(700)

    const ok = tieneMenu && tieneBoton && pedidas.length > 0
    if (!ok) fallos++
    console.log(
      `${ok ? '✓' : '✗'} ${CONSOLES[id].title.padEnd(52)} menú:${tieneMenu ? 'sí' : 'NO'} botón:${tieneBoton ? 'sí' : 'NO'} abrió:${pedidas[0] ?? 'NINGUNA'}`
    )

    if (id === 'aduc') {
      const image = await win.webContents.capturePage()
      await writeFile(join(OUT, 'switch-aduc.png'), image.toPNG())
    }
    win.destroy()
    await wait(300)
  }

  console.log(fallos ? `\n${fallos} consola(s) sin forma de cambiar` : '\ntodas pueden cambiar de consola')
  app.exit(fallos ? 1 : 0)
}
main().catch((e) => { console.error(e); app.exit(2) })
