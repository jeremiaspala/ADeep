import { contextBridge, ipcRenderer } from 'electron'
import type {
  AppResult, AttributeValue, ConnectionProfile, CreateComputerInput, CreateContactInput,
  CreateGroupInput, CreateOUInput, CreateUserInput, DirEntry, DomainControllerInfo,
  FsmoRoles, GroupMembership, Modification, PasswordPolicy, Preferences, SavedQuery,
  SearchRequest, SearchResult, SecurityDescriptor, SessionInfo
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
    copy: (text: string) => call<boolean>('app.copy', text),
    exportCsv: (rows: string[][], name: string) => call<string | null>('app.exportCsv', rows, name),
    exportLdif: (entries: { dn: string; attrs: Record<string, string[]> }[], name: string) =>
      call<string | null>('app.exportLdif', entries, name),
    openExternal: (url: string) => call<boolean>('app.openExternal', url),
    confirm: (title: string, message: string, detail?: string) =>
      call<boolean>('app.confirm', title, message, detail)
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
