/**
 * DHCP.
 *
 * De DHCP, Active Directory guarda **una sola cosa**: la lista de servidores
 * autorizados, en `CN=DhcpRoot,CN=NetServices,CN=Services,CN=Configuration`
 * (atributo `dhcpServers`). Los ámbitos, las concesiones, las reservas y las
 * opciones viven en la base del servidor, no en el directorio, y para llegar a
 * ellas hace falta otro transporte (MS-DHCPM por RPC, WinRM, o la API REST de
 * Kea si el servidor es Linux). Eso todavía no está decidido.
 *
 * Formato de `dhcpServers` (MS-DHCPM 2.2.1): entradas separadas por `;`, y cada
 * una con campos precedidos por una letra que dice qué son. `i` es la dirección
 * IP como entero y `s` el nombre del servidor.
 */
import type { AdConnection } from '../ldap/connection'
import { firstString } from '../ldap/directory'
import type { DhcpAuthorizedServer, DhcpState } from '../../shared/types'

export function netServicesDN(conn: AdConnection): string {
  return `CN=NetServices,CN=Services,${conn.configDN}`
}

export function parseDhcpServers(value: string): DhcpAuthorizedServer[] {
  const out: DhcpAuthorizedServer[] = []
  for (const entry of value.split(';').filter(Boolean)) {
    let address = ''
    let name: string | undefined
    for (const field of entry.split('$')) {
      const tag = field[0]
      const body = field.slice(1)
      if (tag === 'i') {
        const n = Number(body)
        if (Number.isFinite(n)) {
          address = [24, 16, 8, 0].map((shift) => (n >>> shift) & 0xff).join('.')
        }
      } else if ((tag === 's' || tag === 'r') && body) {
        name = body.replace(/^cn=/i, '')
      }
    }
    if (address || name) out.push({ address, name })
  }
  return out
}

export async function getState(conn: AdConnection): Promise<DhcpState> {
  const [root, candidates] = await Promise.all([
    conn
      .searchRaw(netServicesDN(conn), {
        scope: 'one',
        filter: '(objectClass=dHCPClass)',
        attributes: ['name', 'dhcpServers', 'dhcpIdentification']
      })
      .catch(() => []),
    conn
      .searchRaw(conn.baseDN, {
        scope: 'sub',
        filter: '(&(objectCategory=computer)(servicePrincipalName=DHCPServer/*))',
        attributes: ['name', 'dNSHostName']
      })
      .catch(() => [])
  ])

  const dhcpRoot = root.find((e) => (firstString(e, 'name') ?? '').toLowerCase() === 'dhcproot')

  return {
    rootDN: dhcpRoot?.dn,
    servers: parseDhcpServers(dhcpRoot ? firstString(dhcpRoot, 'dhcpServers') ?? '' : ''),
    candidates: candidates.map((e) => ({
      name: firstString(e, 'name') ?? '',
      dnsHostName: firstString(e, 'dNSHostName'),
      dn: e.dn
    }))
  }
}
