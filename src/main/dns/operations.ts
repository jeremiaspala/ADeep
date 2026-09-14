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
import {
  buildDwordProperty, readZoneProperties, ROOT_SERVERS, UPDATE_LABELS, ZONE_PROP
} from './properties'
import type {
  DnsIssue, DnsNode, DnsRecordView, DnsReview, DnsRootHints, DnsZone, DnsZoneDetails
} from '../../shared/types'

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
      const props = readZoneProperties(e.attrs.dNSProperty ?? [])
      zones.push({
        dn: e.dn,
        name,
        scope,
        scopeLabel: SCOPE_LABELS[scope],
        reverse: name.toLowerCase().endsWith('.in-addr.arpa') || name.toLowerCase().endsWith('.ip6.arpa'),
        records: 0,
        zoneType: props.zoneType,
        zoneTypeLabel: props.zoneTypeLabel,
        allowUpdate: props.allowUpdate,
        updates: props.updates,
        aging: props.aging,
        masterServers: props.masterServers
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

export { DNS_TYPE, TYPE_NAMES } from './record'
export type { RecordInput } from './record'

/* ---------------- Seguridad de la zona ---------------- */

/**
 * Cambia `ALLOW_UPDATE`: 0 ninguna, 1 insegura, 2 sólo segura.
 *
 * Es el único ajuste de seguridad de una zona que vive en el directorio. El
 * resto (transferencias de zona, reenviadores globales, lista de bloqueo de
 * consultas globales) es configuración del servicio DNS, no del objeto, y no
 * se puede ni leer ni escribir por LDAP.
 */
export async function setZoneUpdates(
  conn: AdConnection,
  zoneDN: string,
  value: 0 | 1 | 2
): Promise<void> {
  const zone = await conn.searchOne(zoneDN, ['dNSProperty'])
  if (!zone) throw new ConnectionError('No se encontró la zona.')

  const actuales = (zone.attrs.dNSProperty ?? []).filter((v): v is Buffer => Buffer.isBuffer(v))
  const anterior = actuales.find(
    (b) => b.length >= 20 && b.readUInt32LE(16) === ZONE_PROP.ALLOW_UPDATE
  )
  const nuevo = buildDwordProperty(ZONE_PROP.ALLOW_UPDATE, value)

  // Reemplazar el blob exacto: la zona tiene varias propiedades en el mismo
  // atributo y un `replace` entero se llevaría puestas las demás.
  await conn.modify(
    zoneDN,
    anterior
      ? [
          { op: 'delete', attribute: 'dNSProperty', values: [anterior] },
          { op: 'add', attribute: 'dNSProperty', values: [nuevo] }
        ]
      : [{ op: 'add', attribute: 'dNSProperty', values: [nuevo] }]
  )
}

export { UPDATE_LABELS }

/* ---------------- Revisión de seguridad ---------------- */

/** Tipos cuyo dato es un nombre que debería resolver en algún lado. */
const APUNTAN_A_NOMBRE = new Set<number>([
  DNS_TYPE.PTR, DNS_TYPE.CNAME, DNS_TYPE.NS, DNS_TYPE.MX, DNS_TYPE.SRV
])

function objetivo(r: DnsRecordView): string | undefined {
  const v = r.fields.host ?? r.fields.exchange ?? r.fields.target
  return typeof v === 'string' ? v.replace(/\.$/, '').toLowerCase() : undefined
}

/**
 * Revisión de sólo lectura sobre lo que DNS guarda en el directorio.
 *
 * Deliberadamente **no** inventa hallazgos sobre cosas que no están en LDAP:
 * las transferencias de zona, los reenviadores globales y la lista de bloqueo
 * de consultas globales viven en el servicio DNS y desde acá no se ven.
 */
export async function review(conn: AdConnection): Promise<DnsReview> {
  const [zones, rootHints] = await Promise.all([listZones(conn), listRootHints(conn)])
  const issues: DnsIssue[] = []
  let recordsChecked = 0

  /* Índice de todo lo que el dominio resuelve, para detectar punteros colgados. */
  const existentes = new Set<string>()
  const porZona = new Map<string, DnsNode[]>()
  const nombresDeZona = zones.map((z) => z.name.toLowerCase())

  for (const z of zones) {
    const nodes = await listNodes(conn, z.dn).catch(() => [])
    porZona.set(z.dn, nodes)
    for (const n of nodes) {
      const fqdn = n.fqdn.toLowerCase()
      if (n.records.some((r) => r.type === DNS_TYPE.A || r.type === DNS_TYPE.AAAA || r.type === DNS_TYPE.CNAME)) {
        existentes.add(fqdn)
      }
    }
  }

  for (const z of zones) {
    const nodes = porZona.get(z.dn) ?? []
    const total = nodes.reduce((a, n) => a + n.records.length, 0)
    recordsChecked += total

    if (z.allowUpdate === 1) {
      issues.push({
        id: `${z.name}:updates-inseguras`,
        severity: 'alta',
        zone: z.name,
        label: 'Actualizaciones dinámicas NO seguras',
        detail:
          'Cualquier equipo que llegue al servidor DNS puede crear o pisar registros de esta zona ' +
          'sin autenticarse. Es el camino directo para secuestrar un nombre (WPAD, un servidor de ' +
          'archivos, un DC) y quedar en el medio del tráfico. Debería estar en «sólo actualizaciones ' +
          'seguras», que exige que el equipo sea dueño del registro.'
      })
    } else if (z.allowUpdate === undefined && !z.reverse) {
      issues.push({
        id: `${z.name}:updates-desconocidas`,
        severity: 'baja',
        zone: z.name,
        label: 'No se pudo leer la política de actualizaciones',
        detail: 'La zona no tiene la propiedad ALLOW_UPDATE en el directorio. Revisala en la consola del servidor DNS.'
      })
    }

    if (!z.aging && total > 50) {
      issues.push({
        id: `${z.name}:sin-envejecimiento`,
        severity: 'baja',
        zone: z.name,
        label: 'Envejecimiento desactivado',
        detail:
          `La zona tiene ${total} registros y no limpia los obsoletos. Los nombres de equipos que ya ` +
          'no existen quedan resolviendo para siempre, y tarde o temprano una IP reutilizada apunta ' +
          'al lugar equivocado.'
      })
    }

    for (const n of nodes) {
      const tipos = new Set(n.records.map((r) => r.type))

      if (n.name === '*') {
        issues.push({
          id: `${z.name}:comodin`,
          severity: 'media',
          zone: z.name,
          record: '*',
          label: 'Registro comodín',
          detail:
            'Un comodín hace que cualquier nombre inexistente de la zona resuelva igual. Enmascara ' +
            'errores de configuración y le da una respuesta válida a nombres que deberían fallar.'
        })
      }

      if (/^(wpad|isatap)$/i.test(n.name)) {
        issues.push({
          id: `${z.name}:${n.name}`,
          severity: 'media',
          zone: z.name,
          record: n.name,
          label: `Registro ${n.name.toLowerCase()} publicado`,
          detail:
            n.name.toLowerCase() === 'wpad'
              ? 'WPAD le dice a los clientes por qué proxy salir. Publicado en DNS y resolviendo, ' +
                'quien controle ese destino ve y modifica el tráfico web del dominio. Confirmá que ' +
                'apunta a un servidor propio y que es intencional.'
              : 'ISATAP crea túneles IPv6 sobre IPv4 de forma automática. Si no se usa a propósito, ' +
                'conviene sacarlo: es una ruta de red que nadie está mirando.'
        })
      }

      // CNAME no puede convivir con otros tipos en el mismo nombre (RFC 1034 3.6.2).
      if (tipos.has(DNS_TYPE.CNAME) && tipos.size > 1) {
        issues.push({
          id: `${z.name}:${n.name}:cname-mixto`,
          severity: 'media',
          zone: z.name,
          record: n.name,
          label: 'CNAME conviviendo con otros registros',
          detail:
            'Un nombre con CNAME no puede tener ningún otro tipo. La resolución queda indefinida y ' +
            'cada servidor responde lo que le parece.'
        })
      }

      for (const r of n.records) {
        if (!APUNTAN_A_NOMBRE.has(r.type)) continue
        const dest = objetivo(r)
        if (!dest) continue
        // Sólo se puede afirmar algo de los nombres de los que el dominio es autoridad.
        const propio = nombresDeZona.some((zn) => dest === zn || dest.endsWith(`.${zn}`))
        if (!propio || existentes.has(dest)) continue
        issues.push({
          id: `${z.name}:${n.name}:${r.typeName}:${dest}`,
          severity: 'media',
          zone: z.name,
          record: n.name,
          label: `${r.typeName} apunta a un nombre que no existe`,
          detail:
            `${n.fqdn} → ${dest}, y el dominio es autoridad de ese nombre pero no tiene ningún ` +
            'registro para él. Es un puntero colgado: sobra, o falta el registro del otro lado.'
        })
      }
    }
  }

  /*
   * Root hints. Sólo se consultan cuando el servidor resuelve por su cuenta
   * hasta la raíz: si tiene reenviadores globales configurados —que viven en el
   * servicio, no en el directorio— nunca se usan. Por eso van como observación
   * media y el texto lo aclara, en vez de dar a entender que el DNS está roto.
   */
  for (const rh of rootHints) {
    const viejos = rh.servers.filter((s) => s.stale)
    if (viejos.length) {
      issues.push({
        id: `roothints:${rh.scope}:viejos`,
        severity: 'media',
        zone: `Root hints (${rh.scopeLabel})`,
        label: `${viejos.length} servidor(es) raíz con la dirección vieja`,
        detail:
          viejos.map((s) => `${s.name}: ${s.addresses.join(', ')} → ${s.expected}`).join(' · ') +
          '. Sólo importa si estos servidores resuelven por su cuenta hasta la raíz; si usan ' +
          'reenviadores, los root hints no se consultan nunca. Los reenviadores globales no están ' +
          'en el directorio, así que desde acá no se puede saber cuál es el caso. Contrastá con ' +
          'https://www.internic.net/domain/named.root antes de corregir.'
      })
    }
    if (rh.missing.length) {
      issues.push({
        id: `roothints:${rh.scope}:faltan`,
        severity: 'baja',
        zone: `Root hints (${rh.scopeLabel})`,
        label: `Faltan ${rh.missing.length} de los 13 servidores raíz`,
        detail:
          'No están: ' + rh.missing.join(', ') +
          '. Con los que quedan alcanza para resolver, pero la redundancia es menor de la que ' +
          'debería. Suele pasar cuando la lista se copió de una versión vieja de Windows.'
      })
    }
  }

  if (rootHints.length > 1) {
    const cuentas = rootHints.map((r) => `${r.scopeLabel}: ${r.servers.length}`).join(' · ')
    const distintas = new Set(rootHints.map((r) => r.servers.length)).size > 1
    if (distintas) {
      issues.push({
        id: 'roothints:copias',
        severity: 'baja',
        zone: 'Root hints',
        label: 'Hay copias de los root hints que no coinciden',
        detail:
          `${cuentas}. Cada partición tiene su propia copia y los servidores usan la de la suya, ` +
          'así que dos DC pueden arrancar la resolución con listas distintas.'
      })
    }
  }

  const orden = { alta: 0, media: 1, baja: 2 }
  issues.sort((a, b) => orden[a.severity] - orden[b.severity] || a.zone.localeCompare(b.zone))
  return { issues, zonesChecked: zones.length, recordsChecked, rootHints }
}

/* ---------------- Root hints ---------------- */

/**
 * `CN=RootDNSServers` es la zona de caché con los servidores raíz. `listZones`
 * la saltea a propósito —no es una zona administrable— pero su contenido sí
 * importa: si las direcciones quedaron viejas, la resolución recursiva arranca
 * probando servidores que ya no están.
 *
 * Puede haber una copia por partición y no tienen por qué coincidir.
 */
export async function listRootHints(conn: AdConnection): Promise<DnsRootHints[]> {
  const out: DnsRootHints[] = []

  for (const { scope, dn } of zoneContainers(conn)) {
    const zonas = await conn
      .searchRaw(dn, { scope: 'one', filter: '(name=RootDNSServers)', attributes: ['name'] })
      .catch(() => [])

    for (const z of zonas) {
      const nodos = await conn
        .searchRaw(z.dn, {
          scope: 'one', filter: '(objectClass=dnsNode)', attributes: ['name', 'dnsRecord'], pageSize: 500
        })
        .catch(() => [])

      const nombres = new Set<string>()
      const direcciones = new Map<string, string[]>()

      for (const n of nodos) {
        const nodo = (firstString(n, 'name') ?? '').toLowerCase()
        for (const raw of n.attrs.dnsRecord ?? []) {
          if (!Buffer.isBuffer(raw)) continue
          const r = parseRecord(raw)
          if (!r) continue
          if (r.type === DNS_TYPE.NS) nombres.add(r.data.replace(/\.$/, '').toLowerCase())
          else if (r.type === DNS_TYPE.A || r.type === DNS_TYPE.AAAA) {
            // El glue cuelga del nombre del servidor, no de la raíz.
            const clave = nodo === '@' ? '' : nodo
            if (clave) direcciones.set(clave, [...(direcciones.get(clave) ?? []), r.data])
          }
        }
      }

      const servers = [...nombres].sort().map((name) => {
        const corto = name.split('.')[0]
        const addrs = direcciones.get(name) ?? direcciones.get(corto) ?? []
        const esperado = ROOT_SERVERS[name]?.v4
        return {
          name,
          addresses: addrs,
          expected: esperado,
          // Sólo se puede afirmar que está vieja si hay una dirección IPv4 y no coincide.
          stale: !!esperado && addrs.some((a) => a.includes('.')) && !addrs.includes(esperado)
        }
      })

      out.push({
        dn: z.dn,
        scope,
        scopeLabel: SCOPE_LABELS[scope],
        servers,
        missing: Object.keys(ROOT_SERVERS).filter((n) => !nombres.has(n))
      })
    }
  }

  return out
}

export interface RootHintFix {
  /** Qué se hizo, en orden, para poder mostrarlo y registrarlo. */
  cambios: string[]
  /** Blobs previos de todo lo que se tocó, por si hay que volver atrás. */
  respaldo: { nodeDN: string; base64: string; data: string }[]
}

/**
 * Deja los root hints iguales a la lista oficial: corrige las direcciones que
 * quedaron viejas y agrega los servidores que falten, con su NS y su glue.
 *
 * **Nunca borra.** Si la zona tiene un NS o una dirección que no está en la
 * lista, se deja: puede ser un servidor raíz interno de una red aislada, y
 * romper la resolución por prolijidad sería peor que el problema.
 */
export async function fixRootHints(conn: AdConnection, zoneDN: string): Promise<RootHintFix> {
  const out: RootHintFix = { cambios: [], respaldo: [] }

  const raizDN = `DC=@,${zoneDN}`
  const raiz = await conn.searchOne(raizDN, ['dnsRecord']).catch(() => null)
  const nsActuales = new Set(
    (raiz?.attrs.dnsRecord ?? [])
      .filter((v): v is Buffer => Buffer.isBuffer(v))
      .map(parseRecord)
      .filter((r) => r?.type === DNS_TYPE.NS)
      .map((r) => r!.data.replace(/\.$/, '').toLowerCase())
  )

  for (const [nombre, dirs] of Object.entries(ROOT_SERVERS)) {
    if (!nsActuales.has(nombre)) {
      await addRecord(conn, zoneDN, '@', { type: DNS_TYPE.NS, ttl: 3600000, fields: { host: nombre } })
      out.cambios.push(`NS agregado: ${nombre}`)
    }

    const nodoDN = `DC=${escapeRDN(nombre)},${zoneDN}`
    const nodo = await conn.searchOne(nodoDN, ['dnsRecord']).catch(() => null)
    const aes = (nodo?.attrs.dnsRecord ?? [])
      .filter((v): v is Buffer => Buffer.isBuffer(v))
      .map((b) => ({ buf: b, rec: parseRecord(b) }))
      .filter((x) => x.rec?.type === DNS_TYPE.A)

    if (!aes.length) {
      await addRecord(conn, zoneDN, nombre, {
        type: DNS_TYPE.A, ttl: 3600000, fields: { address: dirs.v4 }
      })
      out.cambios.push(`A agregado: ${nombre} → ${dirs.v4}`)
      continue
    }

    const correcto = aes.find((x) => x.rec!.data === dirs.v4)
    if (correcto) continue

    // Hay dirección pero no es la vigente: se reemplaza el valor exacto.
    for (const viejo of aes) {
      out.respaldo.push({ nodeDN: nodoDN, base64: viejo.buf.toString('base64'), data: viejo.rec!.data })
      await replaceRecord(conn, nodoDN, viejo.buf.toString('base64'), {
        type: DNS_TYPE.A, ttl: viejo.rec!.ttl || 3600000, fields: { address: dirs.v4 }
      })
      out.cambios.push(`A corregido: ${nombre} ${viejo.rec!.data} → ${dirs.v4}`)
    }
  }

  return out
}
