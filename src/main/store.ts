/** Persistencia de perfiles, consultas guardadas y preferencias en ~/.config/adeep. */
import { app, safeStorage } from 'electron'
import { promises as fs, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ConnectionProfile, Preferences, SavedQuery } from '../shared/types'

export type { Preferences }

interface StoreShape {
  profiles: ConnectionProfile[]
  queries: SavedQuery[]
  prefs: Preferences
}

const DEFAULT_PREFS: Preferences = {
  theme: 'system',
  showAdvancedFeatures: false,
  showUsersGroupsAsContainers: false,
  maxItems: 2000,
  columns: ['name', 'kind', 'description'],
  language: 'es',
  confirmDelete: true,
  density: 'comfortable',
  hardwareAcceleration: false,
  acceptedFindings: []
}

let cache: StoreShape | null = null

function file(): string {
  return join(app.getPath('userData'), 'adeep.json')
}

function secretsFile(): string {
  return join(app.getPath('userData'), 'secrets.bin')
}

async function readJSON<T>(path: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await fs.readFile(path, 'utf8')) as T
  } catch {
    return fallback
  }
}

/**
 * Lectura sincrónica: `app.disableHardwareAcceleration()` tiene que llamarse antes
 * de que Electron esté listo, y para entonces no hay tiempo de un await.
 */
export function getPrefsSync(): Preferences {
  try {
    const raw = readFileSync(join(app.getPath('userData'), 'adeep.json'), 'utf8')
    const data = JSON.parse(raw) as Partial<StoreShape>
    return { ...DEFAULT_PREFS, ...(data.prefs ?? {}) }
  } catch {
    return DEFAULT_PREFS
  }
}

export async function load(): Promise<StoreShape> {
  if (cache) return cache
  const data = await readJSON<Partial<StoreShape>>(file(), {})
  cache = {
    profiles: data.profiles ?? [],
    queries: data.queries ?? [],
    prefs: { ...DEFAULT_PREFS, ...(data.prefs ?? {}) }
  }
  return cache
}

async function persist(): Promise<void> {
  if (!cache) return
  const path = file()
  await fs.mkdir(app.getPath('userData'), { recursive: true })
  // El password nunca va al JSON en claro; se guarda cifrado aparte.
  const safe: StoreShape = {
    ...cache,
    profiles: cache.profiles.map(({ password, ...rest }) => {
      void password
      return rest as ConnectionProfile
    })
  }
  await fs.writeFile(path, JSON.stringify(safe, null, 2), { mode: 0o600 })
}

export async function getProfiles(): Promise<ConnectionProfile[]> {
  const s = await load()
  return [...s.profiles].sort((a, b) => (b.lastUsed ?? 0) - (a.lastUsed ?? 0))
}

export async function saveProfile(profile: ConnectionProfile): Promise<ConnectionProfile[]> {
  const s = await load()
  const i = s.profiles.findIndex((p) => p.id === profile.id)
  const { password, ...clean } = profile
  if (i >= 0) s.profiles[i] = clean as ConnectionProfile
  else s.profiles.push(clean as ConnectionProfile)
  // Sólo se borra el secreto cuando el usuario apaga "guardar la contraseña".
  // Antes, guardar un perfil sin incluir el password (que sessionInfo nunca
  // devuelve) borraba la contraseña ya guardada.
  if (profile.savePassword) {
    if (password) await setSecret(profile.id, password)
  } else {
    await deleteSecret(profile.id)
  }
  await persist()
  return getProfiles()
}

export async function deleteProfile(id: string): Promise<ConnectionProfile[]> {
  const s = await load()
  s.profiles = s.profiles.filter((p) => p.id !== id)
  await deleteSecret(id)
  await persist()
  return getProfiles()
}

export async function touchProfile(id: string): Promise<void> {
  const s = await load()
  const p = s.profiles.find((x) => x.id === id)
  if (p) { p.lastUsed = Date.now(); await persist() }
}

/* ---------- Contraseñas cifradas con safeStorage ---------- */

type Secrets = Record<string, string>

async function readSecrets(): Promise<Secrets> {
  try {
    const raw = await fs.readFile(secretsFile())
    if (!safeStorage.isEncryptionAvailable()) return {}
    return JSON.parse(safeStorage.decryptString(raw)) as Secrets
  } catch {
    return {}
  }
}

async function writeSecrets(s: Secrets): Promise<void> {
  if (!safeStorage.isEncryptionAvailable()) return
  await fs.mkdir(app.getPath('userData'), { recursive: true })
  await fs.writeFile(secretsFile(), safeStorage.encryptString(JSON.stringify(s)), { mode: 0o600 })
}

export async function getSecret(id: string): Promise<string | undefined> {
  return (await readSecrets())[id]
}

export async function setSecret(id: string, value: string): Promise<void> {
  const s = await readSecrets()
  s[id] = value
  await writeSecrets(s)
}

export async function deleteSecret(id: string): Promise<void> {
  const s = await readSecrets()
  if (!(id in s)) return
  delete s[id]
  await writeSecrets(s)
}

export function encryptionAvailable(): boolean {
  return safeStorage.isEncryptionAvailable()
}

/* ---------- Consultas guardadas ---------- */

export async function getQueries(): Promise<SavedQuery[]> {
  return (await load()).queries
}

export async function saveQuery(q: SavedQuery): Promise<SavedQuery[]> {
  const s = await load()
  const i = s.queries.findIndex((x) => x.id === q.id)
  if (i >= 0) s.queries[i] = q
  else s.queries.push(q)
  await persist()
  return s.queries
}

export async function deleteQuery(id: string): Promise<SavedQuery[]> {
  const s = await load()
  s.queries = s.queries.filter((q) => q.id !== id)
  await persist()
  return s.queries
}

/* ---------- Preferencias ---------- */

export async function getPrefs(): Promise<Preferences> {
  return (await load()).prefs
}

export async function setPrefs(prefs: Partial<Preferences>): Promise<Preferences> {
  const s = await load()
  s.prefs = { ...s.prefs, ...prefs }
  await persist()
  return s.prefs
}
