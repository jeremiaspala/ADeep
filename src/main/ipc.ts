/** Puente IPC: toda la superficie de API que consume el renderer. */
import { ipcMain, dialog, shell, BrowserWindow, clipboard } from 'electron'
import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { AdConnection, ConnectionError, wrapError } from './ldap/connection'
import {
  LIST_ATTRS, allStrings, dnLabel, firstBuffer, firstNumber, firstString,
  listChildren, listContainerChildren, resolveSchemaGuids, resolveSids,
  toAttributeValues, toDirEntry
} from './ldap/directory'
import * as ops from './ldap/operations'
import * as store from './store'
import { registerConsoleIpc } from './ipc-consoles'
import { broadcast, broadcastExcept } from './windows'
import { SDFlagsControl } from './ldap/controls'
import { buildSecurityDescriptor, parseSecurityDescriptor, SD_FLAGS } from './ldap/sddl'
import {
  dnToCanonical, escapeFilter, filetimeToDate, parentDN, rdnValue, splitDN
} from './ldap/encoding'
import { guidFilter, sidFilter } from './ldap/filters'
import type {
  AppResult, ConnectionProfile, CreateComputerInput, CreateContactInput, CreateGroupInput,
  CreateOUInput, CreateUserInput, DirEntry, Preferences, SavedQuery, SearchRequest,
  SearchResult, SecurityDescriptor, SessionInfo, Modification
} from '../shared/types'

let conn: AdConnection | null = null

function requireConn(): AdConnection {
  if (!conn || !conn.connected) throw new ConnectionError('No hay conexión activa con el dominio.')
  return conn
}

function ok<T>(data: T): AppResult<T> {
  return { ok: true, data }
}

function fail(err: unknown): AppResult<never> {
  const e = err instanceof ConnectionError ? err : wrapError(err)
  return { ok: false, error: e.message, code: e.code }
}

/**
 * Canales que modifican el directorio. Se usan para avisarle al resto de las
 * ventanas que su vista quedó vieja; no hay sondeo, sólo esto.
 */
export const ESCRITURA =
  /^(create\.|ldapb\.create$|obj\.(?!.*\.get$)|group\.(add|remove|setPrimary)|security\.write$|sites\.(create|set|move|update|delete|rootDseOperation|replicateObject)|trusts\.(update|set|raise)|dfs\.(set|create|delete)|dns\.(add|replace|delete|create)|gpo\.(link|unlink|set|move))/

/** Envuelve un handler para que nunca tire una excepción cruzando el puente. */
export function handle<A extends unknown[], R>(
  channel: string,
  fn: (...args: A) => Promise<R> | R
): void {
  ipcMain.handle(channel, async (e, ...args) => {
    try {
      const result = ok(await fn(...(args as A)))
      if (ESCRITURA.test(channel)) broadcastExcept(e.sender.id, 'directory.changed', channel)
      return result
    } catch (err) {
      return fail(err)
    }
  })
}

function sessionInfo(): SessionInfo {
  if (!conn || !conn.connected) return { connected: false }
  return {
    connected: true,
    profile: { ...conn.profile, password: undefined },
    rootDSE: conn.rootDSE,
    whoami: conn.whoami,
    domainSID: conn.domainSID,
    netbiosName: conn.netbiosName,
    machineAccountQuota: conn.machineAccountQuota
  }
}

export function registerIpc(): void {
  /* ---------------- Sesión ---------------- */

  handle('session.connect', async (profile: ConnectionProfile, password: string) => {
    // Todas las consolas abiertas comparten la conexión: hay que avisarles.
    if (conn) { await conn.disconnect(); conn = null }
    conn = await AdConnection.connect({ ...profile }, password)
    await store.touchProfile(profile.id).catch(() => undefined)
    const info = sessionInfo()
    broadcast('session.changed', info)
    return info
  })

  handle('session.disconnect', async () => {
    if (conn) await conn.disconnect()
    conn = null
    const info = sessionInfo()
    broadcast('session.changed', info)
    return info
  })

  handle('session.info', () => sessionInfo())

  handle('session.passwordPolicy', async () => ops.getPasswordPolicy(requireConn()))

  handle('session.fsmo', async () => ops.getFsmoRoles(requireConn()))

  handle('session.domainControllers', async () => ops.getDomainControllers(requireConn()))

  handle('session.wellKnownContainers', async () => ops.getWellKnownContainers(requireConn()))

  /* ---------------- Navegación ---------------- */

  handle('dir.roots', async () => {
    const c = requireConn()
    const e = await c.searchOne(c.baseDN, [
      'objectClass', 'name', 'objectGUID', 'description', 'dc'
    ])
    if (!e) throw new ConnectionError('No se pudo leer la raíz del dominio.')
    const root = toDirEntry(e)
    root.name = ops.domainOf(c) || root.name
    root.isContainer = true
    return [root]
  })

  handle('dir.children', async (dn: string, showAdvanced: boolean) =>
    listContainerChildren(requireConn(), dn, showAdvanced)
  )

  handle('dir.list', async (dn: string, showAdvanced: boolean, extraFilter?: string, sizeLimit?: number) =>
    listChildren(requireConn(), dn, { showAdvanced, extraFilter, sizeLimit })
  )

  handle('dir.entry', async (dn: string, attributes?: string[]) => {
    const c = requireConn()
    const e = await c.searchOne(dn, attributes ?? [...LIST_ATTRS, '*'])
    if (!e) throw new ConnectionError('El objeto no existe o no tenés permiso para leerlo.')
    return toDirEntry(e, true)
  })

  handle('dir.attributes', async (dn: string, includeOperational: boolean) => {
    const c = requireConn()
    const attrs = includeOperational ? ['*', '+'] : ['*']
    const e = await c.searchOne(dn, attrs)
    if (!e) throw new ConnectionError('El objeto no existe o no tenés permiso para leerlo.')
    return toAttributeValues(e)
  })

  handle('dir.canonical', (dn: string) => dnToCanonical(dn))

  handle('dir.parent', (dn: string) => parentDN(dn))

  handle('dir.hasChildren', async (dn: string) => ops.hasChildren(requireConn(), dn))

  /* ---------------- Búsqueda ---------------- */

  handle('search.run', async (req: SearchRequest): Promise<SearchResult> => {
    const c = requireConn()
    const t0 = Date.now()
    const limit = req.sizeLimit ?? 0
    const raw = await c.searchRaw(req.baseDN, {
      scope: req.scope,
      filter: req.filter,
      attributes: req.attributes ?? LIST_ATTRS,
      sizeLimit: limit,
      includeDeleted: req.includeDeleted,
      pageSize: req.pageSize
    })
    return {
      entries: raw.map((e) => toDirEntry(e, true)),
      truncated: limit > 0 && raw.length >= limit,
      took: Date.now() - t0
    }
  })

  /** Selector de objetos ("Seleccionar usuarios, contactos o grupos"). */
  handle('search.pick', async (text: string, kinds: string[], baseDN?: string) => {
    const c = requireConn()
    const q = escapeFilter(text.trim())
    if (!q) return [] as DirEntry[]

    const classFilters: string[] = []
    if (kinds.includes('user')) classFilters.push('(&(objectCategory=person)(objectClass=user)(!(objectClass=computer)))')
    if (kinds.includes('group')) classFilters.push('(objectCategory=group)')
    if (kinds.includes('computer')) classFilters.push('(objectCategory=computer)')
    if (kinds.includes('contact')) classFilters.push('(objectCategory=contact)')
    if (kinds.includes('ou')) classFilters.push('(objectCategory=organizationalUnit)')
    if (kinds.includes('gmsa')) classFilters.push('(objectClass=msDS-GroupManagedServiceAccount)')
    const cls = classFilters.length ? `(|${classFilters.join('')})` : '(objectClass=*)'

    const match = `(|(sAMAccountName=${q}*)(cn=${q}*)(name=${q}*)(displayName=${q}*)(givenName=${q}*)(sn=${q}*)(userPrincipalName=${q}*)(mail=${q}*))`
    const raw = await c.searchRaw(baseDN ?? c.baseDN, {
      scope: 'sub',
      filter: `(&${cls}${match})`,
      attributes: LIST_ATTRS,
      sizeLimit: 200
    })
    return raw.map((e) => toDirEntry(e))
  })

  handle('search.byDN', async (dns: string[]) => {
    const c = requireConn()
    if (!dns.length) return [] as DirEntry[]
    const raw = await c.searchRaw(c.baseDN, {
      scope: 'sub',
      filter: `(|${dns.map((d) => `(distinguishedName=${escapeFilter(d)})`).join('')})`,
      attributes: LIST_ATTRS
    })
    return raw.map((e) => toDirEntry(e))
  })

  handle('search.bySid', async (sid: string) => {
    const c = requireConn()
    const raw = await c.searchRaw(c.baseDN, {
      scope: 'sub', filter: sidFilter(sid), attributes: LIST_ATTRS
    })
    return raw[0] ? toDirEntry(raw[0], true) : null
  })

  handle('search.byGuid', async (guid: string) => {
    const c = requireConn()
    const raw = await c.searchRaw(c.baseDN, {
      scope: 'sub', filter: guidFilter(guid), attributes: LIST_ATTRS
    })
    return raw[0] ? toDirEntry(raw[0], true) : null
  })

  /* ---------------- Creación ---------------- */

  handle('create.user', async (input: CreateUserInput) => ops.createUser(requireConn(), input))
  handle('create.group', async (input: CreateGroupInput) => ops.createGroup(requireConn(), input))
  handle('create.ou', async (input: CreateOUInput) => ops.createOU(requireConn(), input))
  handle('create.computer', async (input: CreateComputerInput) => ops.createComputer(requireConn(), input))
  handle('create.contact', async (input: CreateContactInput) => ops.createContact(requireConn(), input))

  /** Copiar usuario: replica los atributos que copia ADUC + membresías. */
  handle('create.copyUser', async (sourceDN: string, input: CreateUserInput) => {
    const c = requireConn()
    const dn = await ops.createUser(c, input)
    const src = await c.searchOne(sourceDN, [
      'department', 'company', 'l', 'st', 'co', 'c', 'postalCode', 'streetAddress',
      'physicalDeliveryOfficeName', 'manager', 'title', 'homeDrive', 'homeDirectory',
      'profilePath', 'scriptPath', 'userAccountControl', 'memberOf', 'primaryGroupID'
    ])
    if (src) {
      const copyAttrs = [
        'department', 'company', 'l', 'st', 'co', 'c', 'postalCode', 'streetAddress',
        'physicalDeliveryOfficeName', 'manager', 'title', 'homeDrive', 'homeDirectory',
        'profilePath', 'scriptPath'
      ]
      const mods = copyAttrs
        .map((a) => ({ op: 'replace' as const, attribute: a, values: allStrings(src, a) }))
        .filter((m) => m.values.length)
      if (mods.length) await c.modify(dn, mods)
      const groups = allStrings(src, 'memberOf')
      if (groups.length) await ops.addToGroups(c, dn, groups).catch(() => undefined)
    }
    return dn
  })

  /* ---------------- Modificación ---------------- */

  handle('obj.modify', async (dn: string, mods: Modification[]) => {
    const c = requireConn()
    await c.modify(
      dn,
      mods.map((m) => ({
        op: m.op,
        attribute: m.attribute,
        values: m.base64 ? m.values.map((v) => Buffer.from(v, 'base64')) : m.values
      }))
    )
    return true
  })

  handle('obj.rename', async (dn: string, newName: string) => ops.renameObject(requireConn(), dn, newName))

  handle('obj.renameUser', async (
    dn: string,
    fields: {
      cn: string; givenName?: string; initials?: string; sn?: string
      displayName?: string; sAMAccountName?: string; userPrincipalName?: string
    }
  ) => ops.renameUser(requireConn(), dn, fields))

  handle('obj.move', async (dns: string[], target: string) => {
    const c = requireConn()
    const results: { dn: string; newDN?: string; error?: string }[] = []
    for (const dn of dns) {
      try {
        results.push({ dn, newDN: await ops.moveObject(c, dn, target) })
      } catch (err) {
        results.push({ dn, error: (err instanceof Error ? err : wrapError(err)).message })
      }
    }
    return results
  })

  handle('obj.delete', async (dns: string[], tree: boolean) => {
    const c = requireConn()
    const results: { dn: string; error?: string }[] = []
    for (const dn of dns) {
      try {
        await ops.deleteObject(c, dn, tree)
        results.push({ dn })
      } catch (err) {
        results.push({ dn, error: (err instanceof Error ? err : wrapError(err)).message })
      }
    }
    return results
  })

  handle('obj.setEnabled', async (dns: string[], enabled: boolean) => {
    const c = requireConn()
    for (const dn of dns) await ops.setAccountEnabled(c, dn, enabled)
    return true
  })

  handle('obj.unlock', async (dns: string[]) => {
    const c = requireConn()
    for (const dn of dns) await ops.unlockAccount(c, dn)
    return true
  })

  handle('obj.resetPassword', async (dn: string, password: string, mustChange: boolean, unlock: boolean) => {
    await ops.resetPassword(requireConn(), dn, password, mustChange, unlock)
    return true
  })

  handle('obj.changePassword', async (dn: string, oldPassword: string, newPassword: string) => {
    await ops.changePassword(requireConn(), dn, oldPassword, newPassword)
    return true
  })

  handle('obj.setUAC', async (dn: string, uac: number) => {
    await ops.setUAC(requireConn(), dn, uac)
    return true
  })

  handle('obj.setAccountExpires', async (dn: string, iso: string | null) => {
    await ops.setAccountExpires(requireConn(), dn, iso ? new Date(iso) : null)
    return true
  })

  handle('obj.cannotChangePassword.get', async (dn: string) => ops.getCannotChangePassword(requireConn(), dn))
  handle('obj.cannotChangePassword.set', async (dn: string, v: boolean) => {
    await ops.setCannotChangePassword(requireConn(), dn, v)
    return true
  })

  handle('obj.protect.get', async (dn: string) => ops.getProtectFromDeletion(requireConn(), dn))
  handle('obj.protect.set', async (dn: string, v: boolean) => {
    await ops.setProtectFromDeletion(requireConn(), dn, v)
    return true
  })

  /* ---------------- Grupos ---------------- */

  handle('group.memberOf', async (dn: string) => ops.getMemberOf(requireConn(), dn))
  handle('group.memberOfRecursive', async (dn: string) => ops.getMemberOfRecursive(requireConn(), dn))
  handle('group.members', async (dn: string) => ops.getMembers(requireConn(), dn))
  handle('group.addMembers', async (dn: string, members: string[]) => {
    await ops.addMembers(requireConn(), dn, members); return true
  })
  handle('group.removeMembers', async (dn: string, members: string[]) => {
    await ops.removeMembers(requireConn(), dn, members); return true
  })
  handle('group.addTo', async (memberDN: string, groups: string[]) => {
    await ops.addToGroups(requireConn(), memberDN, groups); return true
  })
  handle('group.removeFrom', async (memberDN: string, groups: string[]) => {
    await ops.removeFromGroups(requireConn(), memberDN, groups); return true
  })
  handle('group.setPrimary', async (userDN: string, groupDN: string) => {
    await ops.setPrimaryGroup(requireConn(), userDN, groupDN); return true
  })

  /* ---------------- Seguridad (DACL) ---------------- */

  handle('security.read', async (dn: string, includeSacl: boolean): Promise<SecurityDescriptor> => {
    const c = requireConn()
    const flags = SD_FLAGS.OWNER | SD_FLAGS.GROUP | SD_FLAGS.DACL | (includeSacl ? SD_FLAGS.SACL : 0)
    const raw = await c.searchRaw(dn, {
      scope: 'base', filter: '(objectClass=*)',
      attributes: ['nTSecurityDescriptor'],
      controls: [new SDFlagsControl(flags)], pageSize: 0
    })
    const buf = raw[0] && firstBuffer(raw[0], 'nTSecurityDescriptor')
    if (!buf) throw new ConnectionError('No se pudo leer el descriptor de seguridad.')
    const sd = parseSecurityDescriptor(buf)

    // Resolvemos SIDs y GUIDs para mostrar nombres.
    const sids = new Set<string>()
    if (sd.owner) sids.add(sd.owner)
    if (sd.group) sids.add(sd.group)
    for (const a of [...sd.dacl, ...sd.sacl]) if (a.trusteeSID) sids.add(a.trusteeSID)
    const names = await resolveSids(c, [...sids])

    const guids = new Set<string>()
    for (const a of [...sd.dacl, ...sd.sacl]) {
      if (a.objectType) guids.add(a.objectType)
      if (a.inheritedObjectType) guids.add(a.inheritedObjectType)
    }
    const guidNames = await resolveSchemaGuids(c, [...guids])

    sd.ownerName = sd.owner ? names[sd.owner] : undefined
    sd.groupName = sd.group ? names[sd.group] : undefined
    for (const a of [...sd.dacl, ...sd.sacl]) {
      a.trusteeName = names[a.trusteeSID] ?? a.trusteeSID
      if (a.objectType) a.objectTypeName = guidNames[a.objectType] ?? a.objectTypeName
      if (a.inheritedObjectType) {
        a.inheritedObjectTypeName = guidNames[a.inheritedObjectType] ?? a.inheritedObjectTypeName
      }
    }
    return sd
  })

  handle('security.write', async (dn: string, sd: SecurityDescriptor, includeSacl: boolean) => {
    const c = requireConn()
    const flags = SD_FLAGS.OWNER | SD_FLAGS.GROUP | SD_FLAGS.DACL | (includeSacl ? SD_FLAGS.SACL : 0)
    const buf = buildSecurityDescriptor(sd)
    await c.modify(
      dn,
      [{ op: 'replace', attribute: 'nTSecurityDescriptor', values: [buf] }],
      false
    )
    void flags
    return true
  })

  handle('security.resolveSids', async (sids: string[]) => resolveSids(requireConn(), sids))
  handle('security.resolveGuids', async (guids: string[]) => resolveSchemaGuids(requireConn(), guids))

  /** Clases y derechos disponibles para el asistente de Delegar control. */
  handle('security.schemaObjects', async () => {
    const c = requireConn()
    const [classes, rights] = await Promise.all([
      c.searchRaw(c.schemaDN, {
        scope: 'one',
        filter: '(&(objectClass=classSchema)(!(isDefunct=TRUE)))',
        attributes: ['lDAPDisplayName', 'schemaIDGUID', 'adminDisplayName', 'objectClassCategory']
      }),
      c.searchRaw(`CN=Extended-Rights,${c.configDN}`, {
        scope: 'one',
        filter: '(objectClass=controlAccessRight)',
        attributes: ['displayName', 'rightsGuid', 'validAccesses', 'appliesTo', 'cn']
      }).catch(() => [])
    ])
    const { guidToString } = await import('./ldap/encoding')
    return {
      classes: classes.map((e) => {
        const g = firstBuffer(e, 'schemaIDGUID')
        return {
          name: firstString(e, 'lDAPDisplayName') ?? '',
          display: firstString(e, 'adminDisplayName') ?? firstString(e, 'lDAPDisplayName') ?? '',
          guid: g && g.length === 16 ? guidToString(g) : '',
          category: firstNumber(e, 'objectClassCategory') ?? 0
        }
      }).filter((x) => x.guid),
      rights: rights.map((e) => ({
        name: firstString(e, 'displayName') ?? firstString(e, 'cn') ?? '',
        guid: (firstString(e, 'rightsGuid') ?? '').toLowerCase(),
        validAccesses: firstNumber(e, 'validAccesses') ?? 0,
        appliesTo: allStrings(e, 'appliesTo')
      })).filter((x) => x.guid)
    }
  })

  /* ---------------- Perfiles / preferencias / consultas ---------------- */

  handle('store.profiles', () => store.getProfiles())
  handle('store.saveProfile', (p: ConnectionProfile) => store.saveProfile(p))
  handle('store.deleteProfile', (id: string) => store.deleteProfile(id))
  handle('store.secret', (id: string) => store.getSecret(id))
  handle('store.encryptionAvailable', () => store.encryptionAvailable())
  handle('store.queries', () => store.getQueries())
  handle('store.saveQuery', (q: SavedQuery) => store.saveQuery(q))
  handle('store.deleteQuery', (id: string) => store.deleteQuery(id))
  handle('store.prefs', () => store.getPrefs())
  handle('store.setPrefs', (p: Partial<Preferences>) => store.setPrefs(p))
  handle('store.newId', () => randomUUID())

  /* ---------------- Utilidades del sistema ---------------- */

  handle('app.copy', (text: string) => { clipboard.writeText(text); return true })

  handle('app.exportCsv', async (rows: string[][], suggestedName: string) => {
    const win = BrowserWindow.getFocusedWindow()
    const res = await dialog.showSaveDialog(win!, {
      title: 'Exportar lista',
      defaultPath: suggestedName,
      filters: [{ name: 'CSV', extensions: ['csv'] }]
    })
    if (res.canceled || !res.filePath) return null
    const csv = rows
      .map((r) => r.map((c) => `"${String(c ?? '').replace(/"/g, '""')}"`).join(','))
      .join('\r\n')
    await fs.writeFile(res.filePath, '﻿' + csv, 'utf8')
    return res.filePath
  })

  handle('app.exportLdif', async (entries: { dn: string; attrs: Record<string, string[]> }[], suggestedName: string) => {
    const win = BrowserWindow.getFocusedWindow()
    const res = await dialog.showSaveDialog(win!, {
      title: 'Exportar LDIF',
      defaultPath: suggestedName,
      filters: [{ name: 'LDIF', extensions: ['ldif'] }]
    })
    if (res.canceled || !res.filePath) return null
    const lines: string[] = []
    for (const e of entries) {
      lines.push(`dn: ${e.dn}`)
      for (const [k, vals] of Object.entries(e.attrs)) {
        for (const v of vals) lines.push(`${k}: ${v}`)
      }
      lines.push('')
    }
    await fs.writeFile(res.filePath, lines.join('\n'), 'utf8')
    return res.filePath
  })

  handle('app.openExternal', async (url: string) => { await shell.openExternal(url); return true })

  handle('app.confirm', async (title: string, message: string, detail?: string) => {
    const win = BrowserWindow.getFocusedWindow()
    const res = await dialog.showMessageBox(win!, {
      type: 'warning',
      buttons: ['Cancelar', 'Aceptar'],
      defaultId: 1,
      cancelId: 0,
      title,
      message,
      detail
    })
    return res.response === 1
  })

  /* ---------------- Helpers de presentación ---------------- */

  handle('util.dnLabel', (dn: string) => dnLabel(dn))
  handle('util.splitDN', (dn: string) => splitDN(dn))
  handle('util.rdnValue', (dn: string) => rdnValue(dn))
  handle('util.filetime', (v: string) => filetimeToDate(v)?.toISOString() ?? null)

  registerConsoleIpc(handle, requireConn)
}

export function currentConnection(): AdConnection | null {
  return conn
}
