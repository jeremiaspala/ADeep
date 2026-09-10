/** Traducción entre entradas LDAP crudas y el modelo que consume la UI. */
import type { AdConnection, RawEntry } from './connection'
import { isBinaryAttribute } from './connection'
import type { AttributeValue, DirEntry, NodeKind } from '../../shared/types'
import {
  escapeFilter, filetimeToDate, generalizedTimeToDate, guidToString,
  intervalToDays, rdnValue, sidToString, sidToFilter, splitDN, parseRDN
} from './encoding'
import { UAC, UAC_COMPUTED, SAM_ACCOUNT_TYPE, INSTANCE_TYPE, groupScopeOf, isSecurityGroup } from '../../shared/uac'
import { resolveWellKnownSid, EXTENDED_RIGHTS } from './wellknown'

/** Clases que el árbol muestra como contenedores expandibles. */
const CONTAINER_CLASSES = new Set([
  'organizationalunit', 'container', 'builtindomain', 'domaindns', 'lostandfound',
  'msds-quotacontainer', 'msexchsystemobjectscontainer', 'configuration', 'dmd',
  'rpccontainer', 'ntfrssettings', 'nttdsquota', 'msieee80211-policy',
  'msds-passwordsettingscontainer', 'msimaging-psps', 'msdfsr-globalsettings',
  'msdfsr-replicationgroup', 'msdfsr-content', 'msdfsr-topology', 'organization',
  'organizationalperson-container', 'domain', 'msds-shadowprincipalcontainer',
  'msds-devicecontainer', 'msds-groupmanagedserviceaccount-container',
  'msdfs-namespacev2', 'msdfs-linkv2', 'msprint-connectionpolicy', 'serversContainer',
  'site', 'sitescontainer', 'serverscontainer', 'server', 'nTDSDSA', 'ntdssiteSettings',
  'crossrefcontainer', 'subnetcontainer', 'ipsecpolicy', 'wmigpo', 'grouppolicycontainer',
  'msmq-configuration', 'msmq-migrateduser', 'fileLinkTracking', 'linktrackobjectmovetable',
  'linktrackvolumetable', 'msds-claimscontainer', 'msds-claimtypes', 'msds-resourceproperties',
  'msds-resourcepropertylists', 'msds-valuetype', 'msauthz-centralaccesspolicies',
  'msauthz-centralaccessrules', 'msds-optionalfeature', 'ridmanager', 'infrastructureupdate',
  'msds-authnpolicies', 'msds-authnpolicysilos', 'msds-authnpolicysilo', 'secret',
  'msds-keycredential', 'pkicertificatetemplate-container', 'certificationauthority-container'
])

/** Atributos mínimos para pintar el árbol y la lista. */
export const LIST_ATTRS = [
  'objectClass', 'objectGUID', 'objectSid', 'name', 'cn', 'ou', 'description',
  'distinguishedName', 'userAccountControl', 'sAMAccountName', 'sAMAccountType',
  'displayName', 'showInAdvancedViewOnly', 'systemFlags', 'groupType', 'lockoutTime',
  'accountExpires', 'whenCreated', 'whenChanged', 'primaryGroupID', 'operatingSystem',
  'operatingSystemVersion', 'mail', 'telephoneNumber', 'title', 'department', 'company',
  'manager', 'lastLogonTimestamp', 'pwdLastSet', 'userPrincipalName', 'dNSHostName',
  'msDS-User-Account-Control-Computed', 'isDeleted', 'isCriticalSystemObject',
  'managedBy', 'location', 'info', 'physicalDeliveryOfficeName', 'streetAddress',
  'l', 'st', 'postalCode', 'co', 'mobile', 'homePhone', 'employeeID', 'employeeNumber'
]

export function firstString(e: RawEntry, attr: string): string | undefined {
  const v = e.attrs[attr] ?? e.attrs[findKey(e, attr) ?? '']
  if (!v || !v.length) return undefined
  const x = v[0]
  return Buffer.isBuffer(x) ? x.toString('utf8') : String(x)
}

export function allStrings(e: RawEntry, attr: string): string[] {
  const key = e.attrs[attr] ? attr : findKey(e, attr)
  if (!key) return []
  return (e.attrs[key] ?? []).map((v) => (Buffer.isBuffer(v) ? v.toString('utf8') : String(v)))
}

export function firstBuffer(e: RawEntry, attr: string): Buffer | undefined {
  const key = e.attrs[attr] ? attr : findKey(e, attr)
  if (!key) return undefined
  const v = e.attrs[key]?.[0]
  if (v === undefined) return undefined
  return Buffer.isBuffer(v) ? v : Buffer.from(String(v), 'utf8')
}

export function firstNumber(e: RawEntry, attr: string): number | undefined {
  const s = firstString(e, attr)
  if (s === undefined) return undefined
  const n = Number(s)
  return Number.isFinite(n) ? n : undefined
}

/** AD devuelve nombres de atributo con su casing de esquema; buscamos sin distinguir. */
function findKey(e: RawEntry, attr: string): string | undefined {
  const lower = attr.toLowerCase()
  return Object.keys(e.attrs).find((k) => k.toLowerCase() === lower)
}

export function classifyEntry(objectClass: string[]): NodeKind {
  const cls = objectClass.map((c) => c.toLowerCase())
  const has = (c: string) => cls.includes(c)

  if (has('domaindns')) return 'domain'
  if (has('organizationalunit')) return 'ou'
  if (has('builtindomain')) return 'builtin'
  if (has('lostandfound')) return 'lostAndFound'
  if (has('msds-groupmanagedserviceaccount')) return 'gmsa'
  if (has('msds-managedserviceaccount')) return 'msa'
  if (has('computer')) return 'computer'
  if (has('group')) return 'group'
  if (has('foreignsecurityprincipal')) return 'foreignSecurityPrincipal'
  if (has('inetorgperson')) return 'inetOrgPerson'
  if (has('user')) return 'user'
  if (has('contact')) return 'contact'
  if (has('printqueue')) return 'printer'
  if (has('volume')) return 'volume'
  if (cls.some((c) => CONTAINER_CLASSES.has(c))) return 'container'
  return 'unknown'
}

export function isContainerClass(objectClass: string[]): boolean {
  return objectClass.some((c) => CONTAINER_CLASSES.has(c.toLowerCase()))
}

export function toDirEntry(e: RawEntry, keepAttrs = false): DirEntry {
  const objectClass = allStrings(e, 'objectClass')
  const kind = classifyEntry(objectClass)
  const uac = firstNumber(e, 'userAccountControl')
  const computed = firstNumber(e, 'msDS-User-Account-Control-Computed') ?? 0
  const lockoutTime = firstString(e, 'lockoutTime')
  const accountExpires = firstString(e, 'accountExpires')

  const name =
    firstString(e, 'name') ??
    firstString(e, 'cn') ??
    firstString(e, 'ou') ??
    firstString(e, 'displayName') ??
    rdnValue(e.dn)

  const sidBuf = firstBuffer(e, 'objectSid')
  const guidBuf = firstBuffer(e, 'objectGUID')

  const entry: DirEntry = {
    dn: e.dn,
    name,
    kind,
    objectClass,
    objectGUID: guidBuf && guidBuf.length === 16 ? guidToString(guidBuf) : undefined,
    objectSID: sidBuf && sidBuf.length >= 8 ? sidToString(sidBuf) : undefined,
    description: firstString(e, 'description'),
    isContainer: isContainerClass(objectClass),
    showInAdvancedViewOnly: firstString(e, 'showInAdvancedViewOnly') === 'TRUE',
    systemFlagsProtected: firstString(e, 'isCriticalSystemObject') === 'TRUE'
  }

  if (uac !== undefined) {
    entry.disabled = (uac & UAC.ACCOUNTDISABLE) !== 0
    entry.locked =
      (computed & UAC_COMPUTED.LOCKOUT) !== 0 ||
      (!!lockoutTime && lockoutTime !== '0' && (filetimeToDate(lockoutTime)?.getTime() ?? 0) > 0)
    const exp = accountExpires && accountExpires !== '0' ? filetimeToDate(accountExpires) : null
    entry.expired = !!exp && exp.getTime() < Date.now()
  }

  if (keepAttrs) {
    entry.attrs = {}
    for (const [k, v] of Object.entries(e.attrs)) {
      entry.attrs[k] = v.map((x) => (Buffer.isBuffer(x) ? x.toString('base64') : String(x)))
    }
  }

  return entry
}

/** Filtro que usa ADUC para listar el contenido de un contenedor. */
export function containerFilter(showAdvanced: boolean): string {
  const base = '(objectClass=*)'
  return showAdvanced ? base : '(!(showInAdvancedViewOnly=TRUE))'
}

export interface ListOptions {
  showAdvanced: boolean
  /** Filtro adicional del usuario (Ver → Filtrar). */
  extraFilter?: string
  sizeLimit?: number
}

export async function listChildren(
  conn: AdConnection,
  dn: string,
  opts: ListOptions
): Promise<DirEntry[]> {
  const parts = ['(objectClass=*)']
  if (!opts.showAdvanced) parts.push('(!(showInAdvancedViewOnly=TRUE))')
  if (opts.extraFilter) parts.push(opts.extraFilter)
  const filter = parts.length > 1 ? `(&${parts.join('')})` : parts[0]

  const raw = await conn.searchRaw(dn, {
    scope: 'one',
    filter,
    attributes: LIST_ATTRS,
    sizeLimit: opts.sizeLimit ?? 0
  })
  // keepAttrs: la lista permite columnas configurables (mail, SO, fechas…).
  return raw.map((e) => toDirEntry(e, true)).sort(compareEntries)
}

/** Orden de ADUC: contenedores primero, después por nombre. */
export function compareEntries(a: DirEntry, b: DirEntry): number {
  if (a.isContainer !== b.isContainer) return a.isContainer ? -1 : 1
  return a.name.localeCompare(b.name, 'es', { sensitivity: 'base', numeric: true })
}

/** Sólo los hijos que van al árbol lateral. */
export async function listContainerChildren(
  conn: AdConnection,
  dn: string,
  showAdvanced: boolean
): Promise<DirEntry[]> {
  const classes = [
    'organizationalUnit', 'container', 'builtinDomain', 'lostAndFound', 'domainDNS',
    'msDS-QuotaContainer', 'msExchSystemObjectsContainer', 'configuration',
    'msDS-PasswordSettingsContainer', 'msImaging-PSPs', 'msDFSR-GlobalSettings',
    'msTPM-InformationObjectsContainer', 'rpcContainer', 'msDS-ShadowPrincipalContainer'
  ]
  const clsFilter = `(|${classes.map((c) => `(objectClass=${c})`).join('')})`
  const parts = [clsFilter]
  if (!showAdvanced) parts.push('(!(showInAdvancedViewOnly=TRUE))')
  const filter = `(&${parts.join('')})`

  const raw = await conn.searchRaw(dn, {
    scope: 'one',
    filter,
    attributes: ['objectClass', 'name', 'ou', 'cn', 'description', 'objectGUID', 'showInAdvancedViewOnly', 'systemFlags', 'isCriticalSystemObject']
  })
  return raw
    .map((e) => toDirEntry(e))
    .sort((a, b) => a.name.localeCompare(b.name, 'es', { sensitivity: 'base', numeric: true }))
}

/** Convierte una entrada en la lista de atributos del Editor de atributos. */
export function toAttributeValues(e: RawEntry): AttributeValue[] {
  const out: AttributeValue[] = []
  for (const [name, values] of Object.entries(e.attrs)) {
    const binary = values.some((v) => Buffer.isBuffer(v)) || isBinaryAttribute(name)
    out.push({
      name,
      values: values.map((v) => renderValue(name, v)),
      raw: binary
        ? values.map((v) => (Buffer.isBuffer(v) ? v.toString('base64') : Buffer.from(String(v)).toString('base64')))
        : undefined,
      isBinary: binary
    })
  }
  return out.sort((a, b) => a.name.localeCompare(b.name))
}

/** Representación legible de un valor, igual que hace ADUC en el editor de atributos. */
export function renderValue(name: string, value: string | Buffer): string {
  const n = name.toLowerCase()

  if (Buffer.isBuffer(value)) {
    if (n === 'objectsid' || n === 'sidhistory' || n === 'securityidentifier' || n === 'msds-quotatrustee') {
      return value.length >= 8 ? sidToString(value) : hexDump(value)
    }
    if (n === 'objectguid' || n.endsWith('guid') || n === 'schemaidguid' || n === 'attributesecurityguid') {
      return value.length === 16 ? `{${guidToString(value)}}` : hexDump(value)
    }
    if (n === 'ntsecuritydescriptor') return `<Descriptor de seguridad, ${value.length} bytes>`
    if (n === 'thumbnailphoto' || n === 'jpegphoto') return `<Imagen, ${value.length} bytes>`
    if (n === 'usercertificate' || n === 'cacertificate') return `<Certificado, ${value.length} bytes>`
    if (n === 'logonhours') return renderLogonHours(value)
    return hexDump(value)
  }

  const s = String(value)

  // FILETIME de 64 bits.
  if (['pwdlastset', 'lastlogon', 'lastlogontimestamp', 'lastlogoff', 'badpasswordtime',
       'accountexpires', 'lockouttime', 'msds-lastsuccessfulinteractivelogontime',
       'msds-lastfailedinteractivelogontime', 'msds-usserpasswordexpirytimecomputed',
       'msds-userpasswordexpirytimecomputed', 'creationtime'].includes(n)) {
    if (s === '0') return '0 (nunca / no establecido)'
    if (s === '9223372036854775807') return '(nunca)'
    const d = filetimeToDate(s)
    return d ? `${s} (${d.toLocaleString('es-AR')})` : s
  }

  // Intervalos negativos.
  if (['maxpwdage', 'minpwdage', 'lockoutduration', 'lockoutobservationwindow',
       'forcelogoff', 'msds-lockoutduration', 'msds-lockoutobservationwindow',
       'msds-maximumpasswordage', 'msds-minimumpasswordage'].includes(n)) {
    const days = intervalToDays(s)
    return days < 0 ? `${s} (nunca)` : `${s} (${days} día(s))`
  }

  // Generalized time.
  if (['whencreated', 'whenchanged', 'dscorepropagationdata', 'msds-approximatelastlogontimestamp'].includes(n)) {
    const d = generalizedTimeToDate(s)
    return d ? `${s} (${d.toLocaleString('es-AR')})` : s
  }

  if (n === 'useraccountcontrol' || n === 'msds-user-account-control-computed') {
    const v = Number(s)
    const flags = Object.entries(UAC).filter(([, bit]) => (v & bit) === bit).map(([k]) => k)
    return flags.length ? `${s} ( ${flags.join(' | ')} )` : s
  }

  if (n === 'grouptype') {
    const v = Number(s)
    return `${s} (${groupScopeOf(v)}, ${isSecurityGroup(v) ? 'seguridad' : 'distribución'})`
  }

  if (n === 'samaccounttype') {
    const v = Number(s)
    return SAM_ACCOUNT_TYPE[v] ? `${s} (${SAM_ACCOUNT_TYPE[v]})` : s
  }

  if (n === 'instancetype') {
    const v = Number(s)
    const flags = Object.entries(INSTANCE_TYPE).filter(([bit]) => (v & Number(bit)) !== 0).map(([, l]) => l)
    return flags.length ? `${s} (${flags.join(', ')})` : s
  }

  return s
}

function hexDump(buf: Buffer): string {
  const head = buf.subarray(0, 32)
  const hex = [...head].map((b) => b.toString(16).padStart(2, '0')).join(' ')
  return buf.length > 32 ? `${hex} … (${buf.length} bytes)` : hex
}

/** logonHours: 21 bytes = 168 bits (una hora por bit, UTC). */
function renderLogonHours(buf: Buffer): string {
  if (buf.length !== 21) return hexDump(buf)
  let allowed = 0
  for (const b of buf) allowed += popcount(b)
  if (allowed === 168) return 'Todas las horas permitidas'
  if (allowed === 0) return 'Ninguna hora permitida'
  return `${allowed} de 168 horas permitidas`
}

function popcount(n: number): number {
  let c = 0
  while (n) { c += n & 1; n >>= 1 }
  return c
}

/** Resuelve SIDs a nombres legibles, con cache. */
export async function resolveSids(conn: AdConnection, sids: string[]): Promise<Record<string, string>> {
  const out: Record<string, string> = {}
  const pending: string[] = []

  for (const sid of sids) {
    if (conn.sidNameCache.has(sid)) { out[sid] = conn.sidNameCache.get(sid)!; continue }
    const wk = resolveWellKnownSid(sid, conn.domainSID)
    if (wk) { out[sid] = wk; conn.sidNameCache.set(sid, wk); continue }
    pending.push(sid)
  }

  // Consultamos en lotes con un filtro OR.
  const CHUNK = 40
  for (let i = 0; i < pending.length; i += CHUNK) {
    const chunk = pending.slice(i, i + CHUNK)
    const filter = `(|${chunk.map((s) => {
      try { return `(objectSid=${sidToFilter(s)})` } catch { return '' }
    }).join('')})`
    if (filter === '(|)') continue
    try {
      const found = await conn.searchRaw(conn.baseDN, {
        scope: 'sub',
        filter,
        attributes: ['objectSid', 'sAMAccountName', 'name', 'msDS-PrincipalName']
      })
      for (const e of found) {
        const buf = firstBuffer(e, 'objectSid')
        if (!buf) continue
        const sid = sidToString(buf)
        const nb = conn.netbiosName ? `${conn.netbiosName}\\` : ''
        const label = firstString(e, 'sAMAccountName')
          ? `${nb}${firstString(e, 'sAMAccountName')}`
          : firstString(e, 'name') ?? sid
        out[sid] = label
        conn.sidNameCache.set(sid, label)
      }
    } catch { /* sin permisos de lectura: dejamos el SID crudo */ }
  }

  for (const sid of sids) if (!out[sid]) out[sid] = sid
  return out
}

/** Resuelve GUIDs de esquema (clases, atributos, derechos extendidos) a nombres. */
export async function resolveSchemaGuids(
  conn: AdConnection,
  guids: string[]
): Promise<Record<string, string>> {
  const out: Record<string, string> = {}
  const pending: string[] = []

  for (const g of guids) {
    const key = g.toLowerCase()
    if (EXTENDED_RIGHTS[key]) { out[g] = EXTENDED_RIGHTS[key]; continue }
    if (conn.schemaGuidCache.has(key)) { out[g] = conn.schemaGuidCache.get(key)!; continue }
    pending.push(key)
  }
  if (!pending.length) return out

  // Derechos extendidos viven en Extended-Rights (rightsGuid, formato string).
  try {
    const rights = await conn.searchRaw(`CN=Extended-Rights,${conn.configDN}`, {
      scope: 'one',
      filter: `(|${pending.map((g) => `(rightsGuid=${escapeFilter(g)})`).join('')})`,
      attributes: ['rightsGuid', 'displayName', 'cn']
    })
    for (const e of rights) {
      const g = (firstString(e, 'rightsGuid') ?? '').toLowerCase()
      const label = firstString(e, 'displayName') ?? firstString(e, 'cn') ?? g
      out[g] = label
      conn.schemaGuidCache.set(g, label)
    }
  } catch { /* Configuration inaccesible */ }

  // El resto pueden ser clases o atributos (schemaIDGUID, binario).
  const stillPending = pending.filter((g) => !out[g])
  if (stillPending.length) {
    try {
      const { guidToFilter } = await import('./encoding')
      const schema = await conn.searchRaw(conn.schemaDN, {
        scope: 'one',
        filter: `(|${stillPending.map((g) => {
          try { return `(schemaIDGUID=${guidToFilter(g)})` } catch { return '' }
        }).join('')})`,
        attributes: ['schemaIDGUID', 'lDAPDisplayName', 'cn', 'objectClass']
      })
      for (const e of schema) {
        const buf = firstBuffer(e, 'schemaIDGUID')
        if (!buf || buf.length !== 16) continue
        const g = guidToString(buf).toLowerCase()
        const label = firstString(e, 'lDAPDisplayName') ?? firstString(e, 'cn') ?? g
        out[g] = label
        conn.schemaGuidCache.set(g, label)
      }
    } catch { /* esquema inaccesible */ }
  }

  for (const g of guids) if (!out[g]) out[g] = out[g.toLowerCase()] ?? g
  return out
}

/** DN → nombre corto para mostrar (memberOf, manager, managedBy). */
export function dnLabel(dn: string): string {
  const parts = splitDN(dn)
  if (!parts.length) return dn
  return parseRDN(parts[0]).value
}
