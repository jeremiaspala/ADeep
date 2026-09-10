/**
 * Verifica el refresco automático entre ventanas: una consola escribe y las
 * demás recargan su vista sin que nadie apriete F5.
 *
 * **No escribe nada en el directorio.** El canal de escritura (`obj.modify`) se
 * reemplaza por un doble que devuelve true sin tocar LDAP, así que lo que se
 * ejercita es el camino real —el envoltorio `handle`, `broadcastExcept`, el
 * preload y la suscripción de cada consola— sin riesgo en producción.
 */
import { app, ipcMain, nativeTheme, type BrowserWindow } from 'electron'
import { join } from 'node:path'
import { ESCRITURA, currentConnection, handle, registerIpc } from './ipc'
import { openConsole, setPaths } from './windows'
import * as store from './store'

const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

async function js<T>(win: BrowserWindow, code: string): Promise<T> {
  return win.webContents.executeJavaScript(code) as Promise<T>
}

/** Cuenta los eventos `directory.changed` que llegan a una ventana. */
const contador = `(() => {
  window.__ev = 0
  window.adeep.app.onDirectoryChange(() => { window.__ev++ })
  return true
})()`

let fallas = 0
function check(cond: boolean, msg: string): void {
  console.log(`   ${cond ? '✓' : '✗'} ${msg}`)
  if (!cond) fallas++
}

/** Los 141 canales, clasificados por el mismo regex que usa el puente. */
function verificarClasificacion(): void {
  console.log('\nclasificación de canales')
  const escriben = [
    'create.user', 'obj.modify', 'obj.renameUser', 'obj.setEnabled', 'group.addMembers',
    'group.setPrimary', 'security.write', 'sites.setConnectionSchedule', 'sites.moveServer',
    'trusts.update', 'dfs.setFolderTargets', 'dns.addRecord', 'dns.deleteZone',
    'gpo.link', 'gpo.moveLink', 'ldapb.create'
  ]
  const leen = [
    'dir.children', 'dir.list', 'search.run', 'security.read', 'obj.protect.get',
    'obj.cannotChangePassword.get', 'sites.links', 'sites.validateSubnet', 'dns.zones',
    'gpo.list', 'trusts.forest', 'store.setPrefs', 'store.deleteProfile', 'session.info'
  ]
  for (const c of escriben) check(ESCRITURA.test(c), `${c} avisa`)
  for (const c of leen) check(!ESCRITURA.test(c), `${c} no avisa`)
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

  verificarClasificacion()

  const profile = (await store.getProfiles())[0]
  const password = profile && (await store.getSecret(profile.id))
  if (!profile || !password) throw new Error('Hace falta un perfil con contraseña guardada.')

  const aduc = openConsole('aduc')
  aduc.webContents.on('render-process-gone', (_e, d) => console.log('   ! ADUC murió:', d.reason))
  await new Promise<void>((r) => aduc.webContents.once('did-finish-load', () => r()))
  await js(aduc, `window.adeep.session.connect(${JSON.stringify(profile)}, ${JSON.stringify(password)})`)
  await wait(5000)

  const sites = openConsole('sites')
  await new Promise<void>((r) => sites.webContents.once('did-finish-load', () => r()))
  await wait(4000)

  // Contador de búsquedas LDAP: sirve para ver que el refresco realmente
  // vuelve a leer el directorio y no sólo dispara el evento.
  const conn = currentConnection()
  if (!conn) throw new Error('No hay conexión.')
  const original = conn.searchRaw.bind(conn)
  let busquedas = 0
  conn.searchRaw = ((...args: Parameters<typeof original>) => {
    busquedas++
    return original(...args)
  }) as typeof conn.searchRaw

  await js(aduc, contador)
  await js(sites, contador)

  // Doble de `obj.modify`: mismo envoltorio, misma difusión, cero escrituras.
  ipcMain.removeHandler('obj.modify')
  handle('obj.modify', () => true)

  console.log('\nlectura desde ADUC (no debería avisar a nadie)')
  await js(aduc, `window.adeep.dir.roots()`)
  await wait(1200)
  check((await js<number>(aduc, 'window.__ev')) === 0, 'ADUC no recibió evento')
  check((await js<number>(sites, 'window.__ev')) === 0, 'Sitios no recibió evento')

  console.log('\nescritura desde ADUC')
  busquedas = 0
  await js(aduc, `window.adeep.obj.modify('CN=prueba', [])`)
  await wait(2500)
  const evAduc = await js<number>(aduc, 'window.__ev')
  const evSites = await js<number>(sites, 'window.__ev')
  check(evAduc === 0, `ADUC no se avisa a sí mismo (ev=${evAduc})`)
  check(evSites === 1, `Sitios recibió el aviso (ev=${evSites})`)
  check(busquedas > 0, `Sitios recargó del directorio (${busquedas} búsquedas)`)

  console.log('\nescritura desde Sitios')
  busquedas = 0
  await js(sites, `window.adeep.obj.modify('CN=prueba', [])`)
  await wait(2500)
  check((await js<number>(sites, 'window.__ev')) === 1, 'Sitios no se avisa a sí mismo')
  check((await js<number>(aduc, 'window.__ev')) === 1, 'ADUC recibió el aviso')
  check(busquedas > 0, `ADUC recargó del directorio (${busquedas} búsquedas)`)

  console.log('\nráfaga de cinco escrituras (debe recargar una sola vez)')
  busquedas = 0
  await js(aduc, `Promise.all([1,2,3,4,5].map(() => window.adeep.obj.modify('CN=prueba', [])))`)
  await wait(2500)
  const rafaga = await js<number>(sites, 'window.__ev')
  check(rafaga === 6, `Sitios recibió los cinco avisos (ev=${rafaga})`)
  console.log(`   · ${busquedas} búsquedas tras la ráfaga (una recarga sola)`)

  console.log(fallas === 0 ? '\nTODO OK' : `\n${fallas} FALLAS`)
  app.exit(fallas === 0 ? 0 : 1)
}

main().catch((e) => {
  console.error('FATAL:', e)
  app.exit(2)
})
