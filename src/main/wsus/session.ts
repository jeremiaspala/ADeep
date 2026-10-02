/**
 * Clientes WSUS abiertos, uno por servidor configurado. Por defecto autentican
 * con las mismas credenciales de la sesión LDAP: es la misma cuenta de dominio
 * que usaría la consola de Windows.
 */
import * as store from '../store'
import type { WsusServerConfig } from '../../shared/types'
import { credentialsFrom, type NtlmCredentials } from './ntlm'
import { WsusSoapClient } from './soap'

let domainCred: { bindName: string; password: string; netbios?: string } | null = null
const clients = new Map<string, { client: WsusSoapClient; key: string }>()

export function setDomainCredentials(bindName: string, password: string, netbios?: string): void {
  domainCred = { bindName, password, netbios }
  closeAll()
}

export function clearDomainCredentials(): void {
  domainCred = null
  closeAll()
}

export function closeAll(): void {
  for (const { client } of clients.values()) client.close()
  clients.clear()
}

export class WsusConfigError extends Error {}

async function credentialsFor(server: WsusServerConfig): Promise<NtlmCredentials> {
  if (server.user) {
    const pw = await store.getSecret(`wsus:${server.id}`)
    if (!pw) throw new WsusConfigError(`Falta la contraseña de ${server.user} para ${server.host}.`)
    return credentialsFrom(server.user, pw, domainCred?.netbios)
  }
  if (!domainCred) {
    throw new WsusConfigError('Conectate al dominio primero: WSUS usa las mismas credenciales.')
  }
  return credentialsFrom(domainCred.bindName, domainCred.password, domainCred.netbios)
}

/**
 * Nombre con el que quedan firmadas las aprobaciones, como DOMINIO\usuario.
 * Con UPN se usa el NetBIOS del dominio y la parte local, que es lo que
 * escribe la consola de Windows.
 */
export function adminNameFor(server: WsusServerConfig): string {
  const name = server.user ?? domainCred?.bindName ?? ''
  if (name.includes('\\')) return name
  const netbios = domainCred?.netbios
  const local = name.includes('@') ? name.split('@')[0] : (/^CN=([^,]+),/i.exec(name)?.[1] ?? name)
  return netbios ? `${netbios}\\${local}` : local
}

export async function serverConfig(id: string): Promise<WsusServerConfig> {
  const server = (await store.getWsusServers()).find((s) => s.id === id)
  if (!server) throw new WsusConfigError('El servidor WSUS ya no está en la configuración.')
  return server
}

export async function clientFor(id: string): Promise<{ client: WsusSoapClient; server: WsusServerConfig }> {
  const server = await serverConfig(id)
  // Si cambió el destino o el usuario, el socket autenticado ya no sirve.
  const key = JSON.stringify([server.host, server.port, server.ssl, server.insecureTLS, server.user, domainCred?.bindName])
  const cached = clients.get(id)
  if (cached && cached.key === key) return { client: cached.client, server }
  cached?.client.close()
  const client = new WsusSoapClient(
    { host: server.host, port: server.port, ssl: server.ssl, insecureTLS: server.insecureTLS },
    await credentialsFor(server)
  )
  clients.set(id, { client, key })
  return { client, server }
}

/**
 * Las escrituras se habilitan por servidor: un WSUS de producción decide qué se
 * instala en todo el parque y queda en sólo lectura hasta que alguien lo cambie.
 */
export async function writableClient(id: string): Promise<WsusSoapClient> {
  const { client, server } = await clientFor(id)
  if (!server.allowWrites) {
    throw new WsusConfigError(
      `${server.name || server.host} está en sólo lectura. Habilitá los cambios en las propiedades de la conexión.`
    )
  }
  return client
}
