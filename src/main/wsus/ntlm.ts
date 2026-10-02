/**
 * NTLMv2 para HTTP (MS-NLMP). Sólo autenticación: IIS no pide firma ni sellado
 * sobre HTTPS, así que no hace falta derivar claves de sesión.
 */
import { createHash, createHmac, randomBytes, type X509Certificate } from 'node:crypto'

const SIGNATURE = Buffer.from('NTLMSSP\0', 'latin1')

const NEGOTIATE_UNICODE = 0x00000001
const REQUEST_TARGET = 0x00000004
const NEGOTIATE_NTLM = 0x00000200
const ALWAYS_SIGN = 0x00008000
const EXTENDED_SESSIONSECURITY = 0x00080000
const NEGOTIATE_TARGET_INFO = 0x00800000
const NEGOTIATE_128 = 0x20000000
const NEGOTIATE_56 = 0x80000000

const FLAGS =
  NEGOTIATE_UNICODE | REQUEST_TARGET | NEGOTIATE_NTLM | ALWAYS_SIGN |
  EXTENDED_SESSIONSECURITY | NEGOTIATE_TARGET_INFO | NEGOTIATE_128 | NEGOTIATE_56

const AV_EOL = 0
const AV_TIMESTAMP = 7
const AV_TARGET_NAME = 9
const AV_CHANNEL_BINDINGS = 10

export interface NtlmCredentials {
  user: string
  domain: string
  password: string
}

/**
 * Acepta las tres formas que admite el perfil LDAP. Con UPN el dominio va vacío
 * y el usuario completo: así lo resuelve el DC sin tener que adivinar el NetBIOS.
 */
export function credentialsFrom(bindName: string, password: string, netbios?: string): NtlmCredentials {
  const slash = bindName.indexOf('\\')
  if (slash > 0) return { domain: bindName.slice(0, slash), user: bindName.slice(slash + 1), password }
  if (bindName.includes('@')) return { domain: '', user: bindName, password }
  const cn = /^CN=([^,]+),/i.exec(bindName)
  return { domain: netbios ?? '', user: cn ? cn[1] : bindName, password }
}

export function negotiateMessage(): Buffer {
  const b = Buffer.alloc(32)
  SIGNATURE.copy(b, 0)
  b.writeUInt32LE(1, 8)
  b.writeUInt32LE(FLAGS >>> 0, 12)
  return b
}

interface Challenge {
  flags: number
  serverChallenge: Buffer
  targetInfo: Buffer
}

function parseChallenge(msg: Buffer): Challenge {
  if (msg.length < 32 || !msg.subarray(0, 8).equals(SIGNATURE) || msg.readUInt32LE(8) !== 2) {
    throw new Error('El servidor no devolvió un desafío NTLM válido.')
  }
  const flags = msg.readUInt32LE(20)
  const serverChallenge = Buffer.from(msg.subarray(24, 32))
  let targetInfo = Buffer.alloc(0)
  if (msg.length >= 48) {
    const len = msg.readUInt16LE(40)
    const off = msg.readUInt32LE(44)
    targetInfo = Buffer.from(msg.subarray(off, off + len))
  }
  return { flags, serverChallenge, targetInfo }
}

function parseAvPairs(info: Buffer): Map<number, Buffer> {
  const out = new Map<number, Buffer>()
  let p = 0
  while (p + 4 <= info.length) {
    const id = info.readUInt16LE(p)
    const len = info.readUInt16LE(p + 2)
    if (id === AV_EOL) break
    out.set(id, Buffer.from(info.subarray(p + 4, p + 4 + len)))
    p += 4 + len
  }
  return out
}

function avPair(id: number, value: Buffer): Buffer {
  const h = Buffer.alloc(4)
  h.writeUInt16LE(id, 0)
  h.writeUInt16LE(value.length, 2)
  return Buffer.concat([h, value])
}

/**
 * Enlace al canal TLS (RFC 5929, «tls-server-end-point»). Si IIS tiene la
 * protección extendida activada rechaza cualquier respuesta que no lo traiga.
 */
export function channelBindingHash(cert: X509Certificate): Buffer {
  const der = cert.raw
  const alg = /sha-?(384|512)/i.exec(String((cert as unknown as { signatureAlgorithm?: string }).signatureAlgorithm ?? ''))
  const hash = createHash(alg ? `sha${alg[1]}` : 'sha256').update(der).digest()
  const appData = Buffer.concat([Buffer.from('tls-server-end-point:', 'latin1'), hash])
  const struct = Buffer.alloc(20 + appData.length)
  struct.writeUInt32LE(appData.length, 16)
  appData.copy(struct, 20)
  return createHash('md5').update(struct).digest()
}

function utf16(s: string): Buffer {
  return Buffer.from(s, 'utf16le')
}

export function authenticateMessage(
  challengeMsg: Buffer,
  cred: NtlmCredentials,
  opts: { spn?: string; channelBinding?: Buffer } = {}
): Buffer {
  const ch = parseChallenge(challengeMsg)
  const av = parseAvPairs(ch.targetInfo)

  const timestamp = av.get(AV_TIMESTAMP) ?? fileTimeNow()
  const pairs: Buffer[] = []
  for (const [id, value] of av) {
    if (id === AV_TARGET_NAME || id === AV_CHANNEL_BINDINGS) continue
    pairs.push(avPair(id, value))
  }
  if (opts.spn) pairs.push(avPair(AV_TARGET_NAME, utf16(opts.spn)))
  pairs.push(avPair(AV_CHANNEL_BINDINGS, opts.channelBinding ?? Buffer.alloc(16)))
  pairs.push(Buffer.alloc(4))
  const targetInfo = Buffer.concat(pairs)

  const ntHash = md4(utf16(cred.password))
  const ntowf = createHmac('md5', ntHash).update(utf16(cred.user.toUpperCase() + cred.domain)).digest()
  const clientChallenge = randomBytes(8)
  const temp = Buffer.concat([
    Buffer.from([1, 1, 0, 0, 0, 0, 0, 0]),
    timestamp,
    clientChallenge,
    Buffer.alloc(4),
    targetInfo,
    Buffer.alloc(4)
  ])
  const proof = createHmac('md5', ntowf).update(Buffer.concat([ch.serverChallenge, temp])).digest()
  const nt = Buffer.concat([proof, temp])
  // Con marca de tiempo del servidor, la respuesta LMv2 va en ceros (MS-NLMP 3.1.5.1.2).
  const lm = Buffer.alloc(24)

  const domain = utf16(cred.domain)
  const user = utf16(cred.user)
  const workstation = utf16('ADEEP')
  const flags = (FLAGS & ch.flags) | NEGOTIATE_UNICODE

  const header = Buffer.alloc(64)
  SIGNATURE.copy(header, 0)
  header.writeUInt32LE(3, 8)
  let off = 64
  const fields: [number, Buffer][] = [[12, lm], [20, nt], [28, domain], [36, user], [44, workstation], [52, Buffer.alloc(0)]]
  for (const [pos, data] of fields) {
    header.writeUInt16LE(data.length, pos)
    header.writeUInt16LE(data.length, pos + 2)
    header.writeUInt32LE(off, pos + 4)
    off += data.length
  }
  header.writeUInt32LE(flags >>> 0, 60)
  return Buffer.concat([header, lm, nt, domain, user, workstation])
}

function fileTimeNow(): Buffer {
  const b = Buffer.alloc(8)
  b.writeBigUInt64LE((BigInt(Date.now()) + 11644473600000n) * 10000n)
  return b
}

/**
 * MD4 propio: OpenSSL 3 lo trae deshabilitado y el Node del sistema no lo
 * ofrece; BoringSSL (Electron) sí, pero los arneses no siempre corren ahí.
 */
export function md4(input: Buffer): Buffer {
  const len = input.length
  const padLen = ((len + 8) >> 6) + 1 << 6
  const msg = Buffer.alloc(padLen)
  input.copy(msg)
  msg[len] = 0x80
  msg.writeUInt32LE((len * 8) >>> 0, padLen - 8)
  msg.writeUInt32LE(Math.floor(len / 0x20000000), padLen - 4)

  let a = 0x67452301, b = 0xefcdab89, c = 0x98badcfe, d = 0x10325476
  const rotl = (x: number, n: number): number => (x << n) | (x >>> (32 - n))
  const F = (x: number, y: number, z: number): number => (x & y) | (~x & z)
  const G = (x: number, y: number, z: number): number => (x & y) | (x & z) | (y & z)
  const H = (x: number, y: number, z: number): number => x ^ y ^ z

  for (let i = 0; i < padLen; i += 64) {
    const X = Array.from({ length: 16 }, (_, j) => msg.readUInt32LE(i + j * 4))
    const [aa, bb, cc, dd] = [a, b, c, d]
    for (const k of [0, 4, 8, 12]) {
      a = rotl((a + F(b, c, d) + X[k]) | 0, 3)
      d = rotl((d + F(a, b, c) + X[k + 1]) | 0, 7)
      c = rotl((c + F(d, a, b) + X[k + 2]) | 0, 11)
      b = rotl((b + F(c, d, a) + X[k + 3]) | 0, 19)
    }
    for (const k of [0, 1, 2, 3]) {
      a = rotl((a + G(b, c, d) + X[k] + 0x5a827999) | 0, 3)
      d = rotl((d + G(a, b, c) + X[k + 4] + 0x5a827999) | 0, 5)
      c = rotl((c + G(d, a, b) + X[k + 8] + 0x5a827999) | 0, 9)
      b = rotl((b + G(c, d, a) + X[k + 12] + 0x5a827999) | 0, 13)
    }
    for (const k of [0, 2, 1, 3]) {
      a = rotl((a + H(b, c, d) + X[k] + 0x6ed9eba1) | 0, 3)
      d = rotl((d + H(a, b, c) + X[k + 8] + 0x6ed9eba1) | 0, 9)
      c = rotl((c + H(d, a, b) + X[k + 4] + 0x6ed9eba1) | 0, 11)
      b = rotl((b + H(c, d, a) + X[k + 12] + 0x6ed9eba1) | 0, 15)
    }
    a = (a + aa) | 0; b = (b + bb) | 0; c = (c + cc) | 0; d = (d + dd) | 0
  }
  const out = Buffer.alloc(16)
  out.writeInt32LE(a, 0); out.writeInt32LE(b, 4); out.writeInt32LE(c, 8); out.writeInt32LE(d, 12)
  return out
}
