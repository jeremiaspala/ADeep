import { contextBridge, ipcRenderer } from 'electron'
import type {
  AppResult, AttributeValue, ConnectionProfile, CreateComputerInput, CreateContactInput,
  CreateGroupInput, CreateOUInput, CreateUserInput, DfsNamespace, DfsTarget, DfsrGroup,
  CertificateAuthority, CertificateTemplate, DhcpState, DirEntry, DnsNode, DnsZone,
  DnsZoneDetails, GpoInfo, GpoScope, LdapBrowserNode, LdapContext, WmiFilter,
  DomainControllerInfo, DsaServerInfo, ForestInfo, FsmoRoles, GroupMembership,
  Modification, PartitionInfo, PasswordPolicy, Preferences, SavedQuery, SearchRequest,
  SearchResult, SecurityDescriptor, SessionInfo, SiteInfo, SiteLinkInfo, SubnetInfo,
  TrustInfo
} from '../shared/types'

const call = <T>(channel: string, ...args: unknown[]): Promise<AppResult<T>> =>
  ipcRenderer.invoke(channel, ...args) as Promise<AppResult<T>>

export interface SchemaObjectsResult {
  classes: { name: string; display: string; guid: string; category: number }[]
  rights: { name: string; guid: string; validAccesses: number; appliesTo: string[] }[]
}

export type { Preferences }

const api = {
  session: {
    onChange: (cb: (info: SessionInfo) => void) => {
      const listener = (_e: unknown, info: SessionInfo): void => cb(info)
      ipcRenderer.on('session.changed', listener)
      return () => ipcRenderer.removeListener('session.changed', listener)
    },
    connect: (profile: ConnectionProfile, password: string) =>
      call<SessionInfo>('session.connect', profile, password),
    disconnect: () => call<SessionInfo>('session.disconnect'),
    info: () => call<SessionInfo>('session.info'),
    passwordPolicy: () => call<PasswordPolicy>('session.passwordPolicy'),
    fsmo: () => call<FsmoRoles>('session.fsmo'),
    domainControllers: () => call<DomainControllerInfo[]>('session.domainControllers'),
    wellKnownContainers: () => call<Record<string, string>>('session.wellKnownContainers')
  },

  dir: {
    roots: () => call<DirEntry[]>('dir.roots'),
    children: (dn: string, showAdvanced: boolean) =>
      call<DirEntry[]>('dir.children', dn, showAdvanced),
    list: (dn: string, showAdvanced: boolean, extraFilter?: string, sizeLimit?: number) =>
      call<DirEntry[]>('dir.list', dn, showAdvanced, extraFilter, sizeLimit),
    entry: (dn: string, attributes?: string[]) => call<DirEntry>('dir.entry', dn, attributes),
    attributes: (dn: string, includeOperational = false) =>
      call<AttributeValue[]>('dir.attributes', dn, includeOperational),
    canonical: (dn: string) => call<string>('dir.canonical', dn),
    parent: (dn: string) => call<string>('dir.parent', dn),
    hasChildren: (dn: string) => call<number>('dir.hasChildren', dn)
  },

  search: {
    run: (req: SearchRequest) => call<SearchResult>('search.run', req),
    pick: (text: string, kinds: string[], baseDN?: string) =>
      call<DirEntry[]>('search.pick', text, kinds, baseDN),
    byDN: (dns: string[]) => call<DirEntry[]>('search.byDN', dns),
    bySid: (sid: string) => call<DirEntry | null>('search.bySid', sid),
    byGuid: (guid: string) => call<DirEntry | null>('search.byGuid', guid)
  },

  create: {
    user: (input: CreateUserInput) => call<string>('create.user', input),
    group: (input: CreateGroupInput) => call<string>('create.group', input),
    ou: (input: CreateOUInput) => call<string>('create.ou', input),
    computer: (input: CreateComputerInput) => call<string>('create.computer', input),
    contact: (input: CreateContactInput) => call<string>('create.contact', input),
    copyUser: (sourceDN: string, input: CreateUserInput) =>
      call<string>('create.copyUser', sourceDN, input)
  },

  obj: {
    modify: (dn: string, mods: Modification[]) => call<boolean>('obj.modify', dn, mods),
    rename: (dn: string, newName: string) => call<string>('obj.rename', dn, newName),
    renameUser: (
      dn: string,
      fields: {
        cn: string; givenName?: string; initials?: string; sn?: string
        displayName?: string; sAMAccountName?: string; userPrincipalName?: string
      }
    ) => call<string>('obj.renameUser', dn, fields),
    move: (dns: string[], target: string) =>
      call<{ dn: string; newDN?: string; error?: string }[]>('obj.move', dns, target),
    delete: (dns: string[], tree: boolean) =>
      call<{ dn: string; error?: string }[]>('obj.delete', dns, tree),
    setEnabled: (dns: string[], enabled: boolean) => call<boolean>('obj.setEnabled', dns, enabled),
    unlock: (dns: string[]) => call<boolean>('obj.unlock', dns),
    resetPassword: (dn: string, password: string, mustChange: boolean, unlock: boolean) =>
      call<boolean>('obj.resetPassword', dn, password, mustChange, unlock),
    changePassword: (dn: string, oldPassword: string, newPassword: string) =>
      call<boolean>('obj.changePassword', dn, oldPassword, newPassword),
    setUAC: (dn: string, uac: number) => call<boolean>('obj.setUAC', dn, uac),
    setAccountExpires: (dn: string, iso: string | null) =>
      call<boolean>('obj.setAccountExpires', dn, iso),
    getCannotChangePassword: (dn: string) => call<boolean>('obj.cannotChangePassword.get', dn),
    setCannotChangePassword: (dn: string, v: boolean) =>
      call<boolean>('obj.cannotChangePassword.set', dn, v),
    getProtect: (dn: string) => call<boolean>('obj.protect.get', dn),
    setProtect: (dn: string, v: boolean) => call<boolean>('obj.protect.set', dn, v)
  },

  group: {
    memberOf: (dn: string) => call<GroupMembership[]>('group.memberOf', dn),
    memberOfRecursive: (dn: string) => call<DirEntry[]>('group.memberOfRecursive', dn),
    members: (dn: string) => call<DirEntry[]>('group.members', dn),
    addMembers: (dn: string, members: string[]) => call<boolean>('group.addMembers', dn, members),
    removeMembers: (dn: string, members: string[]) =>
      call<boolean>('group.removeMembers', dn, members),
    addTo: (memberDN: string, groups: string[]) => call<boolean>('group.addTo', memberDN, groups),
    removeFrom: (memberDN: string, groups: string[]) =>
      call<boolean>('group.removeFrom', memberDN, groups),
    setPrimary: (userDN: string, groupDN: string) =>
      call<boolean>('group.setPrimary', userDN, groupDN)
  },

  security: {
    read: (dn: string, includeSacl = false) =>
      call<SecurityDescriptor>('security.read', dn, includeSacl),
    write: (dn: string, sd: SecurityDescriptor, includeSacl = false) =>
      call<boolean>('security.write', dn, sd, includeSacl),
    resolveSids: (sids: string[]) => call<Record<string, string>>('security.resolveSids', sids),
    resolveGuids: (guids: string[]) => call<Record<string, string>>('security.resolveGuids', guids),
    schemaObjects: () => call<SchemaObjectsResult>('security.schemaObjects')
  },

  store: {
    profiles: () => call<ConnectionProfile[]>('store.profiles'),
    saveProfile: (p: ConnectionProfile) => call<ConnectionProfile[]>('store.saveProfile', p),
    deleteProfile: (id: string) => call<ConnectionProfile[]>('store.deleteProfile', id),
    secret: (id: string) => call<string | undefined>('store.secret', id),
    encryptionAvailable: () => call<boolean>('store.encryptionAvailable'),
    queries: () => call<SavedQuery[]>('store.queries'),
    saveQuery: (q: SavedQuery) => call<SavedQuery[]>('store.saveQuery', q),
    deleteQuery: (id: string) => call<SavedQuery[]>('store.deleteQuery', id),
    prefs: () => call<Preferences>('store.prefs'),
    setPrefs: (p: Partial<Preferences>) => call<Preferences>('store.setPrefs', p),
    newId: () => call<string>('store.newId')
  },

  app: {
    /** Consola que dibuja esta ventana (la inyecta el proceso principal). */
    consoleId: (process.argv.find((a) => a.startsWith('--adeep-console=')) ?? '').split('=')[1] || 'aduc',
    openConsole: (id: string) => ipcRenderer.invoke('app.openConsole', id) as Promise<boolean>,
    /** Alguien escribió en el directorio desde otra consola. */
    onDirectoryChange: (cb: (channel: string) => void) => {
      const listener = (_e: unknown, channel: string): void => cb(channel)
      ipcRenderer.on('directory.changed', listener)
      return () => ipcRenderer.removeListener('directory.changed', listener)
    },
    consoles: () => ipcRenderer.invoke('app.consoles') as Promise<{ id: string; title: string }[]>,
    copy: (text: string) => call<boolean>('app.copy', text),
    exportCsv: (rows: string[][], name: string) => call<string | null>('app.exportCsv', rows, name),
    exportLdif: (entries: { dn: string; attrs: Record<string, string[]> }[], name: string) =>
      call<string | null>('app.exportLdif', entries, name),
    openExternal: (url: string) => call<boolean>('app.openExternal', url),
    confirm: (title: string, message: string, detail?: string) =>
      call<boolean>('app.confirm', title, message, detail)
  },

  sites: {
    list: () => call<SiteInfo[]>('sites.list'),
    subnets: () => call<SubnetInfo[]>('sites.subnets'),
    links: () => call<SiteLinkInfo[]>('sites.links'),
    servers: (siteDN?: string) => call<DsaServerInfo[]>('sites.servers', siteDN),
    create: (name: string, description?: string) => call<string>('sites.create', name, description),
    delete: (dn: string) => call<boolean>('sites.delete', dn),
    createSubnet: (cidr: string, siteDN: string, location?: string, description?: string) =>
      call<string>('sites.createSubnet', cidr, siteDN, location, description),
    setSubnetSite: (dn: string, siteDN: string | null) =>
      call<boolean>('sites.setSubnetSite', dn, siteDN),
    validateSubnet: (cidr: string) => call<string | null>('sites.validateSubnet', cidr),
    createLink: (
      name: string, siteDNs: string[], cost: number, replInterval: number, transport: 'IP' | 'SMTP'
    ) => call<string>('sites.createLink', name, siteDNs, cost, replInterval, transport),
    updateLink: (dn: string, patch: {
      cost?: number; replInterval?: number; siteDNs?: string[]; notify?: boolean
      noCompression?: boolean; description?: string; schedule?: boolean[] | null
    }) => call<boolean>('sites.updateLink', dn, patch),
    setGlobalCatalog: (ntdsDN: string, enabled: boolean) =>
      call<boolean>('sites.setGlobalCatalog', ntdsDN, enabled),
    moveServer: (serverDN: string, siteDN: string) =>
      call<string>('sites.moveServer', serverDN, siteDN),
    createConnection: (toNtdsDN: string, fromNtdsDN: string, name?: string) =>
      call<string>('sites.createConnection', toNtdsDN, fromNtdsDN, name),
    setConnectionEnabled: (dn: string, enabled: boolean) =>
      call<boolean>('sites.setConnectionEnabled', dn, enabled),
    setConnectionSchedule: (dn: string, schedule: boolean[] | null) =>
      call<boolean>('sites.setConnectionSchedule', dn, schedule),
    deleteConnection: (dn: string) => call<boolean>('sites.deleteConnection', dn),
    setKcc: (siteDN: string, intraOff: boolean, interOff: boolean) =>
      call<boolean>('sites.setKcc', siteDN, intraOff, interOff),
    rootDseOperation: (operation: string, value?: string) =>
      call<boolean>('sites.rootDseOperation', operation, value),
    replicateObject: (objectDN: string, sourceInvocationId: string) =>
      call<boolean>('sites.replicateObject', objectDN, sourceInvocationId)
  },

  trusts: {
    forest: () => call<ForestInfo>('trusts.forest'),
    list: () => call<TrustInfo[]>('trusts.list'),
    partitions: () => call<PartitionInfo[]>('trusts.partitions'),
    update: (dn: string, patch: { sidFiltering?: boolean; selectiveAuth?: boolean; encryptionTypes?: number }) =>
      call<boolean>('trusts.update', dn, patch),
    setUpnSuffixes: (suffixes: string[]) => call<boolean>('trusts.setUpnSuffixes', suffixes),
    setSpnSuffixes: (suffixes: string[]) => call<boolean>('trusts.setSpnSuffixes', suffixes),
    raiseDomainLevel: (level: number) => call<boolean>('trusts.raiseDomainLevel', level),
    raiseForestLevel: (level: number) => call<boolean>('trusts.raiseForestLevel', level),
    maxSupportedLevel: () => call<number>('trusts.maxSupportedLevel')
  },

  dfs: {
    namespaces: () => call<DfsNamespace[]>('dfs.namespaces'),
    replicationGroups: () => call<DfsrGroup[]>('dfs.replicationGroups'),
    setFolderTargets: (linkDN: string, targets: DfsTarget[]) =>
      call<boolean>('dfs.setFolderTargets', linkDN, targets),
    setFolderComment: (linkDN: string, comment: string) =>
      call<boolean>('dfs.setFolderComment', linkDN, comment),
    setFolderTtl: (linkDN: string, ttl: number) => call<boolean>('dfs.setFolderTtl', linkDN, ttl),
    createFolder: (namespaceDN: string, path: string, targets: DfsTarget[], comment?: string) =>
      call<string>('dfs.createFolder', namespaceDN, path, targets, comment),
    deleteFolder: (linkDN: string) => call<boolean>('dfs.deleteFolder', linkDN),
    setConnectionEnabled: (dn: string, enabled: boolean) =>
      call<boolean>('dfs.setConnectionEnabled', dn, enabled),
    setSchedule: (dn: string, schedule: boolean[] | null) =>
      call<boolean>('dfs.setSchedule', dn, schedule),
    setMemberEnabled: (subscriptionDN: string, enabled: boolean) =>
      call<boolean>('dfs.setMemberEnabled', subscriptionDN, enabled)
  },

  dns: {
    zones: () => call<DnsZone[]>('dns.zones'),
    nodes: (zoneDN: string) => call<DnsNode[]>('dns.nodes', zoneDN),
    zoneDetails: (zoneDN: string) => call<DnsZoneDetails>('dns.zoneDetails', zoneDN),
    servers: () => call<string[]>('dns.servers'),
    addRecord: (zoneDN: string, nodeName: string, input: { type: number; ttl: number; fields: Record<string, string | number> }) =>
      call<boolean>('dns.addRecord', zoneDN, nodeName, input),
    replaceRecord: (nodeDN: string, original: string, input: { type: number; ttl: number; fields: Record<string, string | number> }) =>
      call<boolean>('dns.replaceRecord', nodeDN, original, input),
    deleteRecord: (nodeDN: string, original: string) => call<boolean>('dns.deleteRecord', nodeDN, original),
    deleteNode: (nodeDN: string) => call<boolean>('dns.deleteNode', nodeDN),
    createZone: (name: string, scope: 'domain' | 'forest' | 'legacy') =>
      call<string>('dns.createZone', name, scope),
    deleteZone: (zoneDN: string) => call<boolean>('dns.deleteZone', zoneDN)
  },

  dhcp: {
    state: () => call<DhcpState>('dhcp.state')
  },

  ldapb: {
    contexts: () => call<LdapContext[]>('ldapb.contexts'),
    children: (dn: string) => call<LdapBrowserNode[]>('ldapb.children', dn),
    allowedClasses: (dn: string) => call<string[]>('ldapb.allowedClasses', dn),
    create: (parentDN: string, rdnAttribute: string, rdnValue: string, objectClass: string) =>
      call<string>('ldapb.create', parentDN, rdnAttribute, rdnValue, objectClass)
  },

  gpo: {
    list: () => call<GpoInfo[]>('gpo.list'),
    scopes: () => call<GpoScope[]>('gpo.scopes'),
    wmiFilters: () => call<WmiFilter[]>('gpo.wmiFilters'),
    link: (scopeDN: string, gpoDN: string) => call<boolean>('gpo.link', scopeDN, gpoDN),
    unlink: (scopeDN: string, gpoDN: string) => call<boolean>('gpo.unlink', scopeDN, gpoDN),
    setLinkOptions: (scopeDN: string, gpoDN: string, options: number) =>
      call<boolean>('gpo.setLinkOptions', scopeDN, gpoDN, options),
    moveLink: (scopeDN: string, gpoDN: string, direction: -1 | 1) =>
      call<boolean>('gpo.moveLink', scopeDN, gpoDN, direction),
    setBlockInheritance: (scopeDN: string, block: boolean) =>
      call<boolean>('gpo.setBlockInheritance', scopeDN, block),
    setStatus: (gpoDN: string, flags: number) => call<boolean>('gpo.setStatus', gpoDN, flags)
  },

  adcs: {
    templates: () => call<CertificateTemplate[]>('adcs.templates'),
    authorities: () => call<CertificateAuthority[]>('adcs.authorities'),
    stores: () => call<{ store: string; label: string; certificates: number; dn: string }[]>('adcs.stores'),
    caCertificates: () => call<{ name: string; store: string; pem: string }[]>('adcs.caCertificates')
  },

  theme: {
    get: () => ipcRenderer.invoke('theme.get') as Promise<'light' | 'dark'>,
    set: (t: 'system' | 'light' | 'dark') =>
      ipcRenderer.invoke('theme.set', t) as Promise<'light' | 'dark'>,
    onChange: (cb: (t: 'light' | 'dark') => void) => {
      const listener = (_e: unknown, t: 'light' | 'dark'): void => cb(t)
      ipcRenderer.on('theme.changed', listener)
      return () => ipcRenderer.removeListener('theme.changed', listener)
    }
  }
}

contextBridge.exposeInMainWorld('adeep', api)

export type AdeepApi = typeof api
