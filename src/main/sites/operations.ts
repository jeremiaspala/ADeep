/** Sitios y servicios de Active Directory: todo vive en CN=Sites,CN=Configuration. */
import type { AdConnection } from '../ldap/connection'
import { ConnectionError } from '../ldap/connection'
import { firstBuffer, firstNumber, firstString, allStrings } from '../ldap/directory'
import { escapeRDN, rdnValue, splitDN } from '../ldap/encoding'
import type {
  ConnectionInfo, DsaServerInfo, SiteInfo, SiteLinkInfo, SubnetInfo
} from '../../shared/types'

export function sitesDN(conn: AdConnection): string {
  return `CN=Sites,${conn.configDN}`
}

export function subnetsDN(conn: AdConnection): string {
  return `CN=Subnets,CN=Sites,${conn.configDN}`
}

export function transportsDN(conn: AdConnection): string {
  return `CN=Inter-Site Transports,CN=Sites,${conn.configDN}`
}

/* ---------------- Programación (blob de 188 bytes) ---------------- */

/**
 * El atributo `schedule` es un SCHEDULE (MS-ADTS 6.1.4.5): cabecera de 20 bytes
 * y 168 bytes de bitmap, uno por hora de la semana. Cada byte lleva la cantidad
 * de replicaciones por hora (0 = sin replicación). Lo exponemos como 168 boolean.
 */
export function parseSchedule(buf?: Buffer): boolean[] | undefined {
  if (!buf || buf.length < 188) return undefined
  const offset = buf.readUInt32LE(16)
  const start = offset && offset + 168 <= buf.length ? offset : 20
  const out: boolean[] = []
  for (let i = 0; i < 168; i++) out.push(buf.readUInt8(start + i) !== 0)
  return out
}

export function buildSchedule(hours: boolean[]): Buffer {
  const buf = Buffer.alloc(188)
  buf.writeUInt32LE(188, 0) // Size
  buf.writeUInt32LE(0, 4) // Bandwidth
  buf.writeUInt32LE(1, 8) // NumberOfSchedules
  buf.writeUInt32LE(0, 12) // Type
  buf.writeUInt32LE(20, 16) // Offset
  for (let i = 0; i < 168; i++) buf.writeUInt8(hours[i] ? 0x01 : 0x00, 20 + i)
  return buf
}

/* ---------------- Sitios ---------------- */

export async function listSites(conn: AdConnection): Promise<SiteInfo[]> {
  const [sites, settings, servers, subnets] = await Promise.all([
    conn.searchRaw(sitesDN(conn), {
      scope: 'one', filter: '(objectClass=site)',
      attributes: ['name', 'description', 'location', 'distinguishedName']
    }),
    conn.searchRaw(sitesDN(conn), {
      scope: 'sub', filter: '(objectClass=nTDSSiteSettings)',
      attributes: ['options', 'interSiteTopologyGenerator', 'distinguishedName']
    }),
    conn.searchRaw(sitesDN(conn), {
      scope: 'sub', filter: '(objectClass=server)', attributes: ['distinguishedName']
    }),
    conn.searchRaw(subnetsDN(conn), {
      scope: 'one', filter: '(objectClass=subnet)', attributes: ['name', 'siteObject']
    }).catch(() => [])
  ])

  const settingsBySite = new Map<string, { options: number; istg?: string }>()
  for (const s of settings) {
    settingsBySite.set(parentOf(s.dn).toLowerCase(), {
      options: firstNumber(s, 'options') ?? 0,
      istg: firstString(s, 'interSiteTopologyGenerator')
    })
  }

  const serverCount = new Map<string, number>()
  for (const s of servers) {
    // CN=<srv>,CN=Servers,CN=<sitio>,...
    const site = parentOf(parentOf(s.dn)).toLowerCase()
    serverCount.set(site, (serverCount.get(site) ?? 0) + 1)
  }

  const subnetsBySite = new Map<string, string[]>()
  for (const s of subnets) {
    const site = firstString(s, 'siteObject')?.toLowerCase()
    if (!site) continue
    const list = subnetsBySite.get(site) ?? []
    list.push(firstString(s, 'name') ?? rdnValue(s.dn))
    subnetsBySite.set(site, list)
  }

  return sites
    .map((e) => {
      const key = e.dn.toLowerCase()
      const st = settingsBySite.get(key)
      return {
        dn: e.dn,
        name: firstString(e, 'name') ?? rdnValue(e.dn),
        description: firstString(e, 'description'),
        location: firstString(e, 'location'),
        servers: serverCount.get(key) ?? 0,
        subnets: subnetsBySite.get(key) ?? [],
        istg: st?.istg,
        settingsOptions: st?.options ?? 0
      }
    })
    .sort((a, b) => a.name.localeCompare(b.name, 'es'))
}

export async function createSite(conn: AdConnection, name: string, description?: string): Promise<string> {
  const dn = `CN=${escapeRDN(name)},${sitesDN(conn)}`
  await conn.add(dn, {
    objectClass: ['top', 'site'],
    cn: [name],
    ...(description ? { description: [description] } : {})
  })
  // Un sitio sin estos hijos no es utilizable: los crea la propia consola de MMC.
  await conn.add(`CN=NTDS Site Settings,${dn}`, {
    objectClass: ['top', 'applicationSiteSettings', 'nTDSSiteSettings'],
    cn: ['NTDS Site Settings']
  })
  await conn.add(`CN=Servers,${dn}`, {
    objectClass: ['top', 'serversContainer'],
    cn: ['Servers']
  })
  return dn
}

export async function deleteSite(conn: AdConnection, dn: string): Promise<void> {
  await conn.delete(dn, true)
}

/* ---------------- Subredes ---------------- */

export async function listSubnets(conn: AdConnection): Promise<SubnetInfo[]> {
  const [subnets, sites] = await Promise.all([
    conn.searchRaw(subnetsDN(conn), {
      scope: 'one', filter: '(objectClass=subnet)',
      attributes: ['name', 'siteObject', 'location', 'description']
    }),
    conn.searchRaw(sitesDN(conn), { scope: 'one', filter: '(objectClass=site)', attributes: ['name'] })
  ])
  const siteName = new Map(sites.map((s) => [s.dn.toLowerCase(), firstString(s, 'name') ?? rdnValue(s.dn)]))

  return subnets
    .map((e) => {
      const siteDN = firstString(e, 'siteObject')
      return {
        dn: e.dn,
        name: firstString(e, 'name') ?? rdnValue(e.dn),
        siteDN,
        siteName: siteDN ? siteName.get(siteDN.toLowerCase()) : undefined,
        location: firstString(e, 'location'),
        description: firstString(e, 'description')
      }
    })
    .sort((a, b) => a.name.localeCompare(b.name, 'es', { numeric: true }))
}

/** Valida el CIDR como lo hace la consola de MMC: la dirección debe ser la de red. */
export function validateSubnet(cidr: string): string | undefined {
  const m = /^([0-9a-fA-F:.]+)\/(\d{1,3})$/.exec(cidr.trim())
  if (!m) return 'Formato esperado: 10.0.0.0/24 o 2001:db8::/64'
  const [, addr, bitsStr] = m
  const bits = Number(bitsStr)

  if (addr.includes(':')) {
    if (bits < 1 || bits > 128) return 'El prefijo IPv6 debe estar entre 1 y 128'
    return undefined
  }

  const octets = addr.split('.')
  if (octets.length !== 4 || octets.some((o) => o === '' || Number(o) > 255 || !/^\d+$/.test(o))) {
    return 'Dirección IPv4 inválida'
  }
  if (bits < 1 || bits > 32) return 'El prefijo IPv4 debe estar entre 1 y 32'

  const value = octets.reduce((acc, o) => (acc << 8) + Number(o), 0) >>> 0
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0
  if ((value & mask) >>> 0 !== value) {
    const network = [24, 16, 8, 0].map((s) => ((value & mask) >>> s) & 0xff).join('.')
    return `No es una dirección de red; usá ${network}/${bits}`
  }
  return undefined
}

export async function createSubnet(
  conn: AdConnection,
  cidr: string,
  siteDN: string,
  location?: string,
  description?: string
): Promise<string> {
  const invalid = validateSubnet(cidr)
  if (invalid) throw new ConnectionError(invalid)
  const dn = `CN=${escapeRDN(cidr)},${subnetsDN(conn)}`
  await conn.add(dn, {
    objectClass: ['top', 'subnet'],
    cn: [cidr],
    ...(siteDN ? { siteObject: [siteDN] } : {}),
    ...(location ? { location: [location] } : {}),
    ...(description ? { description: [description] } : {})
  })
  return dn
}

export async function setSubnetSite(conn: AdConnection, dn: string, siteDN: string | null): Promise<void> {
  await conn.modify(dn, [
    siteDN
      ? { op: 'replace', attribute: 'siteObject', values: [siteDN] }
      : { op: 'delete', attribute: 'siteObject', values: [] }
  ])
}

/* ---------------- Vínculos a sitios ---------------- */

export async function listSiteLinks(conn: AdConnection): Promise<SiteLinkInfo[]> {
  const [links, sites] = await Promise.all([
    conn.searchRaw(transportsDN(conn), {
      scope: 'sub', filter: '(objectClass=siteLink)',
      attributes: ['name', 'cost', 'replInterval', 'siteList', 'schedule', 'options', 'description']
    }),
    conn.searchRaw(sitesDN(conn), { scope: 'one', filter: '(objectClass=site)', attributes: ['name'] })
  ])
  const siteName = new Map(sites.map((s) => [s.dn.toLowerCase(), firstString(s, 'name') ?? rdnValue(s.dn)]))

  return links
    .map((e) => {
      const options = firstNumber(e, 'options') ?? 0
      const list = allStrings(e, 'siteList')
      // CN=<link>,CN=IP|SMTP,CN=Inter-Site Transports,...
      const transport = rdnValue(parentOf(e.dn)).toUpperCase() === 'SMTP' ? 'SMTP' : 'IP'
      return {
        dn: e.dn,
        name: firstString(e, 'name') ?? rdnValue(e.dn),
        transport: transport as 'IP' | 'SMTP',
        cost: firstNumber(e, 'cost') ?? 100,
        replInterval: firstNumber(e, 'replInterval') ?? 180,
        sites: list,
        siteNames: list.map((d) => siteName.get(d.toLowerCase()) ?? rdnValue(d)),
        notify: (options & 0x1) !== 0,
        noCompression: (options & 0x4) !== 0,
        description: firstString(e, 'description'),
        schedule: parseSchedule(firstBuffer(e, 'schedule'))
      }
    })
    .sort((a, b) => a.name.localeCompare(b.name, 'es'))
}

export async function createSiteLink(
  conn: AdConnection,
  name: string,
  siteDNs: string[],
  cost: number,
  replInterval: number,
  transport: 'IP' | 'SMTP' = 'IP'
): Promise<string> {
  if (siteDNs.length < 2) throw new ConnectionError('Un vínculo necesita al menos dos sitios.')
  const dn = `CN=${escapeRDN(name)},CN=${transport},${transportsDN(conn)}`
  await conn.add(dn, {
    objectClass: ['top', 'siteLink'],
    cn: [name],
    siteList: siteDNs,
    cost: [String(cost)],
    replInterval: [String(replInterval)]
  })
  return dn
}

export async function updateSiteLink(
  conn: AdConnection,
  dn: string,
  patch: {
    cost?: number
    replInterval?: number
    siteDNs?: string[]
    notify?: boolean
    noCompression?: boolean
    description?: string
    schedule?: boolean[] | null
  }
): Promise<void> {
  const mods: { op: 'replace' | 'delete'; attribute: string; values: (string | Buffer)[] }[] = []
  if (patch.cost !== undefined) mods.push({ op: 'replace', attribute: 'cost', values: [String(patch.cost)] })
  if (patch.replInterval !== undefined) {
    mods.push({ op: 'replace', attribute: 'replInterval', values: [String(patch.replInterval)] })
  }
  if (patch.siteDNs) mods.push({ op: 'replace', attribute: 'siteList', values: patch.siteDNs })
  if (patch.description !== undefined) {
    mods.push(patch.description
      ? { op: 'replace', attribute: 'description', values: [patch.description] }
      : { op: 'delete', attribute: 'description', values: [] })
  }
  if (patch.notify !== undefined || patch.noCompression !== undefined) {
    const e = await conn.searchOne(dn, ['options'])
    let options = (e && firstNumber(e, 'options')) ?? 0
    if (patch.notify !== undefined) options = patch.notify ? options | 0x1 : options & ~0x1
    if (patch.noCompression !== undefined) options = patch.noCompression ? options | 0x4 : options & ~0x4
    mods.push({ op: 'replace', attribute: 'options', values: [String(options)] })
  }
  if (patch.schedule !== undefined) {
    mods.push(patch.schedule
      ? { op: 'replace', attribute: 'schedule', values: [buildSchedule(patch.schedule)] }
      : { op: 'delete', attribute: 'schedule', values: [] })
  }
  if (mods.length) await conn.modify(dn, mods)
}

/* ---------------- Servidores y conexiones ---------------- */

export async function listServers(conn: AdConnection, siteDN?: string): Promise<DsaServerInfo[]> {
  const base = siteDN ?? sitesDN(conn)
  const [servers, ntds, connections, settings, sites] = await Promise.all([
    conn.searchRaw(base, {
      scope: 'sub', filter: '(objectClass=server)',
      attributes: ['name', 'dNSHostName', 'serverReference', 'description']
    }),
    conn.searchRaw(base, {
      scope: 'sub', filter: '(objectClass=nTDSDSA)',
      attributes: ['options', 'msDS-HasFullReplicaNCs', 'hasMasterNCs']
    }),
    conn.searchRaw(base, {
      scope: 'sub', filter: '(objectClass=nTDSConnection)',
      attributes: ['name', 'fromServer', 'options', 'enabledConnection', 'schedule']
    }),
    conn.searchRaw(sitesDN(conn), {
      scope: 'sub', filter: '(objectClass=nTDSSiteSettings)',
      attributes: ['interSiteTopologyGenerator']
    }),
    conn.searchRaw(sitesDN(conn), { scope: 'one', filter: '(objectClass=site)', attributes: ['name'] })
  ])

  const siteName = new Map(sites.map((s) => [s.dn.toLowerCase(), firstString(s, 'name') ?? rdnValue(s.dn)]))
  const istgs = new Set(
    settings.map((s) => firstString(s, 'interSiteTopologyGenerator')?.toLowerCase()).filter(Boolean) as string[]
  )
  const ntdsByServer = new Map(ntds.map((n) => [parentOf(n.dn).toLowerCase(), n]))

  // El nombre del servidor origen de una conexión sale del DN de su NTDS Settings.
  const serverNameOf = (ntdsDN: string): string => rdnValue(parentOf(ntdsDN))

  const connsByNtds = new Map<string, ConnectionInfo[]>()
  for (const c of connections) {
    const owner = parentOf(c.dn).toLowerCase()
    const options = firstNumber(c, 'options') ?? 0
    const fromServer = firstString(c, 'fromServer') ?? ''
    const list = connsByNtds.get(owner) ?? []
    list.push({
      dn: c.dn,
      name: firstString(c, 'name') ?? rdnValue(c.dn),
      fromServer,
      fromServerName: fromServer ? serverNameOf(fromServer) : '',
      enabled: (firstString(c, 'enabledConnection') ?? 'TRUE').toUpperCase() === 'TRUE',
      generatedByKcc: (options & 0x1) !== 0,
      noCompression: (options & 0x8) !== 0,
      schedule: parseSchedule(firstBuffer(c, 'schedule'))
    })
    connsByNtds.set(owner, list)
  }

  return servers
    .map((e) => {
      const n = ntdsByServer.get(e.dn.toLowerCase())
      const ntdsDN = n?.dn
      const options = n ? firstNumber(n, 'options') ?? 0 : 0
      const site = parentOf(parentOf(e.dn))
      return {
        dn: e.dn,
        name: firstString(e, 'name') ?? rdnValue(e.dn),
        siteDN: site,
        siteName: siteName.get(site.toLowerCase()) ?? rdnValue(site),
        dnsHostName: firstString(e, 'dNSHostName'),
        serverReference: firstString(e, 'serverReference'),
        ntdsDN,
        ntdsOptions: options,
        isGC: (options & 0x1) !== 0,
        isISTG: !!ntdsDN && istgs.has(ntdsDN.toLowerCase()),
        connections: ntdsDN ? connsByNtds.get(ntdsDN.toLowerCase()) ?? [] : []
      }
    })
    .sort((a, b) => a.name.localeCompare(b.name, 'es'))
}

/** Catálogo global: bit 1 de nTDSDSA.options. */
export async function setGlobalCatalog(conn: AdConnection, ntdsDN: string, enabled: boolean): Promise<void> {
  const e = await conn.searchOne(ntdsDN, ['options'])
  const options = (e && firstNumber(e, 'options')) ?? 0
  const next = enabled ? options | 0x1 : options & ~0x1
  await conn.modify(ntdsDN, [{ op: 'replace', attribute: 'options', values: [String(next)] }])
}

export async function moveServerToSite(conn: AdConnection, serverDN: string, siteDN: string): Promise<string> {
  const target = `CN=Servers,${siteDN}`
  const newDN = `${splitDN(serverDN)[0]},${target}`
  await conn.modifyDN(serverDN, newDN)
  return newDN
}

export async function createConnection(
  conn: AdConnection,
  toNtdsDN: string,
  fromNtdsDN: string,
  name?: string
): Promise<string> {
  const cn = name ?? `${rdnValue(parentOf(fromNtdsDN))}-manual`
  const dn = `CN=${escapeRDN(cn)},${toNtdsDN}`
  await conn.add(dn, {
    objectClass: ['top', 'nTDSConnection'],
    cn: [cn],
    fromServer: [fromNtdsDN],
    enabledConnection: ['TRUE'],
    options: ['0']
  })
  return dn
}

export async function setConnectionEnabled(conn: AdConnection, dn: string, enabled: boolean): Promise<void> {
  await conn.modify(dn, [
    { op: 'replace', attribute: 'enabledConnection', values: [enabled ? 'TRUE' : 'FALSE'] }
  ])
}

/** options de nTDSSiteSettings: bit 1 KCC intra-sitio off, bit 16 inter-sitio off. */
export async function setKccOptions(
  conn: AdConnection,
  siteDN: string,
  intraSiteOff: boolean,
  interSiteOff: boolean
): Promise<void> {
  const dn = `CN=NTDS Site Settings,${siteDN}`
  const e = await conn.searchOne(dn, ['options'])
  let options = (e && firstNumber(e, 'options')) ?? 0
  options = intraSiteOff ? options | 0x1 : options & ~0x1
  options = interSiteOff ? options | 0x10 : options & ~0x10
  await conn.modify(dn, [{ op: 'replace', attribute: 'options', values: [String(options)] }])
}

/* ---------------- Operaciones sobre rootDSE ---------------- */

export type RootDseOperation =
  | 'replicateSingleObject'
  | 'schemaUpdateNow'
  | 'doGarbageCollection'
  | 'invalidateRidPool'
  | 'recalcHierarchy'

/**
 * Escribir ciertos atributos del rootDSE dispara operaciones en el DC
 * (MS-ADTS 3.1.1.3.3). No reemplaza a DRSUAPI: `replicateSingleObject` sincroniza
 * un objeto, no un contexto de nombres completo.
 */
export async function rootDseOperation(
  conn: AdConnection,
  operation: RootDseOperation,
  value = '1'
): Promise<void> {
  await conn.modify('', [{ op: 'replace', attribute: operation, values: [value] }])
}

export async function replicateObject(
  conn: AdConnection,
  objectDN: string,
  sourceDsaInvocationId: string
): Promise<void> {
  await rootDseOperation(conn, 'replicateSingleObject', `${objectDN}:${sourceDsaInvocationId}`)
}

function parentOf(dn: string): string {
  const parts = splitDN(dn)
  return parts.slice(1).join(',')
}
