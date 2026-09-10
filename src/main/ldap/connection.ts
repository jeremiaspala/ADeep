/** Conexión a un controlador de dominio y operaciones LDAP crudas. */
import { Client, Attribute, Change, Control } from 'ldapts'
import type { Entry } from 'ldapts'
import type { ConnectionProfile, RootDSE } from '../../shared/types'
import { escapeFilter, sidToString, guidToString } from './encoding'
import { OID, PermissiveModifyControl, ShowDeletedControl, ShowRecycledControl, TreeDeleteControl } from './controls'

/** Atributos que siempre queremos como Buffer, en todas las variantes de mayúsculas de AD. */
const BINARY_ATTRS = [
  'objectSid', 'objectSID', 'objectsid',
  'objectGUID', 'objectGuid', 'objectguid',
  'nTSecurityDescriptor', 'ntSecurityDescriptor', 'ntsecuritydescriptor',
  'msExchMailboxGuid', 'schemaIDGUID', 'attributeSecurityGUID',
  'sIDHistory', 'sidHistory', 'tokenGroups', 'tokenGroupsGlobalAndUniversal',
  'userCertificate', 'userCertificate;binary', 'userSMIMECertificate',
  'cACertificate', 'thumbnailPhoto', 'jpegPhoto', 'photo', 'thumbnailLogo',
  'logonHours', 'userParameters', 'auditingPolicy', 'dNSProperty',
  'msDS-AllowedToActOnBehalfOfOtherIdentity', 'msDS-GenerateRODCPasswordSyncedAttributes',
  'replUpToDateVector', 'repsFrom', 'repsTo', 'dSASignature', 'objectSecurityDescriptor',
  'msDFSR-Schedule', 'msDFSR-ReplicationGroupGuid', 'msDFSR-ContentSetGuid',
  'mSMQSignCertificates', 'mSMQDigests', 'msDS-KeyCredentialLink', 'unicodePwd',
  'msDS-ExecuteScriptPassword', 'msDS-ManagedPassword', 'msDS-ManagedPasswordId',
  'msDS-ManagedPasswordPreviousId', 'ipsecData', 'currentValue', 'trustAuthIncoming',
  'trustAuthOutgoing', 'supplementalCredentials', 'priorValue', 'securityIdentifier',
  'msDS-QuotaTrustee', 'wellKnownObjects', 'otherWellKnownObjects', 'schedule',
  'networkAddress', 'oMObjectClass', 'msDS-Site-Affinity', 'partialAttributeSet',
  'msPKI-Enrollment-Flag', 'pKIExpirationPeriod', 'pKIOverlapPeriod', 'pKIKeyUsage',
  'pKICriticalExtensions', 'pKIExtendedKeyUsage', 'pKIDefaultKeySpec', 'pKIEnrollmentAccess',
  'terminalServer', 'msRADIUSFramedIPAddress', 'msRTCSIP-UserRoutingGroupId'
]

/** Nombre normalizado (minúsculas) de todos los atributos binarios. */
export const BINARY_ATTR_SET = new Set(BINARY_ATTRS.map((a) => a.toLowerCase()))

export function isBinaryAttribute(name: string): boolean {
  const n = name.toLowerCase().replace(/;binary$/, '')
  return BINARY_ATTR_SET.has(n) || BINARY_ATTR_SET.has(name.toLowerCase())
}

export interface RawEntry {
  dn: string
  attrs: Record<string, (string | Buffer)[]>
}

export interface SearchOpts {
  scope?: 'base' | 'one' | 'sub'
  filter?: string
  attributes?: string[]
  sizeLimit?: number
  pageSize?: number
  timeLimit?: number
  controls?: Control[]
  includeDeleted?: boolean
}

export class ConnectionError extends Error {
  code?: number
  constructor(message: string, code?: number) {
    super(message)
    this.code = code
  }
}

export class AdConnection {
  readonly client: Client
  readonly profile: ConnectionProfile
  rootDSE!: RootDSE
  domainSID?: string
  netbiosName?: string
  whoami?: string
  machineAccountQuota?: number
  /** Cache SID → nombre para mostrar en la pestaña Seguridad. */
  readonly sidNameCache = new Map<string, string>()
  /** Cache GUID → nombre de clase/atributo del esquema. */
  readonly schemaGuidCache = new Map<string, string>()

  private constructor(client: Client, profile: ConnectionProfile) {
    this.client = client
    this.profile = profile
  }

  static url(profile: ConnectionProfile): string {
    const proto = profile.security === 'ldaps' ? 'ldaps' : 'ldap'
    return `${proto}://${profile.host}:${profile.port}`
  }

  static async connect(profile: ConnectionProfile, password: string): Promise<AdConnection> {
    const tlsOptions = {
      rejectUnauthorized: !profile.insecureTLS,
      servername: profile.host
    }
    const client = new Client({
      url: AdConnection.url(profile),
      timeout: 60_000,
      connectTimeout: 15_000,
      strictDN: false,
      tlsOptions
    })

    const conn = new AdConnection(client, profile)
    try {
      if (profile.security === 'starttls') {
        await client.startTLS(tlsOptions)
      }
      await client.bind(profile.bindDN, password)
      await conn.loadRootDSE()
      await conn.loadDomainInfo()
    } catch (err) {
      try { await client.unbind() } catch { /* ya cerrado */ }
      throw wrapError(err)
    }
    return conn
  }

  get connected(): boolean {
    return this.client.isConnected
  }

  async disconnect(): Promise<void> {
    try { await this.client.unbind() } catch { /* nada que hacer */ }
  }

  /** Lee rootDSE sin autenticación previa necesaria. */
  private async loadRootDSE(): Promise<void> {
    const res = await this.client.search('', {
      scope: 'base',
      filter: '(objectClass=*)',
      attributes: [
        'defaultNamingContext', 'configurationNamingContext', 'schemaNamingContext',
        'rootDomainNamingContext', 'namingContexts', 'dnsHostName', 'serverName',
        'ldapServiceName', 'domainFunctionality', 'forestFunctionality',
        'domainControllerFunctionality', 'supportedSASLMechanisms', 'supportedControl',
        'supportedCapabilities', 'isSynchronized', 'isGlobalCatalogReady', 'currentTime',
        'highestCommittedUSN', 'subschemaSubentry'
      ]
    })
    const e = res.searchEntries[0]
    if (!e) throw new ConnectionError('El servidor no devolvió rootDSE')
    const one = (k: string) => asArray(e[k])[0]?.toString() ?? ''
    this.rootDSE = {
      defaultNamingContext: one('defaultNamingContext'),
      configurationNamingContext: one('configurationNamingContext'),
      schemaNamingContext: one('schemaNamingContext'),
      rootDomainNamingContext: one('rootDomainNamingContext'),
      namingContexts: asArray(e.namingContexts).map(String),
      dnsHostName: one('dnsHostName'),
      serverName: one('serverName'),
      ldapServiceName: one('ldapServiceName'),
      domainFunctionality: Number(one('domainFunctionality') || 0),
      forestFunctionality: Number(one('forestFunctionality') || 0),
      domainControllerFunctionality: Number(one('domainControllerFunctionality') || 0),
      supportedSASLMechanisms: asArray(e.supportedSASLMechanisms).map(String),
      supportedControl: asArray(e.supportedControl).map(String),
      isSynchronized: one('isSynchronized') === 'TRUE',
      isGlobalCatalogReady: one('isGlobalCatalogReady') === 'TRUE'
    }
    if (!this.profile.baseDN) {
      this.profile.baseDN = this.rootDSE.defaultNamingContext
    }
  }

  /** SID del dominio, nombre NetBIOS y machineAccountQuota. */
  private async loadDomainInfo(): Promise<void> {
    const base = this.baseDN
    const [domain, whoami] = await Promise.all([
      this.searchRaw(base, {
        scope: 'base',
        filter: '(objectClass=*)',
        attributes: ['objectSid', 'ms-DS-MachineAccountQuota', 'name']
      }),
      this.client.exop(OID.WHOAMI).catch(() => null)
    ])
    const d = domain[0]
    if (d) {
      const sid = d.attrs.objectSid?.[0]
      if (Buffer.isBuffer(sid)) this.domainSID = sidToString(sid)
      const quota = d.attrs['ms-DS-MachineAccountQuota']?.[0]
      if (quota !== undefined) this.machineAccountQuota = Number(quota)
    }
    if (whoami?.value) {
      this.whoami = String(whoami.value).replace(/^dn:/, '').replace(/^u:/, '')
    }

    // NetBIOS: Partitions del NC de configuración.
    try {
      const parts = await this.searchRaw(
        `CN=Partitions,${this.rootDSE.configurationNamingContext}`,
        {
          scope: 'one',
          filter: `(&(objectClass=crossRef)(nCName=${escapeFilter(base)}))`,
          attributes: ['nETBIOSName', 'dnsRoot']
        }
      )
      const n = parts[0]?.attrs.nETBIOSName?.[0]
      if (n) this.netbiosName = String(n)
    } catch { /* sin permisos sobre Configuration: seguimos sin NetBIOS */ }
  }

  get baseDN(): string {
    return this.profile.baseDN || this.rootDSE.defaultNamingContext
  }

  get configDN(): string {
    return this.rootDSE.configurationNamingContext
  }

  get schemaDN(): string {
    return this.rootDSE.schemaNamingContext
  }

  /** Búsqueda paginada. Devuelve atributos con Buffer cuando corresponde. */
  async searchRaw(baseDN: string, opts: SearchOpts = {}): Promise<RawEntry[]> {
    const controls: Control[] = [...(opts.controls ?? [])]
    if (opts.includeDeleted) {
      controls.push(new ShowDeletedControl(true))
      if (this.rootDSE.supportedControl.includes(OID.SHOW_RECYCLED)) {
        controls.push(new ShowRecycledControl(true))
      }
    }

    const requested = opts.attributes ?? ['*']
    const explicit = Array.from(new Set([...BINARY_ATTRS, ...requested.filter(isBinaryAttribute)]))

    try {
      const res = await this.client.search(
        baseDN,
        {
          scope: opts.scope ?? 'sub',
          filter: opts.filter ?? '(objectClass=*)',
          attributes: requested,
          sizeLimit: opts.sizeLimit ?? 0,
          timeLimit: opts.timeLimit ?? 0,
          paged: opts.pageSize === 0 ? false : { pageSize: opts.pageSize ?? 900 },
          explicitBufferAttributes: explicit
        },
        controls.length ? controls : undefined
      )
      return res.searchEntries.map(toRawEntry)
    } catch (err) {
      throw wrapError(err)
    }
  }

  async searchOne(dn: string, attributes?: string[]): Promise<RawEntry | null> {
    const r = await this.searchRaw(dn, {
      scope: 'base',
      filter: '(objectClass=*)',
      attributes,
      pageSize: 0
    })
    return r[0] ?? null
  }

  async add(dn: string, attrs: Record<string, (string | Buffer)[]>): Promise<void> {
    const attributes = Object.entries(attrs)
      .filter(([, v]) => v.length > 0)
      .map(([type, values]) => new Attribute({ type, values: normalizeValues(values) }))
    try {
      await this.client.add(dn, attributes)
    } catch (err) {
      throw wrapError(err)
    }
  }

  async modify(
    dn: string,
    changes: { op: 'add' | 'delete' | 'replace'; attribute: string; values: (string | Buffer)[] }[],
    permissive = true
  ): Promise<void> {
    if (!changes.length) return
    const list = changes.map(
      (c) =>
        new Change({
          operation: c.op,
          modification: new Attribute({ type: c.attribute, values: normalizeValues(c.values) })
        })
    )
    try {
      await this.client.modify(dn, list, permissive ? [new PermissiveModifyControl()] : undefined)
    } catch (err) {
      throw wrapError(err)
    }
  }

  async delete(dn: string, tree = false): Promise<void> {
    try {
      await this.client.del(dn, tree ? [new TreeDeleteControl()] : undefined)
    } catch (err) {
      throw wrapError(err)
    }
  }

  async modifyDN(dn: string, newDN: string): Promise<void> {
    try {
      await this.client.modifyDN(dn, newDN)
    } catch (err) {
      throw wrapError(err)
    }
  }

  async compare(dn: string, attribute: string, value: string): Promise<boolean> {
    return this.client.compare(dn, attribute, value)
  }
}

function asArray(v: unknown): (string | Buffer)[] {
  if (v === undefined || v === null) return []
  return Array.isArray(v) ? (v as (string | Buffer)[]) : [v as string | Buffer]
}

function toRawEntry(e: Entry): RawEntry {
  const attrs: Record<string, (string | Buffer)[]> = {}
  for (const [k, v] of Object.entries(e)) {
    if (k === 'dn') continue
    attrs[k] = asArray(v)
  }
  return { dn: e.dn, attrs }
}

function normalizeValues(values: (string | Buffer)[]): string[] | Buffer[] {
  return values.some((v) => Buffer.isBuffer(v))
    ? (values.map((v) => (Buffer.isBuffer(v) ? v : Buffer.from(String(v), 'utf8'))) as Buffer[])
    : (values.map(String) as string[])
}

/** Traduce errores de ldapts a mensajes útiles en castellano. */
export function wrapError(err: unknown): ConnectionError {
  const e = err as { message?: string; code?: number; name?: string }
  const code = e?.code
  const raw = e?.message ?? String(err)

  const byCode: Record<number, string> = {
    1: 'Error de operaciones en el servidor.',
    2: 'Error de protocolo.',
    3: 'Se agotó el tiempo límite de la búsqueda.',
    4: 'Se superó el límite de tamaño de la búsqueda.',
    8: 'El servidor exige autenticación más fuerte (probá LDAPS o StartTLS).',
    10: 'Referencia a otro servidor (referral).',
    11: 'Se superó el límite administrativo del servidor.',
    16: 'El atributo no existe en el objeto.',
    17: 'Tipo de atributo no definido en el esquema.',
    19: 'Violación de restricción: revisá la política de contraseñas o el formato del valor.',
    20: 'El valor del atributo ya existe.',
    21: 'Sintaxis de valor inválida para ese atributo.',
    32: 'No existe el objeto indicado.',
    34: 'Sintaxis de DN inválida.',
    50: 'Permisos insuficientes para realizar la operación.',
    51: 'El servidor está ocupado.',
    52: 'El servidor no está disponible.',
    53: 'El servidor no está dispuesto a ejecutar la operación (suele ser LDAPS requerido para escribir contraseñas).',
    64: 'Violación de nomenclatura: el nombre no es válido en ese contenedor.',
    65: 'Violación de objectClass: faltan atributos obligatorios.',
    66: 'No permitido sobre un objeto con hijos: usá eliminación de subárbol.',
    67: 'No se puede modificar el RDN con esta operación: usá Renombrar.',
    68: 'Ya existe un objeto con ese nombre.',
    69: 'No se puede modificar objectClass.',
    71: 'La operación afecta a varios servidores.',
    80: 'Error interno del servidor.'
  }

  let message = code !== undefined && byCode[code] ? byCode[code] : raw
  // Los códigos de error de Windows vienen embebidos en el diagnóstico.
  const win = /data ([0-9a-fA-F]{2,4})/.exec(raw)
  if (win) {
    const details: Record<string, string> = {
      '525': 'El usuario no existe.',
      '52e': 'Credenciales inválidas: usuario o contraseña incorrectos.',
      '530': 'No tiene permitido iniciar sesión a esta hora.',
      '531': 'No tiene permitido iniciar sesión en esta estación de trabajo.',
      '532': 'La contraseña expiró.',
      '533': 'La cuenta está deshabilitada.',
      '534': 'El usuario no tiene concedido el tipo de inicio de sesión solicitado.',
      '701': 'La cuenta expiró.',
      '773': 'El usuario debe cambiar la contraseña antes de iniciar sesión.',
      '775': 'La cuenta de usuario está bloqueada.'
    }
    const d = details[win[1].toLowerCase()]
    if (d) message = d
  }
  if (/ENOTFOUND|EAI_AGAIN/.test(raw)) message = 'No se pudo resolver el nombre del servidor.'
  if (/ECONNREFUSED/.test(raw)) message = 'Conexión rechazada: revisá host y puerto.'
  if (/ETIMEDOUT|timed out/i.test(raw)) message = 'Tiempo de espera agotado al conectar con el servidor.'
  if (/self[- ]signed|unable to verify|CERT_/i.test(raw)) {
    message = 'Certificado TLS no confiable. Instalá la CA del dominio o activá "No verificar certificado".'
  }

  const out = new ConnectionError(message, code)
  ;(out as ConnectionError & { raw?: string }).raw = raw
  return out
}

export { asArray, sidToString, guidToString }
