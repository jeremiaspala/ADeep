/**
 * Códec del atributo `dnsRecord` (MS-DNSP 2.3.2.2), verificado contra un dominio real.
 *
 *   USHORT wDataLength      // largo de Data
 *   USHORT wType            // 1=A, 2=NS, 5=CNAME, 6=SOA, 12=PTR, 15=MX, 16=TXT, 28=AAAA, 33=SRV
 *   DWORD  dwFlags          // versión (byte bajo) + rango
 *   DWORD  dwSerial
 *   DWORD  dwTtlSeconds     // BIG ENDIAN, a diferencia del resto
 *   DWORD  dwReserved
 *   DWORD  dwTimeStamp      // horas desde 1601; 0 = registro estático
 *   BYTE   Data[wDataLength]
 *
 * Los nombres van en DNS_COUNT_NAME: [largo total][cantidad de etiquetas] y después
 * cada etiqueta como [largo][bytes], terminando en un 0.
 */

export const DNS_TYPE = {
  ZERO: 0x0000,
  A: 0x0001,
  NS: 0x0002,
  CNAME: 0x0005,
  SOA: 0x0006,
  PTR: 0x000c,
  MX: 0x000f,
  TXT: 0x0010,
  AAAA: 0x001c,
  SRV: 0x0021
} as const

export const TYPE_NAMES: Record<number, string> = {
  0: 'Tombstone',
  1: 'A',
  2: 'NS',
  5: 'CNAME',
  6: 'SOA',
  12: 'PTR',
  15: 'MX',
  16: 'TXT',
  28: 'AAAA',
  33: 'SRV'
}

export interface DnsRecord {
  type: number
  typeName: string
  ttl: number
  serial: number
  /** Horas desde 1601. 0 = estático (no envejece). */
  timestamp: number
  /** Representación en texto, la misma que muestra la consola de Windows. */
  data: string
  /** Campos sueltos según el tipo, para los formularios. */
  fields: Record<string, string | number>
  /** El blob original, para poder borrar exactamente este valor. */
  raw: Buffer
}

const HEADER = 24

export function parseRecord(buf: Buffer): DnsRecord | null {
  if (!buf || buf.length < HEADER) return null
  const dataLength = buf.readUInt16LE(0)
  const type = buf.readUInt16LE(2)
  const serial = buf.readUInt32LE(8)
  const ttl = buf.readUInt32BE(12)
  const timestamp = buf.readUInt32LE(20)
  const data = buf.subarray(HEADER, Math.min(HEADER + dataLength, buf.length))

  const record: DnsRecord = {
    type,
    typeName: TYPE_NAMES[type] ?? `Tipo ${type}`,
    ttl,
    serial,
    timestamp,
    data: '',
    fields: {},
    raw: buf
  }

  try {
    switch (type) {
      case DNS_TYPE.A:
        record.fields.address = [...data.subarray(0, 4)].join('.')
        record.data = String(record.fields.address)
        break

      case DNS_TYPE.AAAA:
        record.fields.address = formatIpv6(data.subarray(0, 16))
        record.data = String(record.fields.address)
        break

      case DNS_TYPE.NS:
      case DNS_TYPE.CNAME:
      case DNS_TYPE.PTR: {
        const name = readCountName(data, 0)
        record.fields.host = name.value
        record.data = name.value
        break
      }

      case DNS_TYPE.SOA: {
        const soaSerial = data.readUInt32BE(0)
        const refresh = data.readUInt32BE(4)
        const retry = data.readUInt32BE(8)
        const expire = data.readUInt32BE(12)
        const minimum = data.readUInt32BE(16)
        const primary = readCountName(data, 20)
        const admin = readCountName(data, primary.next)
        Object.assign(record.fields, {
          serial: soaSerial, refresh, retry, expire, minimum,
          primary: primary.value, admin: admin.value
        })
        record.data = `${primary.value} ${admin.value} (${soaSerial})`
        break
      }

      case DNS_TYPE.MX: {
        const preference = data.readUInt16BE(0)
        const exchange = readCountName(data, 2)
        record.fields.preference = preference
        record.fields.exchange = exchange.value
        record.data = `[${preference}] ${exchange.value}`
        break
      }

      case DNS_TYPE.TXT: {
        const parts: string[] = []
        let p = 0
        while (p < data.length) {
          const len = data.readUInt8(p)
          if (!len || p + 1 + len > data.length) break
          parts.push(data.subarray(p + 1, p + 1 + len).toString('utf8'))
          p += 1 + len
        }
        record.fields.text = parts.join('')
        record.data = parts.join('')
        break
      }

      case DNS_TYPE.SRV: {
        const priority = data.readUInt16BE(0)
        const weight = data.readUInt16BE(2)
        const port = data.readUInt16BE(4)
        const target = readCountName(data, 6)
        Object.assign(record.fields, { priority, weight, port, target: target.value })
        record.data = `[${priority}][${weight}][${port}] ${target.value}`
        break
      }

      default:
        record.data = data.toString('hex')
    }
  } catch {
    record.data = '(no se pudo interpretar)'
  }

  return record
}

export interface RecordInput {
  type: number
  ttl: number
  fields: Record<string, string | number>
}

export function buildRecord(input: RecordInput): Buffer {
  const data = buildData(input)
  const buf = Buffer.alloc(HEADER + data.length)
  buf.writeUInt16LE(data.length, 0)
  buf.writeUInt16LE(input.type, 2)
  // Rango 0xf0 = DNS_RANK_ZONE, que es lo que usa un registro estático de la zona.
  buf.writeUInt32LE(0x0000f005, 4)
  buf.writeUInt32LE(0, 8)
  buf.writeUInt32BE(input.ttl, 12)
  buf.writeUInt32LE(0, 16)
  // timeStamp 0 = estático: no lo borra el proceso de limpieza (aging).
  buf.writeUInt32LE(0, 20)
  data.copy(buf, HEADER)
  return buf
}

function buildData(input: RecordInput): Buffer {
  const f = input.fields
  switch (input.type) {
    case DNS_TYPE.A: {
      const parts = String(f.address ?? '').split('.').map(Number)
      if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
        throw new Error(`Dirección IPv4 inválida: ${String(f.address)}`)
      }
      return Buffer.from(parts)
    }

    case DNS_TYPE.AAAA:
      return parseIpv6(String(f.address ?? ''))

    case DNS_TYPE.NS:
    case DNS_TYPE.CNAME:
    case DNS_TYPE.PTR:
      return writeCountName(String(f.host ?? ''))

    case DNS_TYPE.MX: {
      const pref = Buffer.alloc(2)
      pref.writeUInt16BE(Number(f.preference ?? 10), 0)
      return Buffer.concat([pref, writeCountName(String(f.exchange ?? ''))])
    }

    case DNS_TYPE.TXT: {
      const text = String(f.text ?? '')
      const chunks: Buffer[] = []
      for (let i = 0; i < text.length || i === 0; i += 255) {
        const part = Buffer.from(text.slice(i, i + 255), 'utf8')
        chunks.push(Buffer.concat([Buffer.from([part.length]), part]))
        if (!text.length) break
      }
      return Buffer.concat(chunks)
    }

    case DNS_TYPE.SRV: {
      const head = Buffer.alloc(6)
      head.writeUInt16BE(Number(f.priority ?? 0), 0)
      head.writeUInt16BE(Number(f.weight ?? 0), 2)
      head.writeUInt16BE(Number(f.port ?? 0), 4)
      return Buffer.concat([head, writeCountName(String(f.target ?? ''))])
    }

    case DNS_TYPE.SOA: {
      const head = Buffer.alloc(20)
      head.writeUInt32BE(Number(f.serial ?? 1), 0)
      head.writeUInt32BE(Number(f.refresh ?? 900), 4)
      head.writeUInt32BE(Number(f.retry ?? 600), 8)
      head.writeUInt32BE(Number(f.expire ?? 86400), 12)
      head.writeUInt32BE(Number(f.minimum ?? 3600), 16)
      return Buffer.concat([
        head,
        writeCountName(String(f.primary ?? '')),
        writeCountName(String(f.admin ?? ''))
      ])
    }

    default:
      throw new Error(`No se puede construir un registro de tipo ${input.type}`)
  }
}

/* ---------------- DNS_COUNT_NAME ---------------- */

function readCountName(buf: Buffer, offset: number): { value: string; next: number } {
  if (offset + 2 > buf.length) return { value: '', next: offset }
  const total = buf.readUInt8(offset)
  const labelCount = buf.readUInt8(offset + 1)
  const labels: string[] = []
  let p = offset + 2
  for (let i = 0; i < labelCount && p < buf.length; i++) {
    const len = buf.readUInt8(p)
    if (!len || p + 1 + len > buf.length) break
    labels.push(buf.subarray(p + 1, p + 1 + len).toString('utf8'))
    p += 1 + len
  }
  return { value: labels.join('.'), next: offset + 2 + total }
}

function writeCountName(name: string): Buffer {
  const labels = name.replace(/\.$/, '').split('.').filter(Boolean)
  const parts: Buffer[] = []
  for (const label of labels) {
    const b = Buffer.from(label, 'utf8')
    if (b.length > 63) throw new Error(`Etiqueta DNS demasiado larga: ${label}`)
    parts.push(Buffer.concat([Buffer.from([b.length]), b]))
  }
  // El nombre termina con un byte 0, que también cuenta en el largo total.
  parts.push(Buffer.from([0]))
  const body = Buffer.concat(parts)
  return Buffer.concat([Buffer.from([body.length, labels.length]), body])
}

/* ---------------- IPv6 ---------------- */

function formatIpv6(buf: Buffer): string {
  const groups: string[] = []
  for (let i = 0; i < 16; i += 2) groups.push(buf.readUInt16BE(i).toString(16))
  // Compresión del tramo de ceros más largo (::).
  let best = { start: -1, len: 0 }
  let cur = { start: -1, len: 0 }
  groups.forEach((g, i) => {
    if (g === '0') {
      if (cur.start < 0) cur = { start: i, len: 1 }
      else cur.len++
      if (cur.len > best.len) best = { ...cur }
    } else cur = { start: -1, len: 0 }
  })
  if (best.len < 2) return groups.join(':')
  return `${groups.slice(0, best.start).join(':')}::${groups.slice(best.start + best.len).join(':')}`
}

function parseIpv6(value: string): Buffer {
  const [head, tail] = value.split('::')
  const left = head ? head.split(':').filter(Boolean) : []
  const right = tail ? tail.split(':').filter(Boolean) : []
  const missing = 8 - left.length - right.length
  if (missing < 0 || (!value.includes('::') && left.length !== 8)) {
    throw new Error(`Dirección IPv6 inválida: ${value}`)
  }
  const groups = [...left, ...Array<string>(value.includes('::') ? missing : 0).fill('0'), ...right]
  const buf = Buffer.alloc(16)
  groups.forEach((g, i) => {
    const n = parseInt(g, 16)
    if (Number.isNaN(n) || n < 0 || n > 0xffff) throw new Error(`Dirección IPv6 inválida: ${value}`)
    buf.writeUInt16BE(n, i * 2)
  })
  return buf
}
