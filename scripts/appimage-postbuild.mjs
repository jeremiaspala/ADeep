/**
 * Prepara el AppImage que genera electron-builder:
 *
 *  1. Reemplaza el runtime de 2019 (appimage-12.0.1) por el runtime estático de
 *     type2-runtime, que usa fusermount3. El viejo pide libfuse.so.2 y en
 *     distros con sólo FUSE 3 el AppImage no arranca ("dlopen(): error loading
 *     libfuse.so.2").
 *  2. Parchea AppRun para pasar siempre --no-sandbox: el montaje FUSE es nosuid,
 *     así que chrome-sandbox nunca puede ser setuid y Electron aborta sin eso.
 *  3. Genera un lanzador .desktop por consola, cada uno con su ícono y con
 *     `--console=<id>`.
 *
 * Es **un solo binario** para todas las consolas: comparten proceso y, por lo
 * tanto, la sesión LDAP. Abrir una segunda consola no vuelve a pedir credenciales.
 */
import { createWriteStream } from 'node:fs'
import { chmod, mkdir, mkdtemp, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { createReadStream } from 'node:fs'
import { pipeline } from 'node:stream/promises'
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
  // Las versiones viejas quedan en release/: hay que parchear la de este build,
  // no la primera que devuelva readdir.
  const { version } = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
  const actual = files.find((f) => f.includes(`-${version}-`))
  if (!actual) throw new Error(`No se encontró el AppImage ${version} en release/`)
  return join(dir, actual)
}

async function patchAppRun(appDir) {
  const path = join(appDir, 'AppRun')
  const src = await readFile(path, 'utf8')
  const patched = src
    .replace(/exec "\$BIN"( --no-sandbox[^\n]*)?\n/, 'exec "$BIN" --no-sandbox\n')
    .replace(/exec "\$BIN"( --no-sandbox[^"]*)? "\$\{args\[@\]\}"/, 'exec "$BIN" --no-sandbox "\${args[@]}"')
  await writeFile(path, patched, { mode: 0o755 })
}

const CONSOLES = [
  { id: 'aduc', name: 'ADeep — Usuarios y equipos', generic: 'Usuarios y equipos de Active Directory', comment: 'Usuarios, grupos, equipos y OUs de Active Directory' },
  { id: 'sites', name: 'ADeep — Sitios y servicios', generic: 'Sitios y servicios de Active Directory', comment: 'Sitios, subredes, vínculos y replicación de AD' },
  { id: 'trusts', name: 'ADeep — Dominios y confianzas', generic: 'Dominios y confianzas de Active Directory', comment: 'Dominios del bosque, confianzas y sufijos UPN' },
  { id: 'dfs', name: 'ADeep — Administración de DFS', generic: 'Administración de DFS', comment: 'Espacios de nombres DFS y replicación DFS-R' },
  { id: 'dns', name: 'ADeep — DNS', generic: 'DNS integrado en Active Directory', comment: 'Zonas y registros DNS del directorio' },
  { id: 'dhcp', name: 'ADeep — DHCP', generic: 'DHCP', comment: 'Servidores DHCP autorizados en el dominio' },
  { id: 'hyperv', name: 'ADeep — Hyper-V', generic: 'Hyper-V', comment: 'Hosts, máquinas virtuales y migración en vivo' },
  { id: 'ldap', name: 'ADeep — Editor LDAP', generic: 'Editor de directorio', comment: 'Acceso crudo a cualquier contexto de nombres' },
  { id: 'gpo', name: 'ADeep — Directivas de grupo', generic: 'Directivas de grupo', comment: 'Directivas, vínculos, herencia y precedencia' },
  { id: 'adcs', name: 'ADeep — Certificados', generic: 'Servicios de certificados', comment: 'Entidades emisoras, plantillas y revisión de seguridad' }
]

/** Un lanzador por consola, todos apuntando al mismo AppImage. */
async function writeLaunchers(appImage) {
  const dir = join(root, 'release', 'launchers')
  await mkdir(dir, { recursive: true })

  const { copyFile } = await import('node:fs/promises')
  for (const c of CONSOLES) {
    await copyFile(join(root, 'build', 'icons', `${c.id}.png`), join(dir, `adeep-${c.id}.png`))
    const desktop = [
      '[Desktop Entry]',
      'Type=Application',
      `Name=${c.name}`,
      `GenericName=${c.generic}`,
      `Comment=${c.comment}`,
      `Exec=${appImage} --console=${c.id} %U`,
      `Icon=adeep-${c.id}`,
      'Terminal=false',
      'Categories=System;',
      // Tiene que coincidir con el WM_CLASS que reporta Electron, o el panel no
      // asocia la ventana con su lanzador y muestra un ícono genérico.
      'StartupWMClass=adeep',
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
    'for f in "$DIR"/*.png; do [ -f "$f" ] && cp "$f" "$ICONS/"; done',
    'update-desktop-database "$DEST" 2>/dev/null || true',
    'echo "Lanzadores instalados en $DEST"',
    ''
  ].join('\n')
  await writeFile(join(dir, 'instalar-lanzadores.sh'), install, { mode: 0o755 })

  console.log(`✓ ${dir}: ${CONSOLES.length} lanzadores + instalar-lanzadores.sh`)
}

async function main() {
  await ensureRuntime()
  const appImage = await findAppImage()
  // /tmp suele ser un tmpfs en RAM y acá se manejan cientos de MB: se trabaja en disco.
  const scratch = join(root, 'release', '.build')
  await mkdir(scratch, { recursive: true })
  const work = await mkdtemp(join(scratch, 'appimage-'))

  try {
    console.log('• extrayendo el AppImage')
    await run(appImage, ['--appimage-extract'], { cwd: work, maxBuffer: 64 * 1024 * 1024 })
    const appDir = join(work, 'squashfs-root')

    await patchAppRun(appDir)

    console.log('• recomprimiendo squashfs')
    const sqfs = join(work, 'payload.sqfs')
    await run('mksquashfs', [
      appDir, sqfs,
      '-root-owned', '-noappend', '-no-xattrs',
      '-comp', 'gzip', '-b', '131072', '-mkfs-time', '0'
    ], { maxBuffer: 64 * 1024 * 1024 })

    console.log('• uniendo runtime + squashfs')
    const out = `${appImage}.new`
    await pipeline(createReadStream(runtimePath), createWriteStream(out))
    await pipeline(createReadStream(sqfs), createWriteStream(out, { flags: 'a' }))
    await chmod(out, 0o755)
    await rm(appImage)
    await rename(out, appImage)

    const { size } = await stat(appImage)
    console.log(`✓ ${appImage} (${(size / 1024 / 1024).toFixed(0)} MB)`)

    await writeLaunchers(appImage)
  } finally {
    await rm(work, { recursive: true, force: true })
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
