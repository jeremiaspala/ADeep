/** Conversiones de tipos binarios de AD ↔ texto. */

/** objectSID binario → S-1-5-21-... */
export function sidToString(buf: Buffer): string {
  if (!buf || buf.length < 8) return ''
  const revision = buf.readUInt8(0)
  const subCount = buf.readUInt8(1)
  // Identifier authority: 6 bytes big-endian.
  let authority = 0n
  for (let i = 2; i < 8; i++) authority = (authority << 8n) | BigInt(buf.readUInt8(i))
  const parts: string[] = [`S-${revision}-${authority}`]
  for (let i = 0; i < subCount; i++) {
    const off = 8 + i * 4
    if (off + 4 > buf.length) break
    parts.push(String(buf.readUInt32LE(off)))
  }
  return parts.join('-')
}

/** S-1-5-21-... → Buffer */
export function stringToSid(sid: string): Buffer {
  const parts = sid.split('-')
  if (parts[0] !== 'S') throw new Error(`SID inválido: ${sid}`)
  const revision = Number(parts[1])
  const authority = BigInt(parts[2])
  const subs = parts.slice(3).map((s) => Number(s))
  const buf = Buffer.alloc(8 + subs.length * 4)
  buf.writeUInt8(revision, 0)
  buf.writeUInt8(subs.length, 1)
  for (let i = 0; i < 6; i++) {
    buf.writeUInt8(Number((authority >> BigInt((5 - i) * 8)) & 0xffn), 2 + i)
  }
  subs.forEach((s, i) => buf.writeUInt32LE(s >>> 0, 8 + i * 4))
  return buf
}

/** SID → filtro LDAP escapado (\XX por byte). */
export function sidToFilter(sid: string): string {
  return [...stringToSid(sid)].map((b) => '\\' + b.toString(16).padStart(2, '0')).join('')
}

/** objectGUID binario (mixed-endian) → {xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx} */
export function guidToString(buf: Buffer): string {
  if (!buf || buf.length !== 16) return ''
  const h = (n: number) => buf.readUInt8(n).toString(16).padStart(2, '0')
  return (
    `${h(3)}${h(2)}${h(1)}${h(0)}-${h(5)}${h(4)}-${h(7)}${h(6)}-` +
    `${h(8)}${h(9)}-${h(10)}${h(11)}${h(12)}${h(13)}${h(14)}${h(15)}`
  )
}

export function stringToGuid(guid: string): Buffer {
  const hex = guid.replace(/[{}-]/g, '')
  if (hex.length !== 32) throw new Error(`GUID inválido: ${guid}`)
  const b = Buffer.from(hex, 'hex')
  return Buffer.from([
    b[3], b[2], b[1], b[0],
    b[5], b[4],
    b[7], b[6],
    b[8], b[9], b[10], b[11], b[12], b[13], b[14], b[15]
  ])
}

export function guidToFilter(guid: string): string {
  return [...stringToGuid(guid)].map((b) => '\\' + b.toString(16).padStart(2, '0')).join('')
}

/** FILETIME (100ns desde 1601-01-01 UTC) → Date | null */
export function filetimeToDate(value: string | number | bigint): Date | null {
  const v = typeof value === 'bigint' ? value : BigInt(String(value))
  if (v === 0n) return null
  // 0x7FFFFFFFFFFFFFFF y 9223372036854775807 = "nunca".
  if (v >= 9223372036854775807n) return null
  const ms = v / 10000n - 11644473600000n
  const n = Number(ms)
  if (!Number.isFinite(n)) return null
  return new Date(n)
}

export function dateToFiletime(d: Date): string {
  return String((BigInt(d.getTime()) + 11644473600000n) * 10000n)
}

/** Intervalos negativos de AD (maxPwdAge, lockoutDuration) → minutos positivos. */
export function intervalToMinutes(value: string): number {
  const v = BigInt(value)
  if (v === 0n) return 0
  const abs = v < 0n ? -v : v
  if (abs >= 9223372036854775807n) return -1 // nunca
  return Number(abs / 600000000n)
}

export function intervalToDays(value: string): number {
  const min = intervalToMinutes(value)
  return min < 0 ? -1 : Math.round(min / 1440)
}

/** Generalized time de AD: 20240115093000.0Z */
export function generalizedTimeToDate(value: string): Date | null {
  const m = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(?:\.(\d+))?Z?$/.exec(value.trim())
  if (!m) return null
  return new Date(
    Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6], m[7] ? +m[7].slice(0, 3) : 0)
  )
}

export function dateToGeneralizedTime(d: Date): string {
  const p = (n: number, w = 2) => String(n).padStart(w, '0')
  return (
    `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}` +
    `${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}.0Z`
  )
}

/** unicodePwd: UTF-16LE entre comillas dobles. */
export function encodePassword(password: string): Buffer {
  return Buffer.from(`"${password}"`, 'utf16le')
}

/** Escapa un valor para usarlo dentro de un filtro LDAP (RFC 4515). */
export function escapeFilter(value: string): string {
  return value.replace(/[\\*()\0]/g, (c) => {
    switch (c) {
      case '\\': return '\\5c'
      case '*': return '\\2a'
      case '(': return '\\28'
      case ')': return '\\29'
      case '\0': return '\\00'
      default: return c
    }
  })
}

/** Escapa un componente RDN (RFC 4514). */
export function escapeRDN(value: string): string {
  let out = value.replace(/([\\,+"<>;=])/g, '\\$1')
  if (out.startsWith('#') || out.startsWith(' ')) out = '\\' + out
  if (out.endsWith(' ')) out = out.slice(0, -1) + '\\ '
  return out
}

export interface RDNPart {
  type: string
  value: string
}

/** Parte un DN en RDNs respetando escapes. */
export function splitDN(dn: string): string[] {
  const parts: string[] = []
  let cur = ''
  let esc = false
  let quoted = false
  for (const ch of dn) {
    if (esc) { cur += ch; esc = false; continue }
    if (ch === '\\') { cur += ch; esc = true; continue }
    if (ch === '"') { quoted = !quoted; cur += ch; continue }
    if (ch === ',' && !quoted) { parts.push(cur.trim()); cur = ''; continue }
    cur += ch
  }
  if (cur.trim()) parts.push(cur.trim())
  return parts
}

export function parseRDN(rdn: string): RDNPart {
  const i = rdn.indexOf('=')
  if (i < 0) return { type: '', value: rdn }
  return { type: rdn.slice(0, i).trim(), value: unescapeRDN(rdn.slice(i + 1).trim()) }
}

export function unescapeRDN(value: string): string {
  let out = ''
  let esc = false
  for (let i = 0; i < value.length; i++) {
    const ch = value[i]
    if (esc) {
      // \XX hexadecimal
      if (/[0-9a-fA-F]/.test(ch) && /[0-9a-fA-F]/.test(value[i + 1] ?? '')) {
        out += String.fromCharCode(parseInt(ch + value[i + 1], 16))
        i++
      } else out += ch
      esc = false
      continue
    }
    if (ch === '\\') { esc = true; continue }
    out += ch
  }
  return out
}

/** DN del padre. '' si es la raíz. */
export function parentDN(dn: string): string {
  const parts = splitDN(dn)
  return parts.length > 1 ? parts.slice(1).join(',') : ''
}

/** Valor del primer RDN, sin escapes. Ej: "CN=Jeremías, Palazzesi,OU=..." → "Jeremías, Palazzesi" */
export function rdnValue(dn: string): string {
  const parts = splitDN(dn)
  return parts.length ? parseRDN(parts[0]).value : dn
}

export function rdnType(dn: string): string {
  const parts = splitDN(dn)
  return parts.length ? parseRDN(parts[0]).type : ''
}

/** DC=corp,DC=local → corp.local */
export function dnToDomain(dn: string): string {
  return splitDN(dn)
    .map(parseRDN)
    .filter((p) => p.type.toLowerCase() === 'dc')
    .map((p) => p.value)
    .join('.')
}

export function domainToDN(domain: string): string {
  return domain.split('.').filter(Boolean).map((d) => `DC=${escapeRDN(d)}`).join(',')
}

/** ¿`child` está bajo `ancestor` (o es igual)? */
export function isDescendantDN(child: string, ancestor: string): boolean {
  const c = child.toLowerCase().replace(/\s*,\s*/g, ',')
  const a = ancestor.toLowerCase().replace(/\s*,\s*/g, ',')
  return c === a || c.endsWith(',' + a)
}

export function dnDepth(dn: string): number {
  return splitDN(dn).length
}

/** Canonical name estilo ADUC: corp.local/Users/Jeremias */
export function dnToCanonical(dn: string): string {
  const parts = splitDN(dn).map(parseRDN)
  const dcs = parts.filter((p) => p.type.toLowerCase() === 'dc').map((p) => p.value)
  const rest = parts.filter((p) => p.type.toLowerCase() !== 'dc').map((p) => p.value).reverse()
  return [dcs.join('.'), ...rest].join('/')
}
