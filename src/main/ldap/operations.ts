/** Acciones de alto nivel: las mismas del menú contextual de ADUC. */
import type { AdConnection } from './connection'
import { ConnectionError } from './connection'
import { firstBuffer, firstNumber, firstString, allStrings, toDirEntry, LIST_ATTRS } from './directory'
import {
  dateToFiletime, encodePassword, escapeFilter, escapeRDN, parentDN, rdnType,
  rdnValue, sidToString, splitDN, parseRDN, dnToDomain
} from './encoding'
import { UAC, buildGroupType, setFlag } from '../../shared/uac'
import { WELL_KNOWN_CONTAINERS } from './wellknown'
import type {
  CreateComputerInput, CreateContactInput, CreateGroupInput, CreateOUInput,
  CreateUserInput, DirEntry, FsmoRoles, GroupMembership, PasswordPolicy
} from '../../shared/types'
import { intervalToDays, intervalToMinutes } from './encoding'

/** Escrituras de contraseña requieren canal cifrado (LDAPS o StartTLS). */
function requireSecureChannel(conn: AdConnection): void {
  if (conn.profile.security === 'plain') {
    throw new ConnectionError(
      'Active Directory sólo permite establecer contraseñas sobre un canal cifrado. Conectate con LDAPS (636) o StartTLS.'
    )
  }
}

export async function createUser(conn: AdConnection, input: CreateUserInput): Promise<string> {
  const dn = `CN=${escapeRDN(input.cn)},${input.parentDN}`
  const attrs: Record<string, (string | Buffer)[]> = {
    objectClass: ['top', 'person', 'organizationalPerson', 'user'],
    cn: [input.cn],
    sAMAccountName: [input.sAMAccountName]
  }
  if (input.givenName) attrs.givenName = [input.givenName]
  if (input.sn) attrs.sn = [input.sn]
  if (input.initials) attrs.initials = [input.initials]
  if (input.displayName) attrs.displayName = [input.displayName]
  if (input.userPrincipalName) attrs.userPrincipalName = [input.userPrincipalName]
  if (input.description) attrs.description = [input.description]
  // Se crea deshabilitada y luego se aplica contraseña y flags, igual que ADUC.
  attrs.userAccountControl = [String(UAC.NORMAL_ACCOUNT | UAC.ACCOUNTDISABLE)]

  await conn.add(dn, attrs)

  try {
    if (input.password) {
      requireSecureChannel(conn)
      await conn.modify(dn, [
        { op: 'replace', attribute: 'unicodePwd', values: [encodePassword(input.password)] }
      ])
    }

    let uac: number = UAC.NORMAL_ACCOUNT
    if (input.accountDisabled) uac = setFlag(uac, UAC.ACCOUNTDISABLE, true)
    if (input.passwordNeverExpires) uac = setFlag(uac, UAC.DONT_EXPIRE_PASSWORD, true)
    if (input.cannotChangePassword) uac = setFlag(uac, UAC.PASSWD_CANT_CHANGE, true)
    await conn.modify(dn, [{ op: 'replace', attribute: 'userAccountControl', values: [String(uac)] }])

    if (input.mustChangePassword) {
      await conn.modify(dn, [{ op: 'replace', attribute: 'pwdLastSet', values: ['0'] }])
    } else if (input.password) {
      await conn.modify(dn, [{ op: 'replace', attribute: 'pwdLastSet', values: ['-1'] }])
    }

    if (input.cannotChangePassword) {
      await setCannotChangePassword(conn, dn, true)
    }
  } catch (err) {
    // Rollback: el usuario a medio crear es peor que ninguno.
    await conn.delete(dn).catch(() => undefined)
    throw err
  }

  return dn
}

export async function createGroup(conn: AdConnection, input: CreateGroupInput): Promise<string> {
  const dn = `CN=${escapeRDN(input.name)},${input.parentDN}`
  await conn.add(dn, {
    objectClass: ['top', 'group'],
    cn: [input.name],
    sAMAccountName: [input.sAMAccountName],
    groupType: [String(buildGroupType(input.scope, input.security))],
    ...(input.description ? { description: [input.description] } : {})
  })
  return dn
}

export async function createOU(conn: AdConnection, input: CreateOUInput): Promise<string> {
  const dn = `OU=${escapeRDN(input.name)},${input.parentDN}`
  await conn.add(dn, {
    objectClass: ['top', 'organizationalUnit'],
    ou: [input.name],
    ...(input.description ? { description: [input.description] } : {})
  })
  if (input.protectFromDeletion) {
    await setProtectFromDeletion(conn, dn, true).catch(() => undefined)
  }
  return dn
}

export async function createComputer(conn: AdConnection, input: CreateComputerInput): Promise<string> {
  const dn = `CN=${escapeRDN(input.name)},${input.parentDN}`
  const sam = input.sAMAccountName.endsWith('$') ? input.sAMAccountName : `${input.sAMAccountName}$`
  const attrs: Record<string, (string | Buffer)[]> = {
    objectClass: ['top', 'person', 'organizationalPerson', 'user', 'computer'],
    cn: [input.name],
    sAMAccountName: [sam],
    userAccountControl: [String(UAC.WORKSTATION_TRUST_ACCOUNT)]
  }
  if (input.description) attrs.description = [input.description]
  if (input.managedBy) attrs.managedBy = [input.managedBy]
  if (input.isPreWindows2000) {
    // Contraseña inicial = nombre del equipo en minúsculas.
    requireSecureChannel(conn)
  }
  await conn.add(dn, attrs)
  if (input.isPreWindows2000) {
    await conn.modify(dn, [
      { op: 'replace', attribute: 'unicodePwd', values: [encodePassword(input.name.toLowerCase())] }
    ]).catch(() => undefined)
  }
  return dn
}

export async function createContact(conn: AdConnection, input: CreateContactInput): Promise<string> {
  const dn = `CN=${escapeRDN(input.cn)},${input.parentDN}`
  const attrs: Record<string, (string | Buffer)[]> = {
    objectClass: ['top', 'person', 'organizationalPerson', 'contact'],
    cn: [input.cn]
  }
  if (input.givenName) attrs.givenName = [input.givenName]
  if (input.sn) attrs.sn = [input.sn]
  if (input.initials) attrs.initials = [input.initials]
  if (input.displayName) attrs.displayName = [input.displayName]
  await conn.add(dn, attrs)
  return dn
}

export async function resetPassword(
  conn: AdConnection,
  dn: string,
  password: string,
  mustChange: boolean,
  unlock: boolean
): Promise<void> {
  requireSecureChannel(conn)
  await conn.modify(dn, [
    { op: 'replace', attribute: 'unicodePwd', values: [encodePassword(password)] }
  ])
  await conn.modify(dn, [
    { op: 'replace', attribute: 'pwdLastSet', values: [mustChange ? '0' : '-1'] }
  ])
  if (unlock) {
    await conn.modify(dn, [{ op: 'replace', attribute: 'lockoutTime', values: ['0'] }]).catch(() => undefined)
  }
}

/** Cambio de contraseña por el propio usuario: delete del viejo + add del nuevo. */
export async function changePassword(
  conn: AdConnection,
  dn: string,
  oldPassword: string,
  newPassword: string
): Promise<void> {
  requireSecureChannel(conn)
  await conn.modify(dn, [
    { op: 'delete', attribute: 'unicodePwd', values: [encodePassword(oldPassword)] },
    { op: 'add', attribute: 'unicodePwd', values: [encodePassword(newPassword)] }
  ], false)
}

export async function setAccountEnabled(conn: AdConnection, dn: string, enabled: boolean): Promise<void> {
  const e = await conn.searchOne(dn, ['userAccountControl'])
  const uac = e ? firstNumber(e, 'userAccountControl') ?? 0 : 0
  const next = setFlag(uac, UAC.ACCOUNTDISABLE, !enabled)
  await conn.modify(dn, [{ op: 'replace', attribute: 'userAccountControl', values: [String(next)] }])
}

export async function unlockAccount(conn: AdConnection, dn: string): Promise<void> {
  await conn.modify(dn, [{ op: 'replace', attribute: 'lockoutTime', values: ['0'] }])
}

export async function setUAC(conn: AdConnection, dn: string, uac: number): Promise<void> {
  await conn.modify(dn, [{ op: 'replace', attribute: 'userAccountControl', values: [String(uac)] }])
}

export async function setAccountExpires(conn: AdConnection, dn: string, date: Date | null): Promise<void> {
  const value = date ? dateToFiletime(date) : '0'
  await conn.modify(dn, [{ op: 'replace', attribute: 'accountExpires', values: [value] }])
}

export async function moveObject(conn: AdConnection, dn: string, newParentDN: string): Promise<string> {
  const rdn = splitDN(dn)[0]
  const newDN = `${rdn},${newParentDN}`
  if (newDN.toLowerCase() === dn.toLowerCase()) return dn
  await conn.modifyDN(dn, newDN)
  return newDN
}

export async function renameObject(conn: AdConnection, dn: string, newName: string): Promise<string> {
  const type = rdnType(dn) || 'CN'
  const newDN = `${type}=${escapeRDN(newName)},${parentDN(dn)}`
  await conn.modifyDN(dn, newDN)
  return newDN
}

/**
 * Renombrar un usuario en ADUC actualiza también name/displayName/sAM/UPN.
 * Devuelve el DN resultante.
 */
export async function renameUser(
  conn: AdConnection,
  dn: string,
  fields: {
    cn: string
    givenName?: string
    initials?: string
    sn?: string
    displayName?: string
    sAMAccountName?: string
    userPrincipalName?: string
  }
): Promise<string> {
  const mods: { op: 'replace' | 'delete'; attribute: string; values: string[] }[] = []
  const put = (attribute: string, value?: string) => {
    if (value === undefined) return
    mods.push(value === '' ? { op: 'delete', attribute, values: [] } : { op: 'replace', attribute, values: [value] })
  }
  put('givenName', fields.givenName)
  put('initials', fields.initials)
  put('sn', fields.sn)
  put('displayName', fields.displayName)
  put('sAMAccountName', fields.sAMAccountName)
  put('userPrincipalName', fields.userPrincipalName)
  if (mods.length) await conn.modify(dn, mods)

  if (fields.cn && fields.cn !== rdnValue(dn)) {
    return renameObject(conn, dn, fields.cn)
  }
  return dn
}

export async function deleteObject(conn: AdConnection, dn: string, tree: boolean): Promise<void> {
  await conn.delete(dn, tree)
}

/** ¿Tiene hijos? Se usa para avisar antes de borrar un contenedor. */
export async function hasChildren(conn: AdConnection, dn: string): Promise<number> {
  const children = await conn.searchRaw(dn, {
    scope: 'one',
    filter: '(objectClass=*)',
    attributes: ['1.1'],
    sizeLimit: 501
  })
  return children.length
}

export async function addToGroups(conn: AdConnection, memberDN: string, groupDNs: string[]): Promise<void> {
  for (const g of groupDNs) {
    await conn.modify(g, [{ op: 'add', attribute: 'member', values: [memberDN] }])
  }
}

export async function removeFromGroups(conn: AdConnection, memberDN: string, groupDNs: string[]): Promise<void> {
  for (const g of groupDNs) {
    await conn.modify(g, [{ op: 'delete', attribute: 'member', values: [memberDN] }])
  }
}

export async function addMembers(conn: AdConnection, groupDN: string, memberDNs: string[]): Promise<void> {
  if (!memberDNs.length) return
  await conn.modify(groupDN, [{ op: 'add', attribute: 'member', values: memberDNs }])
}

export async function removeMembers(conn: AdConnection, groupDN: string, memberDNs: string[]): Promise<void> {
  if (!memberDNs.length) return
  await conn.modify(groupDN, [{ op: 'delete', attribute: 'member', values: memberDNs }])
}

/** memberOf + grupo primario, como la pestaña "Miembro de". */
export async function getMemberOf(conn: AdConnection, dn: string): Promise<GroupMembership[]> {
  const e = await conn.searchOne(dn, ['memberOf', 'primaryGroupID', 'objectSid'])
  if (!e) return []
  const out: GroupMembership[] = []

  const groups = allStrings(e, 'memberOf')
  if (groups.length) {
    const found = await conn.searchRaw(conn.baseDN, {
      scope: 'sub',
      filter: `(|${groups.map((g) => `(distinguishedName=${escapeFilter(g)})`).join('')})`,
      attributes: ['name', 'cn', 'objectClass', 'objectGUID', 'description', 'groupType']
    })
    const byDN = new Map(found.map((f) => [f.dn.toLowerCase(), f]))
    for (const g of groups) {
      const f = byDN.get(g.toLowerCase())
      out.push({ dn: g, name: f ? firstString(f, 'name') ?? rdnValue(g) : rdnValue(g), kind: 'group' })
    }
  }

  // Grupo primario: SID del dominio + primaryGroupID.
  const pgid = firstNumber(e, 'primaryGroupID')
  if (pgid && conn.domainSID) {
    const sid = `${conn.domainSID}-${pgid}`
    const { sidFilter } = await import('./filters')
    try {
      const g = await conn.searchRaw(conn.baseDN, {
        scope: 'sub',
        filter: sidFilter(sid),
        attributes: ['name', 'objectClass']
      })
      if (g[0]) {
        out.unshift({ dn: g[0].dn, name: firstString(g[0], 'name') ?? sid, kind: 'group', primary: true })
      }
    } catch { /* SID no resoluble */ }
  }

  return out.sort((a, b) => Number(!!b.primary) - Number(!!a.primary) || a.name.localeCompare(b.name, 'es'))
}

/** Miembros directos de un grupo, resolviendo el rango si son más de 1500. */
export async function getMembers(conn: AdConnection, groupDN: string): Promise<DirEntry[]> {
  const dns: string[] = []
  let start = 0
  // AD devuelve member;range=0-1499 cuando el grupo es grande.
  for (;;) {
    const attr = start === 0 ? 'member' : `member;range=${start}-*`
    const e = await conn.searchOne(groupDN, [attr])
    if (!e) break
    const rangeKey = Object.keys(e.attrs).find((k) => k.toLowerCase().startsWith('member;range='))
    const key = rangeKey ?? Object.keys(e.attrs).find((k) => k.toLowerCase() === 'member')
    if (!key) break
    const values = e.attrs[key].map(String)
    dns.push(...values)
    if (!rangeKey || rangeKey.endsWith('-*')) break
    const end = Number(rangeKey.split('-')[1])
    if (!Number.isFinite(end)) break
    start = end + 1
  }

  if (!dns.length) return []

  const out: DirEntry[] = []
  const CHUNK = 60
  for (let i = 0; i < dns.length; i += CHUNK) {
    const chunk = dns.slice(i, i + CHUNK)
    const found = await conn.searchRaw(conn.baseDN, {
      scope: 'sub',
      filter: `(|${chunk.map((d) => `(distinguishedName=${escapeFilter(d)})`).join('')})`,
      attributes: LIST_ATTRS
    })
    out.push(...found.map((f) => toDirEntry(f)))
    // Los que no aparecen (otro dominio / SID foráneo) se muestran igual.
    const seen = new Set(found.map((f) => f.dn.toLowerCase()))
    for (const d of chunk) {
      if (!seen.has(d.toLowerCase())) {
        out.push({
          dn: d, name: rdnValue(d), kind: 'foreignSecurityPrincipal',
          objectClass: [], isContainer: false
        })
      }
    }
  }
  return out.sort((a, b) => a.name.localeCompare(b.name, 'es'))
}

/** Pertenencia recursiva usando la regla LDAP_MATCHING_RULE_IN_CHAIN. */
export async function getMemberOfRecursive(conn: AdConnection, dn: string): Promise<DirEntry[]> {
  const found = await conn.searchRaw(conn.baseDN, {
    scope: 'sub',
    filter: `(&(objectClass=group)(member:1.2.840.113556.1.4.1941:=${escapeFilter(dn)}))`,
    attributes: LIST_ATTRS
  })
  return found.map((f) => toDirEntry(f)).sort((a, b) => a.name.localeCompare(b.name, 'es'))
}

export async function setPrimaryGroup(conn: AdConnection, userDN: string, groupDN: string): Promise<void> {
  const g = await conn.searchOne(groupDN, ['objectSid'])
  const buf = g && firstBuffer(g, 'objectSid')
  if (!buf) throw new ConnectionError('No se pudo leer el SID del grupo.')
  const sid = sidToString(buf)
  const rid = sid.slice(sid.lastIndexOf('-') + 1)
  await conn.modify(userDN, [{ op: 'replace', attribute: 'primaryGroupID', values: [rid] }])
}

/**
 * "El usuario no puede cambiar la contraseña": son dos ACE de denegación
 * del derecho extendido Change-Password para SELF y Everyone.
 */
const CHANGE_PASSWORD_GUID = 'ab721a53-1e2f-11d0-9819-00aa0040529b'
const SID_SELF = 'S-1-5-10'
const SID_EVERYONE = 'S-1-1-0'

export async function setCannotChangePassword(
  conn: AdConnection,
  dn: string,
  cannot: boolean
): Promise<void> {
  const { SDFlagsControl } = await import('./controls')
  const { parseSecurityDescriptor, buildSecurityDescriptor, ACE_FLAGS } = await import('./sddl')
  const { ACCESS_MASK } = await import('./wellknown')

  const e = await conn.searchRaw(dn, {
    scope: 'base',
    filter: '(objectClass=*)',
    attributes: ['nTSecurityDescriptor'],
    controls: [new SDFlagsControl(0x04)],
    pageSize: 0
  })
  const buf = e[0] && firstBuffer(e[0], 'nTSecurityDescriptor')
  if (!buf) throw new ConnectionError('No se pudo leer el descriptor de seguridad del objeto.')

  const sd = parseSecurityDescriptor(buf)
  const isTarget = (a: (typeof sd.dacl)[number]) =>
    a.objectType?.toLowerCase() === CHANGE_PASSWORD_GUID &&
    (a.trusteeSID === SID_SELF || a.trusteeSID === SID_EVERYONE)

  sd.dacl = sd.dacl.filter((a) => !(isTarget(a) && !a.inherited))

  if (cannot) {
    for (const trustee of [SID_SELF, SID_EVERYONE]) {
      sd.dacl.unshift({
        type: 'deny-object',
        trusteeSID: trustee,
        mask: ACCESS_MASK.CONTROL_ACCESS,
        rights: ['CONTROL_ACCESS'],
        inherited: false,
        inheritOnly: false,
        containerInherit: false,
        objectInherit: false,
        objectType: CHANGE_PASSWORD_GUID,
        flags: 0
      })
    }
  } else {
    for (const trustee of [SID_SELF, SID_EVERYONE]) {
      sd.dacl.push({
        type: 'allow-object',
        trusteeSID: trustee,
        mask: ACCESS_MASK.CONTROL_ACCESS,
        rights: ['CONTROL_ACCESS'],
        inherited: false,
        inheritOnly: false,
        containerInherit: false,
        objectInherit: false,
        objectType: CHANGE_PASSWORD_GUID,
        flags: 0
      })
    }
  }
  void ACE_FLAGS

  await conn.modify(
    dn,
    [{ op: 'replace', attribute: 'nTSecurityDescriptor', values: [buildSecurityDescriptor(sd)] }],
    false
  )
}

export async function getCannotChangePassword(conn: AdConnection, dn: string): Promise<boolean> {
  const { SDFlagsControl } = await import('./controls')
  const { parseSecurityDescriptor } = await import('./sddl')
  const e = await conn.searchRaw(dn, {
    scope: 'base', filter: '(objectClass=*)',
    attributes: ['nTSecurityDescriptor'],
    controls: [new SDFlagsControl(0x04)], pageSize: 0
  })
  const buf = e[0] && firstBuffer(e[0], 'nTSecurityDescriptor')
  if (!buf) return false
  const sd = parseSecurityDescriptor(buf)
  return sd.dacl.some(
    (a) =>
      a.type === 'deny-object' &&
      a.objectType?.toLowerCase() === CHANGE_PASSWORD_GUID &&
      (a.trusteeSID === SID_SELF || a.trusteeSID === SID_EVERYONE)
  )
}

/** "Proteger objeto contra eliminación accidental": deny Delete + DeleteTree a Everyone. */
export async function setProtectFromDeletion(
  conn: AdConnection,
  dn: string,
  protect: boolean
): Promise<void> {
  const { SDFlagsControl } = await import('./controls')
  const { parseSecurityDescriptor, buildSecurityDescriptor } = await import('./sddl')
  const { ACCESS_MASK } = await import('./wellknown')

  const e = await conn.searchRaw(dn, {
    scope: 'base', filter: '(objectClass=*)',
    attributes: ['nTSecurityDescriptor'],
    controls: [new SDFlagsControl(0x04)], pageSize: 0
  })
  const buf = e[0] && firstBuffer(e[0], 'nTSecurityDescriptor')
  if (!buf) throw new ConnectionError('No se pudo leer el descriptor de seguridad del objeto.')

  const sd = parseSecurityDescriptor(buf)
  const mask = ACCESS_MASK.DELETE | ACCESS_MASK.DELETE_TREE
  sd.dacl = sd.dacl.filter(
    (a) => !(a.type === 'deny' && a.trusteeSID === SID_EVERYONE && (a.mask & mask) !== 0 && !a.inherited)
  )
  if (protect) {
    sd.dacl.unshift({
      type: 'deny', trusteeSID: SID_EVERYONE, mask,
      rights: ['DELETE', 'DELETE_TREE'],
      inherited: false, inheritOnly: false, containerInherit: false, objectInherit: false,
      flags: 0
    })
  }

  await conn.modify(
    dn,
    [{ op: 'replace', attribute: 'nTSecurityDescriptor', values: [buildSecurityDescriptor(sd)] }],
    false
  )

  // El padre también deniega Delete Child para que no se borre desde arriba.
  const parent = parentDN(dn)
  if (parent && protect) {
    try {
      const pe = await conn.searchRaw(parent, {
        scope: 'base', filter: '(objectClass=*)',
        attributes: ['nTSecurityDescriptor'],
        controls: [new SDFlagsControl(0x04)], pageSize: 0
      })
      const pbuf = pe[0] && firstBuffer(pe[0], 'nTSecurityDescriptor')
      if (pbuf) {
        const psd = parseSecurityDescriptor(pbuf)
        const already = psd.dacl.some(
          (a) => a.type === 'deny' && a.trusteeSID === SID_EVERYONE &&
                 (a.mask & ACCESS_MASK.DELETE_CHILD) !== 0
        )
        if (!already) {
          psd.dacl.unshift({
            type: 'deny', trusteeSID: SID_EVERYONE, mask: ACCESS_MASK.DELETE_CHILD,
            rights: ['DELETE_CHILD'], inherited: false, inheritOnly: false,
            containerInherit: false, objectInherit: false, flags: 0
          })
          await conn.modify(
            parent,
            [{ op: 'replace', attribute: 'nTSecurityDescriptor', values: [buildSecurityDescriptor(psd)] }],
            false
          )
        }
      }
    } catch { /* sin permiso sobre el padre: al menos el objeto queda protegido */ }
  }
}

export async function getProtectFromDeletion(conn: AdConnection, dn: string): Promise<boolean> {
  const { SDFlagsControl } = await import('./controls')
  const { parseSecurityDescriptor } = await import('./sddl')
  const { ACCESS_MASK } = await import('./wellknown')
  const e = await conn.searchRaw(dn, {
    scope: 'base', filter: '(objectClass=*)',
    attributes: ['nTSecurityDescriptor'],
    controls: [new SDFlagsControl(0x04)], pageSize: 0
  })
  const buf = e[0] && firstBuffer(e[0], 'nTSecurityDescriptor')
  if (!buf) return false
  const sd = parseSecurityDescriptor(buf)
  return sd.dacl.some(
    (a) => a.type === 'deny' && a.trusteeSID === SID_EVERYONE &&
           (a.mask & (ACCESS_MASK.DELETE | ACCESS_MASK.DELETE_TREE)) !== 0
  )
}

/** Titulares de roles FSMO (Maestros de operaciones). */
export async function getFsmoRoles(conn: AdConnection): Promise<FsmoRoles> {
  const roles: FsmoRoles = {}
  const read = async (dn: string): Promise<string | undefined> => {
    try {
      const e = await conn.searchOne(dn, ['fSMORoleOwner'])
      const owner = e && firstString(e, 'fSMORoleOwner')
      if (!owner) return undefined
      // El owner es el DN del objeto NTDS Settings; el servidor está 2 niveles arriba.
      const serverDN = splitDN(owner).slice(1).join(',')
      const s = await conn.searchOne(serverDN, ['dNSHostName', 'cn'])
      return s ? firstString(s, 'dNSHostName') ?? firstString(s, 'cn') ?? owner : owner
    } catch { return undefined }
  }
  const [schema, naming, pdc, rid, infra] = await Promise.all([
    read(conn.schemaDN),
    read(`CN=Partitions,${conn.configDN}`),
    read(conn.baseDN),
    read(`CN=RID Manager$,CN=System,${conn.baseDN}`),
    read(`CN=Infrastructure,${conn.baseDN}`)
  ])
  roles.schemaMaster = schema
  roles.domainNamingMaster = naming
  roles.pdcEmulator = pdc
  roles.ridMaster = rid
  roles.infrastructureMaster = infra
  return roles
}

export async function getDomainControllers(conn: AdConnection): Promise<
  { name: string; dnsHostName: string; site: string; os: string; osVersion: string; isGC: boolean; dn: string }[]
> {
  const dcs = await conn.searchRaw(conn.baseDN, {
    scope: 'sub',
    filter: '(&(objectCategory=computer)(userAccountControl:1.2.840.113556.1.4.803:=8192))',
    attributes: ['name', 'dNSHostName', 'operatingSystem', 'operatingSystemVersion', 'serverReferenceBL']
  })
  const sites = new Map<string, string>()
  try {
    const servers = await conn.searchRaw(`CN=Sites,${conn.configDN}`, {
      scope: 'sub',
      filter: '(objectClass=server)',
      attributes: ['dNSHostName', 'cn', 'distinguishedName']
    })
    for (const s of servers) {
      const host = (firstString(s, 'dNSHostName') ?? firstString(s, 'cn') ?? '').toLowerCase()
      const parts = splitDN(s.dn).map(parseRDN)
      const siteIdx = parts.findIndex((p) => p.type.toLowerCase() === 'cn' && parts[parts.indexOf(p) + 1]?.value === 'Sites')
      if (host) sites.set(host, siteIdx >= 0 ? parts[siteIdx].value : parts[2]?.value ?? '')
    }
  } catch { /* Configuration inaccesible */ }

  return dcs.map((e) => {
    const host = (firstString(e, 'dNSHostName') ?? '').toLowerCase()
    return {
      name: firstString(e, 'name') ?? rdnValue(e.dn),
      dnsHostName: firstString(e, 'dNSHostName') ?? '',
      site: sites.get(host) ?? '',
      os: firstString(e, 'operatingSystem') ?? '',
      osVersion: firstString(e, 'operatingSystemVersion') ?? '',
      isGC: false,
      dn: e.dn
    }
  }).sort((a, b) => a.name.localeCompare(b.name))
}

/** Política de contraseñas del dominio (la de la raíz, no las PSO). */
export async function getPasswordPolicy(conn: AdConnection): Promise<PasswordPolicy> {
  const e = await conn.searchOne(conn.baseDN, [
    'minPwdLength', 'pwdHistoryLength', 'maxPwdAge', 'minPwdAge',
    'lockoutThreshold', 'lockoutDuration', 'lockOutObservationWindow', 'pwdProperties'
  ])
  const num = (a: string) => (e ? firstNumber(e, a) ?? 0 : 0)
  const str = (a: string) => (e ? firstString(e, a) ?? '0' : '0')
  const props = num('pwdProperties')
  return {
    minPwdLength: num('minPwdLength'),
    pwdHistoryLength: num('pwdHistoryLength'),
    maxPwdAgeDays: intervalToDays(str('maxPwdAge')),
    minPwdAgeDays: intervalToDays(str('minPwdAge')),
    lockoutThreshold: num('lockoutThreshold'),
    lockoutDurationMin: intervalToMinutes(str('lockoutDuration')),
    lockoutObservationMin: intervalToMinutes(str('lockOutObservationWindow')),
    complexityEnabled: (props & 1) !== 0,
    reversibleEncryption: (props & 16) !== 0
  }
}

/** Sugerencia de sAMAccountName/UPN a partir del nombre, como hace el asistente. */
export function suggestLogon(first: string, last: string): string {
  const norm = (s: string) =>
    s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9]/g, '').toLowerCase()
  const f = norm(first)
  const l = norm(last)
  if (f && l) return `${f[0]}${l}`.slice(0, 20)
  return (f || l).slice(0, 20)
}

export function domainOf(conn: AdConnection): string {
  return dnToDomain(conn.baseDN)
}

/** Contenedores por defecto (wellKnownObjects del dominio). */
export async function getWellKnownContainers(conn: AdConnection): Promise<Record<string, string>> {
  const e = await conn.searchOne(conn.baseDN, ['wellKnownObjects', 'otherWellKnownObjects'])
  const out: Record<string, string> = {}
  if (!e) return out
  const values = [...(e.attrs.wellKnownObjects ?? []), ...(e.attrs.otherWellKnownObjects ?? [])]
  for (const v of values) {
    const s = Buffer.isBuffer(v) ? v.toString('utf8') : String(v)
    // Formato: B:32:<guid hex>:<DN>
    const m = /^B:32:([0-9a-fA-F]{32}):(.*)$/.exec(s)
    if (!m) continue
    const guid = m[1].toLowerCase()
    // La UI quiere nombres ("Users", "Computers"), no el GUID del wellKnownObject.
    out[WELL_KNOWN_CONTAINERS[guid] ?? guid] = m[2]
  }
  return out
}

export { escapeFilter }
