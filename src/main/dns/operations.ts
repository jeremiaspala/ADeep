/**
 * DNS integrado en Active Directory.
 *
 * Las zonas viven como objetos `dnsZone` en tres lugares, según cómo se haya
 * elegido replicarlas:
 *   - CN=MicrosoftDNS,DC=DomainDnsZones,<dominio>  → todo el dominio
 *   - CN=MicrosoftDNS,DC=ForestDnsZones,<dominio>  → todo el bosque
 *   - CN=MicrosoftDNS,CN=System,<dominio>          → heredado de Windows 2000
 *
 * Cada nombre es un `dnsNode` con el atributo multivaluado `dnsRecord`: un blob
 * binario por registro (ver dns/record.ts).
 */
import type { AdConnection } from '../ldap/connection'
import { ConnectionError } from '../ldap/connection'
import { firstString } from '../ldap/directory'
import { escapeRDN, rdnValue } from '../ldap/encoding'
import { buildRecord, parseRecord, DNS_TYPE, type RecordInput } from './record'
import type { DnsNode, DnsRecordView, DnsZone, DnsZoneDetails } from '../../shared/types'

export type ZoneScope = 'domain' | 'forest' | 'legacy'

export function zoneContainers(conn: AdConnection): { scope: ZoneScope; dn: string }[] {
  return [
    { scope: 'domain', dn: `CN=MicrosoftDNS,DC=DomainDnsZones,${conn.baseDN}` },
    { scope: 'forest', dn: `CN=MicrosoftDNS,DC=ForestDnsZones,${conn.baseDN}` },
    { scope: 'legacy', dn: `CN=MicrosoftDNS,CN=System,${conn.baseDN}` }
  ]
}

const SCOPE_LABELS: Record<ZoneScope, string> = {
  domain: 'Todos los servidores DNS del dominio',
  forest: 'Todos los servidores DNS del bosque',
  legacy: 'Controladores de dominio (heredado)'
}

export async function listZones(conn: AdConnection): Promise<DnsZone[]> {
  const zones: DnsZone[] = []

  for (const { scope, dn } of zoneContainers(conn)) {
    const found = await conn
      .searchRaw(dn, {
        scope: 'one',
        filter: '(objectClass=dnsZone)',
        attributes: ['name', 'dNSProperty', 'whenCreated', 'whenChanged']
      })
      .catch(() => [])

    for (const e of found) {
      const name = firstString(e, 'name') ?? rdnValue(e.dn)
      // RootDNSServers es la lista de raíces, no una zona administrable.
      if (name === 'RootDNSServers') continue
      zones.push({
        dn: e.dn,
        name,
        scope,
        scopeLabel: SCOPE_LABELS[scope],
        reverse: name.toLowerCase().endsWith('.in-addr.arpa') || name.toLowerCase().endsWith('.ip6.arpa'),
        records: 0
      })
    }
  }

  // La cantidad de nombres por zona se cuenta aparte para no traer todo el contenido.
  await Promise.all(
    zones.map(async (z) => {
      const nodes = await conn
        .searchRaw(z.dn, { scope: 'one', filter: '(objectClass=dnsNode)', attributes: ['name'] })
        .catch(() => [])
      z.records = nodes.length
    })
  )

  return zones.sort(
    (a, b) => Number(a.reverse) - Number(b.reverse) || a.name.localeCompare(b.name, 'es')
  )
}

export async function listNodes(conn: AdConnection, zoneDN: string): Promise<DnsNode[]> {
  const raw = await conn.searchRaw(zoneDN, {
    scope: 'one',
    filter: '(objectClass=dnsNode)',
    attributes: ['name', 'dnsRecord', 'dNSTombstoned', 'whenChanged'],
    pageSize: 500
  })

  const zoneName = rdnValue(zoneDN)

  return raw
    .map((e) => {
      const name = firstString(e, 'name') ?? rdnValue(e.dn)
      const buffers = (e.attrs.dnsRecord ?? []).filter((v): v is Buffer => Buffer.isBuffer(v))
      const records: DnsRecordView[] = []

      for (const buf of buffers) {
        const rec = parseRecord(buf)
        // El tipo 0 es una lápida: el nombre existe pero ya no tiene datos.
        if (!rec || rec.type === DNS_TYPE.ZERO) continue
        records.push({
          type: rec.type,
          typeName: rec.typeName,
          ttl: rec.ttl,
          data: rec.data,
          fields: rec.fields,
          static: rec.timestamp === 0,
          raw: buf.toString('base64')
        })
      }

      return {
        dn: e.dn,
        name,
        fqdn: name === '@' ? zoneName : `${name}.${zoneName}`,
        tombstoned: (firstString(e, 'dNSTombstoned') ?? 'FALSE').toUpperCase() === 'TRUE',
        records
      }
    })
    .filter((n) => n.records.length || n.tombstoned)
    .sort((a, b) => {
      if (a.name === '@') return -1
      if (b.name === '@') return 1
      return a.name.localeCompare(b.name, 'es', { numeric: true })
    })
}

/** Agrega un registro a un nombre; crea el dnsNode si todavía no existe. */
export async function addRecord(
  conn: AdConnection,
  zoneDN: string,
  nodeName: string,
  input: RecordInput
): Promise<void> {
  const value = buildRecord(input)
  const dn = `DC=${escapeRDN(nodeName)},${zoneDN}`
  const existing = await conn.searchOne(dn, ['dnsRecord']).catch(() => null)

  if (existing) {
    await conn.modify(dn, [{ op: 'add', attribute: 'dnsRecord', values: [value] }])
    return
  }

  await conn.add(dn, {
    objectClass: ['top', 'dnsNode'],
    dc: [nodeName],
    dnsRecord: [value]
  })
}

/** Reemplaza un valor concreto: se borra el blob exacto y se agrega el nuevo. */
export async function replaceRecord(
  conn: AdConnection,
  nodeDN: string,
  originalBase64: string,
  input: RecordInput
): Promise<void> {
  const original = Buffer.from(originalBase64, 'base64')
  const value = buildRecord(input)
  await conn.modify(nodeDN, [
    { op: 'delete', attribute: 'dnsRecord', values: [original] },
    { op: 'add', attribute: 'dnsRecord', values: [value] }
  ])
}

export async function deleteRecord(
  conn: AdConnection,
  nodeDN: string,
  originalBase64: string
): Promise<void> {
  const original = Buffer.from(originalBase64, 'base64')
  const entry = await conn.searchOne(nodeDN, ['dnsRecord'])
  const restantes = entry
    ? (entry.attrs.dnsRecord ?? []).filter((v): v is Buffer => Buffer.isBuffer(v)).length
    : 0

  // Si era el último registro, el nodo entero se va: un dnsNode sin dnsRecord no es válido.
  if (restantes <= 1) {
    await conn.delete(nodeDN)
    return
  }
  await conn.modify(nodeDN, [{ op: 'delete', attribute: 'dnsRecord', values: [original] }])
}

export async function deleteNode(conn: AdConnection, nodeDN: string): Promise<void> {
  await conn.delete(nodeDN, true)
}

/**
 * Crea una zona. El objeto en AD alcanza para que los DC la repliquen, pero el
 * servicio DNS de cada servidor la toma recién en su próximo ciclo de carga.
 */
export async function createZone(
  conn: AdConnection,
  name: string,
  scope: ZoneScope
): Promise<string> {
  const container = zoneContainers(conn).find((c) => c.scope === scope)
  if (!container) throw new ConnectionError('Ámbito de replicación desconocido.')

  const dn = `DC=${escapeRDN(name)},${container.dn}`
  await conn.add(dn, { objectClass: ['top', 'dnsZone'], dc: [name] })

  // Una zona sin SOA ni NS no se carga: se crea el nodo raíz igual que hace Windows.
  const primary = conn.rootDSE.dnsHostName || conn.profile.host
  const soa = buildRecord({
    type: DNS_TYPE.SOA,
    ttl: 3600,
    fields: {
      serial: 1, refresh: 900, retry: 600, expire: 86400, minimum: 3600,
      primary, admin: `hostmaster.${name}`
    }
  })
  const ns = buildRecord({ type: DNS_TYPE.NS, ttl: 3600, fields: { host: primary } })
  await conn.add(`DC=@,${dn}`, { objectClass: ['top', 'dnsNode'], dc: ['@'], dnsRecord: [soa, ns] })

  return dn
}

export async function deleteZone(conn: AdConnection, zoneDN: string): Promise<void> {
  await conn.delete(zoneDN, true)
}

/** Servidores DNS del dominio: los DC que publican el SPN del servicio. */
export async function listDnsServers(conn: AdConnection): Promise<string[]> {
  const raw = await conn
    .searchRaw(conn.baseDN, {
      scope: 'sub',
      filter: '(&(objectCategory=computer)(servicePrincipalName=DNS/*))',
      attributes: ['dNSHostName', 'name']
    })
    .catch(() => [])
  return raw
    .map((e) => firstString(e, 'dNSHostName') ?? firstString(e, 'name') ?? '')
    .filter(Boolean)
    .sort()
}

/** Datos de la zona que se leen del propio nodo raíz (@). */
export async function zoneDetails(
  conn: AdConnection,
  zoneDN: string
): Promise<DnsZoneDetails> {
  const root = await conn.searchOne(`DC=@,${zoneDN}`, ['dnsRecord']).catch(() => null)
  const zone = await conn.searchOne(zoneDN, ['dNSProperty']).catch(() => null)

  const records = root
    ? (root.attrs.dnsRecord ?? [])
        .filter((v): v is Buffer => Buffer.isBuffer(v))
        .map(parseRecord)
        .filter((r): r is NonNullable<ReturnType<typeof parseRecord>> => !!r)
    : []

  const view = (r: (typeof records)[number]): DnsRecordView => ({
    type: r.type,
    typeName: r.typeName,
    ttl: r.ttl,
    data: r.data,
    fields: r.fields,
    static: r.timestamp === 0,
    raw: r.raw.toString('base64')
  })

  const props = readZoneProperties(zone?.attrs.dNSProperty ?? [])

  return {
    soa: records.filter((r) => r.type === DNS_TYPE.SOA).map(view)[0],
    ns: records.filter((r) => r.type === DNS_TYPE.NS).map(view),
    ...props
  }
}

/**
 * dNSProperty (MS-DNSP 2.3.2.1): DWORD dataLength, DWORD nameLength, DWORD flag,
 * DWORD version, DWORD id, y recién ahí los datos.
 */
const ZONE_PROP = {
  TYPE: 0x01,
  ALLOW_UPDATE: 0x02,
  NOREFRESH_INTERVAL: 0x10,
  REFRESH_INTERVAL: 0x20,
  AGING_STATE: 0x40
} as const

const UPDATE_LABELS: Record<number, string> = {
  0: 'No permitidas',
  1: 'Permitidas (no seguras y seguras)',
  2: 'Sólo actualizaciones seguras'
}

function readZoneProperties(values: (string | Buffer)[]): {
  aging: boolean
  noRefresh?: number
  refresh?: number
  updates?: string
  zoneType?: number
} {
  const out: { aging: boolean; noRefresh?: number; refresh?: number; updates?: string; zoneType?: number } = {
    aging: false
  }
  for (const v of values) {
    if (!Buffer.isBuffer(v) || v.length < 20) continue
    const dataLength = v.readUInt32LE(0)
    const id = v.readUInt32LE(16)
    // Las propiedades de un byte (ALLOW_UPDATE) igual traen el valor en el DWORD.
    if (dataLength === 0 || v.length < 24) continue
    const value = v.readUInt32LE(20)
    switch (id) {
      case ZONE_PROP.AGING_STATE: out.aging = value !== 0; break
      case ZONE_PROP.NOREFRESH_INTERVAL: out.noRefresh = value; break
      case ZONE_PROP.REFRESH_INTERVAL: out.refresh = value; break
      case ZONE_PROP.ALLOW_UPDATE: out.updates = UPDATE_LABELS[value] ?? `Valor ${value}`; break
      case ZONE_PROP.TYPE: out.zoneType = value; break
    }
  }
  return out
}

export { DNS_TYPE, TYPE_NAMES } from './record'
export type { RecordInput } from './record'
