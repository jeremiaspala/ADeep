/**
 * Convierte el único AppImage que genera electron-builder en **un AppImage por
 * consola**, todos con la misma carga útil:
 *
 *  1. Reemplaza el runtime de 2019 (appimage-12.0.1) por el runtime estático de
 *     type2-runtime, que usa fusermount3. El viejo pide libfuse.so.2 y en
 *     distros con sólo FUSE 3 el AppImage no arranca ("dlopen(): error loading
 *     libfuse.so.2").
 *  2. Parchea AppRun para pasar siempre --no-sandbox y la consola que le toca:
 *     el montaje FUSE es nosuid, así que chrome-sandbox nunca puede ser setuid y
 *     Electron aborta si no recibe --no-sandbox.
 *  3. Reescribe el .desktop de cada uno con su nombre propio.
 *
 * Los cuatro comparten el bloqueo de instancia única de Electron: abrir el
 * segundo estando el primero corriendo no levanta otro proceso, le pide al que ya
 * está que abra esa consola. Así la sesión LDAP se comparte y no hay que
 * autenticarse cuatro veces.
 */
import { createWriteStream } from 'node:fs'
import { chmod, mkdir, mkdtemp, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { createReadStream } from 'node:fs'
import { pipeline } from 'node:stream/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'

const run = promisify(execFile)
const root = resolve(import.meta.dirname, '..')
const RUNTIME_URL =
  'https://github.com/AppImage/type2-runtime/releases/download/continuous/runtime-x86_64'
const runtimePath = join(root, 'build', 'runtime-x86_64')

async function exists(path) {
  try { await stat(path); return true } catch { return false }
}

async function ensureRuntime() {
  if (await exists(runtimePath)) return
  console.log('• descargando runtime AppImage estático (type2-runtime)')
  const res = await fetch(RUNTIME_URL)
  if (!res.ok) throw new Error(`No se pudo descargar el runtime: HTTP ${res.status}`)
  await mkdir(join(root, 'build'), { recursive: true })
  await pipeline(res.body, createWriteStream(runtimePath))
  await chmod(runtimePath, 0o755)
}

async function findAppImage() {
  const dir = join(root, 'release')
  const { readdir } = await import('node:fs/promises')
  const files = (await readdir(dir)).filter((f) => f.endsWith('.AppImage'))
  if (!files.length) throw new Error('No se encontró ningún .AppImage en release/')
  return join(dir, files[0])
}

async function patchAppRun(appDir, consoleId) {
  const path = join(appDir, 'AppRun')
  const src = await readFile(path, 'utf8')
  const flags = `--no-sandbox --console=${consoleId}`
  const patched = src
    .replace(/exec "\$BIN"( --no-sandbox[^\n]*)?\n/, `exec "$BIN" ${flags}\n`)
    .replace(/exec "\$BIN"( --no-sandbox[^"]*)? "\$\{args\[@\]\}"/, `exec "$BIN" ${flags} "\${args[@]}"`)
  await writeFile(path, patched, { mode: 0o755 })
}

async function patchDesktop(appDir, c) {
  const { readdir } = await import('node:fs/promises')
  const entry = (await readdir(appDir)).find((f) => f.endsWith('.desktop'))
  if (!entry) return
  const path = join(appDir, entry)
  const src = await readFile(path, 'utf8')
  const patched = src
    .replace(/^Name=.*$/m, `Name=${c.name}`)
    .replace(/^Exec=.*$/m, `Exec=AppRun --no-sandbox --console=${c.id} %U`)
    .replace(/^Comment=.*$/m, `Comment=${c.comment}`)
  await writeFile(path, patched)
}

const CONSOLES = [
  { id: 'aduc', file: 'ADeep-Usuarios-y-equipos', name: 'ADeep — Usuarios y equipos', comment: 'Usuarios, grupos, equipos y OUs de Active Directory' },
  { id: 'sites', file: 'ADeep-Sitios-y-servicios', name: 'ADeep — Sitios y servicios', comment: 'Sitios, subredes, vínculos y replicación de AD' },
  { id: 'trusts', file: 'ADeep-Dominios-y-confianzas', name: 'ADeep — Dominios y confianzas', comment: 'Dominios del bosque, confianzas y sufijos UPN' },
  { id: 'dfs', file: 'ADeep-DFS', name: 'ADeep — Administración de DFS', comment: 'Espacios de nombres DFS y replicación DFS-R' }
]

/** Entradas de menú que apuntan a cada AppImage ya generado. */
async function writeLaunchers(built) {
  const dir = join(root, 'release', 'launchers')
  await mkdir(dir, { recursive: true })

  for (const { console: c, file } of built) {
    const desktop = [
      '[Desktop Entry]',
      'Type=Application',
      `Name=${c.name}`,
      `Comment=${c.comment}`,
      `Exec=${file} %U`,
      'Icon=adeep',
      'Terminal=false',
      'Categories=System;',
      'StartupWMClass=ADeep',
      ''
    ].join('\n')
    await writeFile(join(dir, `adeep-${c.id}.desktop`), desktop, { mode: 0o755 })
  }

  const install = [
    '#!/bin/sh',
    '# Instala un lanzador por consola en el menú del escritorio.',
    'set -e',
    'DEST="$HOME/.local/share/applications"',
    'ICONS="$HOME/.local/share/icons/hicolor/512x512/apps"',
    'mkdir -p "$DEST" "$ICONS"',
    'DIR="$(cd "$(dirname "$0")" && pwd)"',
    'cp "$DIR"/adeep-*.desktop "$DEST"/',
    '[ -f "$DIR/../../build/icon.png" ] && cp "$DIR/../../build/icon.png" "$ICONS/adeep.png" || true',
    'update-desktop-database "$DEST" 2>/dev/null || true',
    'echo "Lanzadores instalados en $DEST"',
    ''
  ].join('\n')
  await writeFile(join(dir, 'instalar-lanzadores.sh'), install, { mode: 0o755 })

  console.log(`✓ ${dir}: ${CONSOLES.length} lanzadores + instalar-lanzadores.sh`)
}

async function main() {
  await ensureRuntime()
  const source = await findAppImage()
  const version = JSON.parse(await readFile(join(root, 'package.json'), 'utf8')).version
  const work = await mkdtemp(join(tmpdir(), 'adeep-appimage-'))

  try {
    console.log('• extrayendo la carga útil')
    await run(source, ['--appimage-extract'], { cwd: work, maxBuffer: 64 * 1024 * 1024 })
    const appDir = join(work, 'squashfs-root')
    await rm(source)

    const built = []
    for (const c of CONSOLES) {
      console.log(`• ${c.name}`)
      await patchAppRun(appDir, c.id)
      await patchDesktop(appDir, c)

      const sqfs = join(work, `${c.id}.sqfs`)
      await run('mksquashfs', [
        appDir, sqfs,
        '-root-owned', '-noappend', '-no-xattrs',
        '-comp', 'gzip', '-b', '131072', '-mkfs-time', '0'
      ], { maxBuffer: 64 * 1024 * 1024 })

      const file = join(root, 'release', `${c.file}-${version}-x86_64.AppImage`)
      await pipeline(createReadStream(runtimePath), createWriteStream(file))
      await pipeline(createReadStream(sqfs), createWriteStream(file, { flags: 'a' }))
      await chmod(file, 0o755)
      await rm(sqfs)

      const { size } = await stat(file)
      console.log(`  ✓ ${file} (${(size / 1024 / 1024).toFixed(0)} MB)`)
      built.push({ console: c, file })
    }

    await writeLaunchers(built)
  } finally {
    await rm(work, { recursive: true, force: true })
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
