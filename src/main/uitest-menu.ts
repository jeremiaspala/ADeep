/**
 * Prueba de regresión del menú: Acción → Nuevo → Usuario tiene que abrir el
 * diálogo de creación. No escribe nada en el directorio: se cancela el diálogo.
 */
import { app, ipcMain, nativeTheme } from 'electron'
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
  await wait(1200)

  await win.webContents.executeJavaScript(
    `window.adeep.session.connect(${JSON.stringify(profile)}, ${JSON.stringify(password)}).then(r => r.ok)`
  )
  await wait(4000)

  const click = async (script: string): Promise<unknown> => {
    const r = await win.webContents.executeJavaScript(script)
    await wait(500)
    return r
  }

  // Menú "Acción" de la barra superior.
  const opened = await click(`(() => {
    const b = [...document.querySelectorAll('.menu-btn')].find(x => x.textContent.trim() === 'Acción')
    if (!b) return 'no encontré el botón Acción'
    b.click()
    return 'ok'
  })()`)
  console.log('Acción:', opened)

  // Ítem "Nuevo": abre el submenú al pasar el mouse.
  const hovered = await click(`(() => {
    const it = [...document.querySelectorAll('.menu-pop .menu-item')].find(x => x.textContent.includes('Nuevo'))
    if (!it) return 'no encontré Nuevo'
    // React deriva onMouseEnter de mouseover; el mouseenter nativo no lo dispara.
    it.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
    it.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }))
    return 'ok'
  })()`)
  console.log('Nuevo (hover):', hovered)

  const submenu = await win.webContents.executeJavaScript(
    `document.querySelectorAll('.menu-pop').length`
  )
  console.log('popups abiertos:', submenu)

  // Clic real sobre "Usuario", con su mousedown previo, como haría una persona.
  const clicked = await click(`(() => {
    const pops = [...document.querySelectorAll('.menu-pop')]
    const sub = pops[pops.length - 1]
    const it = [...sub.querySelectorAll('.menu-item')].find(x => x.textContent.trim() === 'Usuario')
    if (!it) return 'no encontré Usuario en el submenú'
    it.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    it.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))
    it.click()
    return 'ok'
  })()`)
  console.log('Usuario (click):', clicked)
  await wait(1200)

  const dialog = await win.webContents.executeJavaScript(`(() => {
    const m = document.querySelector('.modal .ttl')
    return m ? m.textContent : null
  })()`)
  console.log('diálogo abierto:', dialog ?? 'NINGUNO')

  const image = await win.webContents.capturePage()
  await writeFile(join(OUT, 'menu-nuevo-usuario.png'), image.toPNG())

  app.exit(dialog ? 0 : 1)
}

main().catch((err) => {
  console.error('FATAL:', err)
  app.exit(2)
})
