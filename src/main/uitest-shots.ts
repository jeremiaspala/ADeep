/**
 * Capturas para la documentación: abre cada consola, la deja en una vista con
 * contenido y guarda el PNG. Sólo lectura.
 *
 *   ADEEP_SHOT_DIR=docs/img npx electron out/main/uitest-shots.js --no-sandbox
 */
import { app, ipcMain, nativeTheme, type BrowserWindow } from 'electron'
import { writeFile, mkdir } from 'node:fs/promises'
import { join, isAbsolute } from 'node:path'
import { registerIpc } from './ipc'
import { openConsole, setPaths, type ConsoleId } from './windows'
import * as store from './store'

const rel = process.env.ADEEP_SHOT_DIR ?? 'docs/img'
const OUT = isAbsolute(rel) ? rel : join(process.cwd(), rel)
const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

async function js<T>(win: BrowserWindow, code: string): Promise<T> {
  return win.webContents.executeJavaScript(code) as Promise<T>
}

/** Hace clic en la fila del árbol; prioriza la coincidencia exacta de la etiqueta. */
const clickTree = (texto: string): string => `(() => {
  const filas = [...document.querySelectorAll('.tree-row')]
  const etiqueta = (r) => (r.querySelector('.tree-label')?.textContent ?? '').trim()
  const row = filas.find(r => etiqueta(r) === ${JSON.stringify(texto)})
    ?? filas.find(r => etiqueta(r).startsWith(${JSON.stringify(texto)}))
  if (!row) return false
  row.click()
  return true
})()`

async function shot(win: BrowserWindow, nombre: string): Promise<void> {
  const image = await win.webContents.capturePage()
  await writeFile(join(OUT, `${nombre}.png`), image.toPNG())
  console.log(`  ${nombre}.png`)
}

async function main(): Promise<void> {
  app.setName('adeep')
  app.setPath('userData', join(app.getPath('appData'), 'adeep'))
  setPaths(__dirname)
  app.disableHardwareAcceleration()
  app.on('window-all-closed', () => undefined)
  await app.whenReady()
  await mkdir(OUT, { recursive: true })
  registerIpc()
  ipcMain.handle('theme.get', () => (nativeTheme.shouldUseDarkColors ? 'dark' : 'light'))
  ipcMain.handle('theme.set', () => 'light')
  ipcMain.handle('app.openConsole', () => true)
  ipcMain.handle('app.consoles', () => [])

  const profile = (await store.getProfiles())[0]
  const password = profile && (await store.getSecret(profile.id))
  if (!profile || !password) throw new Error('Hace falta un perfil con contraseña guardada.')

  const primera = openConsole('aduc')
  await new Promise<void>((r) => primera.webContents.once('did-finish-load', () => r()))
  await js(primera, `window.adeep.session.connect(${JSON.stringify(profile)}, ${JSON.stringify(password)})`)
  await wait(4000)
  primera.destroy()

  const pasos: [ConsoleId, string, string[]][] = [
    ['aduc', 'aduc', ['Users']],
    ['sites', 'sites', ['Nombre-predeterminado', 'Servers']],
    ['trusts', 'trusts', ['Dominios del bosque']],
    ['dfs', 'dfs', ['Archivos']],
    ['dns', 'dns', ['ejemplo.local']],
    ['dhcp', 'dhcp', []],
    ['ldap', 'ldap', ['Configuración']],
    ['gpo', 'gpo', ['Dónde se aplican', 'Users']],
    ['adcs', 'adcs', ['Plantillas']]
  ]

  for (const [id, nombre, navegacion] of pasos) {
    console.log(`\n${id}`)
    const win = openConsole(id)
    await new Promise<void>((r) => win.webContents.once('did-finish-load', () => r()))
    await wait(3800)
    await js(win, `document.querySelector('.modal-head .x')?.click()`)
    await wait(500)

    for (const paso of navegacion) {
      const ok = await js<boolean>(win, clickTree(paso))
      console.log(`  ${ok ? '→' : '×'} ${paso}`)
      await wait(1800)
    }

    await shot(win, nombre)
    win.destroy()
    await wait(400)
  }

  console.log('\nlisto')
  app.exit(0)
}

main().catch((err) => {
  console.error('FATAL:', err)
  app.exit(1)
})
