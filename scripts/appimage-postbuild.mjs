/**
 * Reempaqueta el AppImage que genera electron-builder:
 *
 *  1. Reemplaza el runtime de 2019 (appimage-12.0.1) por el runtime estático de
 *     type2-runtime, que usa fusermount3. El viejo pide libfuse.so.2 y en
 *     distros con sólo FUSE 3 el AppImage no arranca ("dlopen(): error loading
 *     libfuse.so.2").
 *  2. Parchea AppRun para pasar siempre --no-sandbox: el montaje FUSE es nosuid,
 *     así que chrome-sandbox nunca puede ser setuid y Electron aborta. Sólo el
 *     .desktop lo pasaba, por lo que fallaba al ejecutarlo desde la terminal.
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

async function patchAppRun(appDir) {
  const path = join(appDir, 'AppRun')
  const src = await readFile(path, 'utf8')
  if (src.includes('--no-sandbox')) return
  const patched = src
    .replace('exec "$BIN"\n', 'exec "$BIN" --no-sandbox\n')
    .replace('exec "$BIN" "${args[@]}"', 'exec "$BIN" --no-sandbox "${args[@]}"')
  await writeFile(path, patched, { mode: 0o755 })
}

async function main() {
  await ensureRuntime()
  const appImage = await findAppImage()
  const work = await mkdtemp(join(tmpdir(), 'adeep-appimage-'))

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
    // El destino va en release/ para que el rename final no cruce filesystems.
    const out = `${appImage}.new`
    await pipeline(createReadStream(runtimePath), createWriteStream(out))
    await pipeline(createReadStream(sqfs), createWriteStream(out, { flags: 'a' }))

    await chmod(out, 0o755)
    await rm(appImage)
    await rename(out, appImage)
    const { size } = await stat(appImage)
    console.log(`✓ ${appImage} (${(size / 1024 / 1024).toFixed(0)} MB)`)
  } finally {
    await rm(work, { recursive: true, force: true })
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
