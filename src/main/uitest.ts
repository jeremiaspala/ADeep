/**
 * Prueba de humo de la interfaz: abre cada consola, se conecta con el perfil
 * guardado y captura la pantalla. Sólo lectura; sirve para verificar que los
 * datos reales llegan hasta la UI.
 *
 *   xvfb-run -a npx electron out/main/uitest.js --no-sandbox
 */
import { app, BrowserWindow, ipcMain, nativeTheme } from 'electron'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { registerIpc } from './ipc'
import { CONSOLES, openConsole, setPaths, type ConsoleId } from './windows'
import * as store from './store'

const OUT = process.env.ADEEP_SHOT_DIR ?? '/tmp'

const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

async function shoot(win: BrowserWindow, name: string): Promise<void> {
  const image = await win.webContents.capturePage()
  await writeFile(join(OUT, `${name}.png`), image.toPNG())
  console.log(`  captura: ${name}.png`)
}

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

  for (const id of Object.keys(CONSOLES) as ConsoleId[]) {
    console.log(`\n${CONSOLES[id].title}`)
    const win = openConsole(id)
    await new Promise<void>((r) => win.webContents.once('did-finish-load', () => r()))
    await wait(1500)

    // La primera consola conecta; las demás heredan la sesión del proceso principal.
    const connected = await win.webContents.executeJavaScript(
      '(async () => (await window.adeep.session.info()).data?.connected === true)()'
    )
    if (!connected) {
      await win.webContents.executeJavaScript(`
        (async () => {
          const res = await window.adeep.session.connect(
            ${JSON.stringify(profile)}, ${JSON.stringify(password)}
          )
          return res.ok
        })()
      `)
      await wait(2500)
    }
    await wait(3500)
    await shoot(win, `ui-${id}`)

    const errors = await win.webContents.executeJavaScript(
      '(window.__adeepErrors ?? []).join(" | ")'
    ).catch(() => '')
    if (errors) console.log('  errores en el renderer:', errors)
  }

  console.log('\nlisto')
  app.exit(0)
}

main().catch((err) => {
  console.error('FATAL:', err)
  app.exit(1)
})
