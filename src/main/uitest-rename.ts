/**
 * Comprueba el diálogo de cambio de nombre de usuario: navega el árbol hasta la
 * OU, selecciona el usuario, abre el diálogo con F2 y verifica que los campos
 * lleguen cargados desde el directorio. **No guarda nada.**
 */
import { app, ipcMain, nativeTheme, type BrowserWindow } from 'electron'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { registerIpc } from './ipc'
import { openConsole, setPaths } from './windows'
import * as store from './store'

const OUT = process.env.ADEEP_SHOT_DIR ?? '/tmp'
/** Fragmentos de DN, porque puede haber varias OUs con el mismo nombre. */
const RUTA = (process.env.ADEEP_OU_PATH ?? 'OU=TPR,|OU=Users,OU=TPR|OU=Sistemas,OU=Users').split('|')
const BUSCAR = process.env.ADEEP_USER ?? 'Palazzesi'

const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

async function js<T>(win: BrowserWindow, code: string): Promise<T> {
  return win.webContents.executeJavaScript(code) as Promise<T>
}

/** Las filas del árbol llevan el DN en el title: se busca por ahí, no por nombre. */
function clickTree(fragmentoDN: string): string {
  return `(() => {
    const fila = [...document.querySelectorAll('.tree-row')]
      .find((r) => (r.getAttribute('title') ?? '').includes(${JSON.stringify(fragmentoDN)}))
    if (!fila) return false
    // El árbol de ADUC selecciona con un clic y expande con doble clic.
    fila.click()
    fila.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))
    return true
  })()`
}

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

  const profile = (await store.getProfiles())[0]
  const password = profile && (await store.getSecret(profile.id))
  if (!profile || !password) throw new Error('Hace falta un perfil con contraseña guardada.')

  const win = openConsole('aduc')
  await new Promise<void>((r) => win.webContents.once('did-finish-load', () => r()))
  await js(win, `window.adeep.session.connect(${JSON.stringify(profile)}, ${JSON.stringify(password)})`)
  await wait(4500)

  for (const paso of RUTA) {
    const ok = await js<boolean>(win, clickTree(paso))
    console.log(`   ${ok ? '→' : '×'} ${paso}`)
    await wait(1800)
  }

  const seleccionado = await js<boolean>(win, `(() => {
    const fila = [...document.querySelectorAll('table.list tbody tr')]
      .find((r) => r.textContent.includes(${JSON.stringify(BUSCAR)}))
    if (!fila) return false
    fila.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    return true
  })()`)
  console.log(`   ${seleccionado ? '→' : '×'} usuario seleccionado`)
  await wait(600)

  await js(win, `window.dispatchEvent(new KeyboardEvent('keydown', { key: 'F2', bubbles: true }))`)
  await wait(2200)

  const dialogo = await js<{ titulo: string; campos: { label: string; value: string }[] } | null>(win, `(() => {
    const modal = document.querySelector('.modal')
    if (!modal) return null
    return {
      titulo: modal.querySelector('.ttl')?.textContent ?? '',
      campos: [...modal.querySelectorAll('.field')].map((f) => ({
        label: (f.querySelector('.lbl')?.textContent ?? '').trim(),
        value: f.querySelector('input')?.value ?? ''
      }))
    }
  })()`)

  if (dialogo) {
    console.log(`\ndiálogo: ${dialogo.titulo}`)
    for (const c of dialogo.campos) console.log(`   ${c.label.padEnd(30)} = ${c.value}`)
  } else {
    console.log('\nel diálogo no se abrió')
  }

  const image = await win.webContents.capturePage()
  await writeFile(join(OUT, 'rename-check.png'), image.toPNG())
  console.log('\ncaptura: rename-check.png')
  app.exit(dialogo ? 0 : 1)
}

main().catch((e) => {
  console.error('FATAL:', e)
  app.exit(2)
})
