/**
 * Canales IPC de las consolas Sitios y servicios, Dominios y confianzas y DFS.
 * `registerIpc` (ipc.ts) inyecta sus helpers para no duplicar el manejo de errores
 * ni el estado de la conexión.
 */
import type { AdConnection } from './ldap/connection'
import * as sites from './sites/operations'
import * as trusts from './trusts/operations'
import * as dfs from './dfs/operations'
import type { DfsTarget } from '../shared/types'

export type HandleFn = <A extends unknown[], R>(
  channel: string,
  fn: (...args: A) => Promise<R> | R
) => void

export function registerConsoleIpc(handle: HandleFn, requireConn: () => AdConnection): void {
  /* ---------------- Sitios y servicios ---------------- */

  handle('sites.list', async () => sites.listSites(requireConn()))
  handle('sites.subnets', async () => sites.listSubnets(requireConn()))
  handle('sites.links', async () => sites.listSiteLinks(requireConn()))
  handle('sites.servers', async (siteDN?: string) => sites.listServers(requireConn(), siteDN))

  handle('sites.create', async (name: string, description?: string) =>
    sites.createSite(requireConn(), name, description))
  handle('sites.delete', async (dn: string) => {
    await sites.deleteSite(requireConn(), dn)
    return true
  })

  handle('sites.createSubnet', async (cidr: string, siteDN: string, location?: string, description?: string) =>
    sites.createSubnet(requireConn(), cidr, siteDN, location, description))
  handle('sites.setSubnetSite', async (dn: string, siteDN: string | null) => {
    await sites.setSubnetSite(requireConn(), dn, siteDN)
    return true
  })
  handle('sites.validateSubnet', (cidr: string) => sites.validateSubnet(cidr) ?? null)

  handle('sites.createLink', async (
    name: string, siteDNs: string[], cost: number, replInterval: number, transport: 'IP' | 'SMTP'
  ) => sites.createSiteLink(requireConn(), name, siteDNs, cost, replInterval, transport))
  handle('sites.updateLink', async (dn: string, patch: Parameters<typeof sites.updateSiteLink>[2]) => {
    await sites.updateSiteLink(requireConn(), dn, patch)
    return true
  })

  handle('sites.setGlobalCatalog', async (ntdsDN: string, enabled: boolean) => {
    await sites.setGlobalCatalog(requireConn(), ntdsDN, enabled)
    return true
  })
  handle('sites.moveServer', async (serverDN: string, siteDN: string) =>
    sites.moveServerToSite(requireConn(), serverDN, siteDN))
  handle('sites.createConnection', async (toNtdsDN: string, fromNtdsDN: string, name?: string) =>
    sites.createConnection(requireConn(), toNtdsDN, fromNtdsDN, name))
  handle('sites.setConnectionEnabled', async (dn: string, enabled: boolean) => {
    await sites.setConnectionEnabled(requireConn(), dn, enabled)
    return true
  })
  handle('sites.deleteConnection', async (dn: string) => {
    await requireConn().delete(dn)
    return true
  })
  handle('sites.setKcc', async (siteDN: string, intraOff: boolean, interOff: boolean) => {
    await sites.setKccOptions(requireConn(), siteDN, intraOff, interOff)
    return true
  })
  handle('sites.rootDseOperation', async (operation: sites.RootDseOperation, value?: string) => {
    await sites.rootDseOperation(requireConn(), operation, value)
    return true
  })
  handle('sites.replicateObject', async (objectDN: string, sourceInvocationId: string) => {
    await sites.replicateObject(requireConn(), objectDN, sourceInvocationId)
    return true
  })

  /* ---------------- Dominios y confianzas ---------------- */

  handle('trusts.forest', async () => trusts.getForestInfo(requireConn()))
  handle('trusts.list', async () => trusts.listTrusts(requireConn()))
  handle('trusts.partitions', async () => trusts.listPartitions(requireConn()))
  handle('trusts.update', async (
    dn: string,
    patch: { sidFiltering?: boolean; selectiveAuth?: boolean; encryptionTypes?: number }
  ) => {
    await trusts.updateTrust(requireConn(), dn, patch)
    return true
  })
  handle('trusts.setUpnSuffixes', async (suffixes: string[]) => {
    await trusts.setUpnSuffixes(requireConn(), suffixes)
    return true
  })
  handle('trusts.setSpnSuffixes', async (suffixes: string[]) => {
    await trusts.setSpnSuffixes(requireConn(), suffixes)
    return true
  })
  handle('trusts.raiseDomainLevel', async (level: number) => {
    await trusts.raiseDomainFunctionalLevel(requireConn(), level)
    return true
  })
  handle('trusts.raiseForestLevel', async (level: number) => {
    await trusts.raiseForestFunctionalLevel(requireConn(), level)
    return true
  })
  handle('trusts.maxSupportedLevel', async () => trusts.maxSupportedLevel(requireConn()))

  /* ---------------- DFS ---------------- */

  handle('dfs.namespaces', async () => dfs.listNamespaces(requireConn()))
  handle('dfs.replicationGroups', async () => dfs.listReplicationGroups(requireConn()))
  handle('dfs.setFolderTargets', async (linkDN: string, targets: DfsTarget[]) => {
    await dfs.setFolderTargets(requireConn(), linkDN, targets)
    return true
  })
  handle('dfs.setFolderComment', async (linkDN: string, comment: string) => {
    await dfs.setFolderComment(requireConn(), linkDN, comment)
    return true
  })
  handle('dfs.setFolderTtl', async (linkDN: string, ttl: number) => {
    await dfs.setFolderTtl(requireConn(), linkDN, ttl)
    return true
  })
  handle('dfs.createFolder', async (
    namespaceDN: string, path: string, targets: DfsTarget[], comment?: string
  ) => dfs.createFolder(requireConn(), namespaceDN, path, targets, comment))
  handle('dfs.deleteFolder', async (linkDN: string) => {
    await dfs.deleteFolder(requireConn(), linkDN)
    return true
  })
  handle('dfs.setConnectionEnabled', async (dn: string, enabled: boolean) => {
    await dfs.setDfsrConnectionEnabled(requireConn(), dn, enabled)
    return true
  })
  handle('dfs.setSchedule', async (dn: string, schedule: boolean[] | null) => {
    await dfs.setDfsrSchedule(requireConn(), dn, schedule)
    return true
  })
  handle('dfs.setMemberEnabled', async (subscriptionDN: string, enabled: boolean) => {
    await dfs.setDfsrMemberEnabled(requireConn(), subscriptionDN, enabled)
    return true
  })
}
