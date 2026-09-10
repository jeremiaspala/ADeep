/** Utilidades de formato compartidas por la UI. */

export function fmtDate(v?: string | Date | null): string {
  if (!v) return '—'
  const d = typeof v === 'string' ? new Date(v) : v
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleString('es-AR', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit'
  })
}

export function fmtDateOnly(v?: string | Date | null): string {
  if (!v) return '—'
  const d = typeof v === 'string' ? new Date(v) : v
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

/** FILETIME (string de 64 bits) a Date. */
export function filetimeToDate(value?: string): Date | null {
  if (!value) return null
  let v: bigint
  try { v = BigInt(value) } catch { return null }
  if (v === 0n || v >= 9223372036854775807n) return null
  const ms = v / 10000n - 11644473600000n
  const n = Number(ms)
  return Number.isFinite(n) ? new Date(n) : null
}

export function dateToFiletime(d: Date): string {
  return String((BigInt(d.getTime()) + 11644473600000n) * 10000n)
}

export function generalizedTimeToDate(value?: string): Date | null {
  if (!value) return null
  const m = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})/.exec(value)
  if (!m) return null
  return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]))
}

/** DC=corp,DC=local → corp.local */
export function dnToDomain(dn: string): string {
  return splitDN(dn)
    .filter((p) => p.toLowerCase().startsWith('dc='))
    .map((p) => p.slice(3))
    .join('.')
}

export function splitDN(dn: string): string[] {
  const parts: string[] = []
  let cur = ''
  let esc = false
  for (const ch of dn) {
    if (esc) { cur += ch; esc = false; continue }
    if (ch === '\\') { cur += ch; esc = true; continue }
    if (ch === ',') { parts.push(cur.trim()); cur = ''; continue }
    cur += ch
  }
  if (cur.trim()) parts.push(cur.trim())
  return parts
}

export function parentDN(dn: string): string {
  const p = splitDN(dn)
  return p.length > 1 ? p.slice(1).join(',') : ''
}

export function rdnValue(dn: string): string {
  const p = splitDN(dn)[0] ?? dn
  const i = p.indexOf('=')
  return unescapeRDN(i < 0 ? p : p.slice(i + 1))
}

export function rdnType(dn: string): string {
  const p = splitDN(dn)[0] ?? ''
  const i = p.indexOf('=')
  return i < 0 ? '' : p.slice(0, i)
}

export function unescapeRDN(v: string): string {
  let out = ''
  let esc = false
  for (let i = 0; i < v.length; i++) {
    const ch = v[i]
    if (esc) {
      if (/[0-9a-fA-F]/.test(ch) && /[0-9a-fA-F]/.test(v[i + 1] ?? '')) {
        out += String.fromCharCode(parseInt(ch + v[i + 1], 16)); i++
      } else out += ch
      esc = false
      continue
    }
    if (ch === '\\') { esc = true; continue }
    out += ch
  }
  return out
}

export function escapeRDN(v: string): string {
  let out = v.replace(/([\\,+"<>;=])/g, '\\$1')
  if (out.startsWith('#') || out.startsWith(' ')) out = '\\' + out
  if (out.endsWith(' ')) out = out.slice(0, -1) + '\\ '
  return out
}

export function escapeFilter(v: string): string {
  return v.replace(/[\\*()\0]/g, (c) =>
    ({ '\\': '\\5c', '*': '\\2a', '(': '\\28', ')': '\\29', '\0': '\\00' })[c] ?? c
  )
}

export function isDescendant(child: string, ancestor: string): boolean {
  const c = child.toLowerCase().replace(/\s*,\s*/g, ',')
  const a = ancestor.toLowerCase().replace(/\s*,\s*/g, ',')
  return c === a || c.endsWith(',' + a)
}

/** corp.local/Users/Jeremias */
export function dnToCanonical(dn: string): string {
  const parts = splitDN(dn)
  const dcs = parts.filter((p) => p.toLowerCase().startsWith('dc=')).map((p) => unescapeRDN(p.slice(3)))
  const rest = parts
    .filter((p) => !p.toLowerCase().startsWith('dc='))
    .map((p) => unescapeRDN(p.slice(p.indexOf('=') + 1)))
    .reverse()
  return [dcs.join('.'), ...rest].join('/')
}

/** Genera una contraseña que cumple la complejidad de AD. */
export function generatePassword(length = 16): string {
  const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ'
  const lower = 'abcdefghijkmnopqrstuvwxyz'
  const digits = '23456789'
  const symbols = '!@#$%&*?-_=+'
  const all = upper + lower + digits + symbols
  const pick = (set: string): string => set[Math.floor(Math.random() * set.length)]
  const out = [pick(upper), pick(lower), pick(digits), pick(symbols)]
  while (out.length < length) out.push(pick(all))
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out.join('')
}

export function bytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

/** Nivel funcional numérico → nombre de Windows Server. */
export const FUNCTIONAL_LEVELS: Record<number, string> = {
  0: 'Windows 2000',
  1: 'Windows Server 2003 provisional',
  2: 'Windows Server 2003',
  3: 'Windows Server 2008',
  4: 'Windows Server 2008 R2',
  5: 'Windows Server 2012',
  6: 'Windows Server 2012 R2',
  7: 'Windows Server 2016',
  8: 'Windows Server 2019',
  9: 'Windows Server 2022',
  10: 'Windows Server 2025'
}

export function functionalLevel(n?: number): string {
  if (n === undefined) return '—'
  return FUNCTIONAL_LEVELS[n] ?? `Nivel ${n}`
}
