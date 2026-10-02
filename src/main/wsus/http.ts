/**
 * Cliente HTTP con autenticación NTLM. NTLM autentica la conexión, no el pedido:
 * el desafío y la respuesta tienen que viajar por el mismo socket, por eso cada
 * cliente usa un agente de un solo socket y serializa sus pedidos.
 */
import http from 'node:http'
import https from 'node:https'
import type { TLSSocket } from 'node:tls'
import { authenticateMessage, channelBindingHash, negotiateMessage, type NtlmCredentials } from './ntlm'

export interface HttpTarget {
  host: string
  port: number
  ssl: boolean
  /** No verificar el certificado del servidor. */
  insecureTLS?: boolean
  ca?: string[]
}

export interface HttpResponse {
  status: number
  headers: http.IncomingHttpHeaders
  body: Buffer
}

export class HttpError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message)
  }
}

const TIMEOUT_MS = 120_000

export class NtlmHttpClient {
  private agent: http.Agent
  private queue: Promise<unknown> = Promise.resolve()

  constructor(readonly target: HttpTarget, private cred: NtlmCredentials) {
    const opts = { keepAlive: true, maxSockets: 1, maxFreeSockets: 1 }
    this.agent = target.ssl
      ? new https.Agent({
          ...opts,
          rejectUnauthorized: !target.insecureTLS,
          ca: target.ca?.length ? target.ca : undefined
        })
      : new http.Agent(opts)
  }

  close(): void {
    this.agent.destroy()
  }

  request(method: string, path: string, headers: Record<string, string>, body?: Buffer): Promise<HttpResponse> {
    const run = (): Promise<HttpResponse> => this.withAuth(method, path, headers, body)
    const next = this.queue.then(run, run)
    this.queue = next.catch(() => undefined)
    return next
  }

  private async withAuth(
    method: string, path: string, headers: Record<string, string>, body?: Buffer
  ): Promise<HttpResponse> {
    // El socket puede venir ya autenticado de un pedido anterior.
    let res = await this.send(method, path, headers, body)
    if (res.status !== 401) return res

    for (let intento = 0; intento < 2; intento++) {
      const offered = authSchemes(res.headers)
      if (!offered.includes('ntlm') && !offered.includes('negotiate')) {
        throw new HttpError('El servidor no ofrece autenticación NTLM ni Negotiate.', 401)
      }
      const scheme = offered.includes('ntlm') ? 'NTLM' : 'Negotiate'
      const type1 = await this.send(method, path, {
        ...headers, Authorization: `${scheme} ${negotiateMessage().toString('base64')}`
      }, body)
      const challenge = challengeFrom(type1.headers, scheme)
      if (type1.status !== 401 || !challenge) {
        if (type1.status < 400) return type1
        throw new HttpError(`El servidor cortó el intercambio NTLM (HTTP ${type1.status}).`, type1.status)
      }
      const cert = this.target.ssl ? type1.socketCert : undefined
      const type3 = authenticateMessage(challenge, this.cred, {
        spn: `HTTP/${this.target.host}`,
        channelBinding: cert ? channelBindingHash(cert) : undefined
      })
      res = await this.send(method, path, {
        ...headers, Authorization: `${scheme} ${type3.toString('base64')}`
      }, body)
      if (res.status !== 401) return res
      // Un 401 después de la respuesta es casi siempre contraseña incorrecta;
      // si el agente cambió de socket en el medio, un segundo intento lo resuelve.
      if (!type1.reused) break
    }
    throw new HttpError(
      'El servidor rechazó las credenciales. Revisá usuario y contraseña, y que el usuario sea ' +
      'administrador del servidor o del grupo «Administradores WSUS».', 401
    )
  }

  private send(
    method: string, path: string, headers: Record<string, string>, body?: Buffer
  ): Promise<HttpResponse & { socketCert?: import('node:crypto').X509Certificate; reused: boolean }> {
    const mod = this.target.ssl ? https : http
    return new Promise((resolve, reject) => {
      const req = mod.request({
        host: this.target.host,
        port: this.target.port,
        method,
        path,
        agent: this.agent,
        headers: { ...headers, 'Content-Length': String(body?.length ?? 0), Connection: 'keep-alive' },
        timeout: TIMEOUT_MS
      }, (res) => {
        const chunks: Buffer[] = []
        res.on('data', (c: Buffer) => chunks.push(c))
        res.on('end', () => {
          const sock = res.socket as TLSSocket | null
          resolve({
            status: res.statusCode ?? 0,
            headers: res.headers,
            body: Buffer.concat(chunks),
            socketCert: sock && 'getPeerX509Certificate' in sock ? sock.getPeerX509Certificate() : undefined,
            reused: req.reusedSocket
          })
        })
        res.on('error', reject)
      })
      req.on('timeout', () => req.destroy(new HttpError(`${this.target.host} no respondió en ${TIMEOUT_MS / 1000} s.`)))
      req.on('error', (e: NodeJS.ErrnoException) => reject(netError(e, this.target)))
      if (body) req.write(body)
      req.end()
    })
  }
}

function authSchemes(h: http.IncomingHttpHeaders): string[] {
  const raw = h['www-authenticate']
  const list = Array.isArray(raw) ? raw : raw ? raw.split(/,\s*(?=[A-Za-z]+(?:\s|$))/) : []
  return list.map((v) => v.trim().split(/\s+/)[0].toLowerCase())
}

function challengeFrom(h: http.IncomingHttpHeaders, scheme: string): Buffer | null {
  const raw = h['www-authenticate']
  const list = Array.isArray(raw) ? raw : raw ? [raw] : []
  for (const v of list) {
    const [s, token] = v.trim().split(/\s+/)
    if (s.toLowerCase() === scheme.toLowerCase() && token) return Buffer.from(token, 'base64')
  }
  return null
}

function netError(e: NodeJS.ErrnoException, t: HttpTarget): Error {
  if (e instanceof HttpError) return e
  const where = `${t.host}:${t.port}`
  switch (e.code) {
    case 'ECONNREFUSED': return new HttpError(`${where} rechazó la conexión. ¿Está el puerto de WSUS bien?`)
    case 'ENOTFOUND': return new HttpError(`No se resuelve ${t.host} en el DNS.`)
    case 'ETIMEDOUT':
    case 'EHOSTUNREACH': return new HttpError(`${where} no responde.`)
    case 'DEPTH_ZERO_SELF_SIGNED_CERT':
    case 'SELF_SIGNED_CERT_IN_CHAIN':
    case 'UNABLE_TO_VERIFY_LEAF_SIGNATURE':
    case 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY':
    case 'ERR_TLS_CERT_ALTNAME_INVALID':
    case 'CERT_HAS_EXPIRED':
      return new HttpError(`El certificado de ${where} no es de confianza (${e.code}).`)
    default: return new HttpError(`${where}: ${e.message}`)
  }
}
