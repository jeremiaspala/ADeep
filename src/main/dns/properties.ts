/**
 * `dNSProperty` (MS-DNSP 2.3.2.1). Cada valor es un blob con cabecera fija:
 *
 *   DWORD dataLength, DWORD nameLength, DWORD flag, DWORD version, DWORD id,
 *   BYTE  data[dataLength]
 *
 * **Ojo con `dataLength`:** hay que respetarlo. `ALLOW_UPDATE` suele venir con
 * `dataLength = 1`, y los tres bytes que siguen **no son cero**: son relleno del
 * DC. Leer el DWORD entero devuelve basura (`0x92758C02` en vez de `2`), y la
 * propiedad que más importa para seguridad queda ilegible. Verificado contra un
 * dominio real: cinco zonas de doce daban un valor sin sentido.
 */

export const ZONE_PROP = {
  TYPE: 0x01,
  ALLOW_UPDATE: 0x02,
  SECURE_TIME: 0x08,
  NOREFRESH_INTERVAL: 0x10,
  SCAVENGING_SERVERS: 0x11,
  AGING_ENABLED_TIME: 0x12,
  DELETED_FROM_HOSTNAME: 0x13,
  MASTER_SERVERS: 0x14,
  AUTO_NS_SERVERS: 0x15,
  DCPROMO_CONVERT: 0x16,
  SCAVENGING_SERVERS_DA: 0x17,
  MASTER_SERVERS_DA: 0x18,
  NS_SERVERS_DA: 0x19,
  NODE_DBFLAGS: 0x1a,
  REFRESH_INTERVAL: 0x20,
  AGING_STATE: 0x40
} as const

/** MS-DNSP 2.2.5.1.1 — dwZoneType. */
export const ZONE_TYPE_LABELS: Record<number, string> = {
  0: 'Caché',
  1: 'Principal',
  2: 'Secundaria',
  3: 'Rama (stub)',
  4: 'Reenvío condicional'
}

export const UPDATE_LABELS: Record<number, string> = {
  0: 'No permitidas',
  1: 'Permitidas: seguras y NO seguras',
  2: 'Sólo actualizaciones seguras'
}

export interface ZoneProperties {
  aging: boolean
  noRefresh?: number
  refresh?: number
  /** Valor crudo de ALLOW_UPDATE: 0 ninguna, 1 insegura, 2 sólo segura. */
  allowUpdate?: number
  updates?: string
  zoneType?: number
  zoneTypeLabel?: string
  /** Maestros de una zona secundaria, stub o de reenvío condicional. */
  masterServers: string[]
  scavengingServers: string[]
  agingEnabledSince?: number
}

/**
 * `DNS_ADDR_ARRAY` (MS-DNSP 2.2.3.2.3): cabecera de 32 bytes y después un
 * `DNS_ADDR` de 64 bytes por dirección, donde los primeros 16 son un
 * `sockaddr` (familia en LE, puerto, y la dirección).
 */
export function parseAddrArray(buf: Buffer): string[] {
  const out: string[] = []
  if (buf.length < 32) return out
  const count = buf.readUInt32LE(4)
  const size = buf.readUInt32LE(12) || 64
  for (let i = 0; i < count; i++) {
    const off = 32 + i * size
    if (off + 16 > buf.length) break
    const family = buf.readUInt16LE(off)
    if (family === 2) {
      out.push(`${buf[off + 4]}.${buf[off + 5]}.${buf[off + 6]}.${buf[off + 7]}`)
    } else if (family === 23) {
      const partes: string[] = []
      for (let j = 0; j < 8; j++) partes.push(buf.readUInt16BE(off + 8 + j * 2).toString(16))
      out.push(partes.join(':').replace(/(^|:)(0(:0)+)(:|$)/, '::'))
    }
  }
  return out
}

/**
 * Formato viejo: `IP4_ARRAY` (DWORD cantidad + DWORD por dirección, en LE).
 * Algunas zonas de dominios antiguos todavía lo usan para MASTER_SERVERS.
 */
export function parseIp4Array(buf: Buffer): string[] {
  const out: string[] = []
  if (buf.length < 4) return out
  const count = buf.readUInt32LE(0)
  for (let i = 0; i < count; i++) {
    const off = 4 + i * 4
    if (off + 4 > buf.length) break
    out.push([0, 1, 2, 3].map((b) => buf[off + b]).join('.'))
  }
  return out
}

export function readZoneProperties(values: (string | Buffer)[]): ZoneProperties {
  const out: ZoneProperties = { aging: false, masterServers: [], scavengingServers: [] }

  for (const v of values) {
    if (!Buffer.isBuffer(v) || v.length < 20) continue
    const dataLength = v.readUInt32LE(0)
    const id = v.readUInt32LE(16)
    const data = v.subarray(20)
    if (!data.length) continue

    /** Entero little-endian del largo que declara la propiedad, nunca más ancho. */
    const dword = (): number => {
      const n = Math.min(dataLength || data.length, data.length, 4)
      if (n >= 4) return data.readUInt32LE(0)
      if (n === 3) return data.readUInt16LE(0) | (data[2] << 16)
      if (n === 2) return data.readUInt16LE(0)
      return data[0]
    }

    switch (id) {
      case ZONE_PROP.AGING_STATE:
        out.aging = dword() !== 0
        break
      case ZONE_PROP.NOREFRESH_INTERVAL:
        out.noRefresh = dword()
        break
      case ZONE_PROP.REFRESH_INTERVAL:
        out.refresh = dword()
        break
      case ZONE_PROP.AGING_ENABLED_TIME:
        out.agingEnabledSince = dword()
        break
      case ZONE_PROP.ALLOW_UPDATE: {
        const value = dword()
        out.allowUpdate = value
        out.updates = UPDATE_LABELS[value] ?? `Valor ${value}`
        break
      }
      case ZONE_PROP.TYPE: {
        const value = dword()
        out.zoneType = value
        out.zoneTypeLabel = ZONE_TYPE_LABELS[value] ?? `Tipo ${value}`
        break
      }
      case ZONE_PROP.MASTER_SERVERS:
      case ZONE_PROP.MASTER_SERVERS_DA:
        out.masterServers = direcciones(data, dataLength)
        break
      case ZONE_PROP.SCAVENGING_SERVERS:
      case ZONE_PROP.SCAVENGING_SERVERS_DA:
        out.scavengingServers = direcciones(data, dataLength)
        break
    }
  }

  return out
}

/** Los dos formatos conviven; se elige por la pinta de la cabecera. */
function direcciones(data: Buffer, dataLength: number): string[] {
  const usable = data.subarray(0, Math.max(dataLength, 0) || data.length)
  const nuevo = parseAddrArray(usable)
  if (nuevo.length) return nuevo
  return parseIp4Array(usable)
}

/**
 * Arma el blob de una propiedad de un DWORD. La cabecera va con
 * `dataLength = 4`, `nameLength = 0`, `flag = 0` y `version = 1`, que es lo que
 * escribe el servidor DNS de Windows.
 */
export function buildDwordProperty(id: number, value: number): Buffer {
  const buf = Buffer.alloc(24)
  buf.writeUInt32LE(4, 0)
  buf.writeUInt32LE(0, 4)
  buf.writeUInt32LE(0, 8)
  buf.writeUInt32LE(1, 12)
  buf.writeUInt32LE(id, 16)
  buf.writeUInt32LE(value, 20)
  return buf
}

/**
 * Los 13 servidores raíz con sus direcciones vigentes.
 *
 * Tres cambiaron de IP y los root hints de un dominio viejo suelen quedar con
 * las de antes: `b` (2023), `d` (2013) y `h` (2015). La lista oficial está en
 * https://www.internic.net/domain/named.root — conviene contrastarla antes de
 * tocar nada, porque cambia cada varios años.
 */
export const ROOT_SERVERS: Record<string, { v4: string; v6: string }> = {
  'a.root-servers.net': { v4: '198.41.0.4', v6: '2001:503:ba3e::2:30' },
  'b.root-servers.net': { v4: '170.247.170.2', v6: '2801:1b8:10::b' },
  'c.root-servers.net': { v4: '192.33.4.12', v6: '2001:500:2::c' },
  'd.root-servers.net': { v4: '199.7.91.13', v6: '2001:500:2d::d' },
  'e.root-servers.net': { v4: '192.203.230.10', v6: '2001:500:a8::e' },
  'f.root-servers.net': { v4: '192.5.5.241', v6: '2001:500:2f::f' },
  'g.root-servers.net': { v4: '192.112.36.4', v6: '2001:500:12::d0d' },
  'h.root-servers.net': { v4: '198.97.190.53', v6: '2001:500:1::53' },
  'i.root-servers.net': { v4: '192.36.148.17', v6: '2001:7fe::53' },
  'j.root-servers.net': { v4: '192.58.128.30', v6: '2001:503:c27::2:30' },
  'k.root-servers.net': { v4: '193.0.14.129', v6: '2001:7fd::1' },
  'l.root-servers.net': { v4: '199.7.83.42', v6: '2001:500:9f::42' },
  'm.root-servers.net': { v4: '202.12.27.33', v6: '2001:dc3::35' }
}
