/** Comprueba que "Exportar lista a CSV…" realmente abre el diálogo nativo de guardar. */
import { app, ipcMain, nativeTheme, dialog } from 'electron'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { registerIpc } from './ipc'
import { openConsole, setPaths } from './windows'
import * as store from './store'

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
  ipcMain.handle('theme.get', () => 'light')
  ipcMain.handle('theme.set', () => 'light')
  ipcMain.handle('app.openConsole', () => true)
  ipcMain.handle('app.consoles', () => [])
  void nativeTheme

  const profile = (await store.getProfiles())[0]
  const password = profile && (await store.getSecret(profile.id))
  if (!profile || !password) throw new Error('Hace falta un perfil con contraseña guardada.')

  const win = openConsole('aduc')
  await new Promise<void>((r) => win.webContents.once('did-finish-load', () => r()))
  await win.webContents.executeJavaScript(
    `window.adeep.session.connect(${JSON.stringify(profile)}, ${JSON.stringify(password)})`
  )
  await wait(4500)

  const items = await win.webContents.executeJavaScript(
    `document.querySelectorAll('table.list tbody tr').length`
  )
  console.log('objetos en la lista:', items)

  // Se dispara el canal directamente: es lo mismo que hace el ítem del menú.
  let abierto = false
  const original = dialog.showSaveDialog.bind(dialog)
  // @ts-expect-error sustitución sólo para la prueba
  dialog.showSaveDialog = async (...args: unknown[]) => {
    abierto = true
    console.log('showSaveDialog llamado con:', JSON.stringify(args[1]))
    return { canceled: true, filePath: undefined }
  }

  const res = await win.webContents.executeJavaScript(`(async () => {
    const b = [...document.querySelectorAll('.menu-btn')].find(x => x.textContent.trim() === 'Archivo')
    b.click()
    await new Promise(r => setTimeout(r, 300))
    const it = [...document.querySelectorAll('.menu-pop .menu-item')].find(x => x.textContent.includes('CSV'))
    if (!it) return 'no encontré el ítem'
    if (it.classList.contains('disabled')) return 'el ítem está deshabilitado'
    it.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    it.click()
    return 'clic hecho'
  })()`)
  console.log('menú:', res)
  await wait(1500)

  console.log(abierto ? '✓ abrió el diálogo de guardar' : '✗ NO abrió ningún diálogo')
  Object.assign(dialog, { showSaveDialog: original })

  const image = await win.webContents.capturePage()
  await writeFile(join(OUT, 'export-csv.png'), image.toPNG())
  app.exit(abierto ? 0 : 1)
}

main().catch((err) => {
  console.error('FATAL:', err)
  app.exit(2)
})
