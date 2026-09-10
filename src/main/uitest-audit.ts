/**
 * Auditoría de menús: recorre las cuatro consolas, abre cada menú y submenú y
 * comprueba que los ítems hagan algo.
 *
 * **No escribe nada en el directorio**: sólo se hace clic en ítems que abren un
 * diálogo (los que terminan en «…») o que alternan una preferencia, y todo
 * diálogo se cierra con Escape. Los ítems destructivos están en una lista negra
 * y nunca se tocan, porque esto corre contra un dominio productivo.
 */
import { app, ipcMain, nativeTheme, type BrowserWindow } from 'electron'
import { join } from 'node:path'
import { registerIpc } from './ipc'
import { openConsole, setPaths, type ConsoleId } from './windows'
import * as store from './store'

const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

/** Abren un diálogo nativo del sistema, que no es un .modal nuestro. */
const DIALOGO_NATIVO = /exportar/i

/** Nunca se hace clic en estos: escriben en el DC o cierran la aplicación. */
const NUNCA = /elimin|borrar|desconectar|cerrar esta consola|salir|recolecci|topolog[íi]a ahora|forzar|replicar|quitar/i

interface Hallazgo {
  consola: string
  menu: string
  item: string
  resultado: string
}

const hallazgos: Hallazgo[] = []

async function js<T>(win: BrowserWindow, code: string): Promise<T> {
  return win.webContents.executeJavaScript(code) as Promise<T>
}

async function cerrarPopups(win: BrowserWindow): Promise<void> {
  await js(win, `document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`)
  await wait(120)
  await js(win, `(() => {
    const ov = document.querySelector('.overlay')
    if (ov) ov.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
  })()`)
  await wait(180)
}

async function auditarConsola(id: ConsoleId, etiqueta: string): Promise<void> {
  const win = openConsole(id)
  await new Promise<void>((r) => win.webContents.once('did-finish-load', () => r()))
  await wait(3500)

  const menus = await js<string[]>(win, `[...document.querySelectorAll('.menu-btn')].map(b => b.textContent.trim())`)

  for (const menu of menus) {
    await cerrarPopups(win)
    await js(win, `[...document.querySelectorAll('.menu-btn')].find(b => b.textContent.trim() === ${JSON.stringify(menu)})?.click()`)
    await wait(350)

    const items = await js<{ label: string; disabled: boolean; submenu: boolean; toggle: boolean }[]>(win, `
      [...document.querySelectorAll('.menu-pop .menu-item')].map(el => ({
        label: el.textContent.trim(),
        disabled: el.classList.contains('disabled'),
        submenu: !!el.querySelector('.sub-arrow'),
        toggle: !!el.querySelector('span[style*="width: 15px"]')
      }))
    `)

    for (const item of items) {
      const nombre = item.label.replace(/\s+/g, ' ')
      if (item.disabled) {
        hallazgos.push({ consola: etiqueta, menu, item: nombre, resultado: 'deshabilitado' })
        continue
      }
      if (NUNCA.test(nombre)) {
        hallazgos.push({ consola: etiqueta, menu, item: nombre, resultado: 'omitido (destructivo)' })
        continue
      }

      // Reabrimos el menú antes de cada ítem: el clic anterior lo cerró.
      await cerrarPopups(win)
      await js(win, `[...document.querySelectorAll('.menu-btn')].find(b => b.textContent.trim() === ${JSON.stringify(menu)})?.click()`)
      await wait(300)

      if (item.submenu) {
        await js(win, `(() => {
          const it = [...document.querySelectorAll('.menu-pop .menu-item')].find(x => x.textContent.trim() === ${JSON.stringify(nombre)})
          it?.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
        })()`)
        await wait(350)
        const subItems = await js<string[]>(win, `(() => {
          const pops = [...document.querySelectorAll('.menu-pop')]
          if (pops.length < 2) return []
          return [...pops[pops.length - 1].querySelectorAll('.menu-item')].map(x => x.textContent.trim())
        })()`)

        if (!subItems.length) {
          hallazgos.push({ consola: etiqueta, menu, item: nombre, resultado: 'SUBMENÚ NO ABRE' })
          continue
        }

        for (const sub of subItems) {
          await cerrarPopups(win)
          await js(win, `[...document.querySelectorAll('.menu-btn')].find(b => b.textContent.trim() === ${JSON.stringify(menu)})?.click()`)
          await wait(280)
          await js(win, `(() => {
            const it = [...document.querySelectorAll('.menu-pop .menu-item')].find(x => x.textContent.trim() === ${JSON.stringify(nombre)})
            it?.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
          })()`)
          await wait(320)
          await js(win, `(() => {
            const pops = [...document.querySelectorAll('.menu-pop')]
            const it = [...pops[pops.length - 1].querySelectorAll('.menu-item')].find(x => x.textContent.trim() === ${JSON.stringify(sub)})
            if (!it) return
            it.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
            it.click()
          })()`)
          await wait(900)
          const modal = await js<string | null>(win, `document.querySelector('.modal .ttl')?.textContent ?? null`)
          hallazgos.push({
            consola: etiqueta,
            menu: `${menu} › ${nombre}`,
            item: sub,
            resultado: modal ? `abre «${modal}»` : 'SIN EFECTO'
          })
          await cerrarPopups(win)
        }
        continue
      }

      const esDialogo = /…$/.test(nombre)
      await js(win, `(() => {
        const it = [...document.querySelectorAll('.menu-pop .menu-item')].find(x => x.textContent.trim() === ${JSON.stringify(nombre)})
        if (!it) return
        it.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
        it.click()
      })()`)
      await wait(900)

      const modal = await js<string | null>(win, `document.querySelector('.modal .ttl')?.textContent ?? null`)
      const marcado = item.toggle
        ? await js<boolean>(win, `(() => {
            const it = [...document.querySelectorAll('.menu-pop .menu-item')].find(x => x.textContent.trim() === ${JSON.stringify(nombre)})
            return !!it?.querySelector('svg')
          })()`)
        : false

      hallazgos.push({
        consola: etiqueta,
        menu,
        item: nombre,
        resultado: modal
          ? `abre «${modal}»`
          : item.toggle
            ? `alterna (ahora ${marcado ? 'marcado' : 'sin marcar'})`
            : DIALOGO_NATIVO.test(nombre)
              ? 'abre el diálogo nativo de guardar'
              : esDialogo
                ? 'SIN EFECTO'
                : 'sin diálogo (acción directa)'
      })
      await cerrarPopups(win)
    }
  }

  await cerrarPopups(win)
  win.destroy()
}

async function main(): Promise<void> {
  app.setName('adeep')
  app.setPath('userData', join(app.getPath('appData'), 'adeep'))
  setPaths(__dirname)
  app.disableHardwareAcceleration()
  // Sin esto Electron cierra la app al destruir la última ventana entre consolas.
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

  const primera = openConsole('aduc')
  await new Promise<void>((r) => primera.webContents.once('did-finish-load', () => r()))
  await js(primera, `window.adeep.session.connect(${JSON.stringify(profile)}, ${JSON.stringify(password)})`)
  await wait(4000)
  primera.destroy()

  for (const [id, etiqueta] of [
    ['aduc', 'Usuarios y equipos'],
    ['sites', 'Sitios y servicios'],
    ['trusts', 'Dominios y confianzas'],
    ['dfs', 'DFS']
  ] as [ConsoleId, string][]) {
    await auditarConsola(id, etiqueta)
  }

  console.log('\n' + '─'.repeat(112))
  for (const h of hallazgos) {
    const marca = /SIN EFECTO|NO ABRE/.test(h.resultado) ? '✗' : ' '
    console.log(`${marca} ${h.consola.padEnd(20)} ${h.menu.padEnd(26)} ${h.item.padEnd(38)} ${h.resultado}`)
  }
  console.log('─'.repeat(112))
  const rotos = hallazgos.filter((h) => /SIN EFECTO|NO ABRE/.test(h.resultado))
  console.log(`${hallazgos.length} ítems recorridos, ${rotos.length} sin efecto`)
  app.exit(rotos.length ? 1 : 0)
}

main().catch((err) => {
  console.error('FATAL:', err)
  app.exit(2)
})
