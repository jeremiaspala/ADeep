/** Tipos compartidos entre proceso main (LDAP) y renderer (UI). */

export type Security = 'plain' | 'starttls' | 'ldaps'

export interface ConnectionProfile {
  id: string
  name: string
  host: string
  port: number
  security: Security
  /** No verificar el certificado del DC (labs / CA interna no instalada). */
  insecureTLS: boolean
  /** userPrincipalName, DOMAIN\\user o DN completo. */
  bindDN: string
  baseDN: string
  /** Guardar password en el archivo de perfiles (texto plano en $XDG_CONFIG_HOME). */
  savePassword: boolean
  password?: string
  lastUsed?: number
}

export interface RootDSE {
  defaultNamingContext: string
  configurationNamingContext: string
  schemaNamingContext: string
  rootDomainNamingContext: string
  namingContexts: string[]
  dnsHostName: string
  serverName: string
  ldapServiceName: string
  domainFunctionality: number
  forestFunctionality: number
  domainControllerFunctionality: number
  supportedSASLMechanisms: string[]
  supportedControl: string[]
  isSynchronized: boolean
  isGlobalCatalogReady: boolean
}

export interface SessionInfo {
  connected: boolean
  profile?: ConnectionProfile
  rootDSE?: RootDSE
  /** DN del usuario con el que se hizo bind. */
  whoami?: string
  domainSID?: string
  netbiosName?: string
  /** Valor de ms-DS-MachineAccountQuota. */
  machineAccountQuota?: number
}

/** Clase de objeto normalizada usada por la UI para iconos y menús. */
export type NodeKind =
  | 'domain'
  | 'ou'
  | 'container'
  | 'builtin'
  | 'user'
  | 'computer'
  | 'group'
  | 'contact'
  | 'printer'
  | 'volume'
  | 'gmsa'
  | 'msa'
  | 'inetOrgPerson'
  | 'foreignSecurityPrincipal'
  | 'lostAndFound'
  | 'unknown'

export interface DirEntry {
  dn: string
  name: string
  kind: NodeKind
  objectClass: string[]
  objectGUID?: string
  objectSID?: string
  description?: string
  /** Sólo para usuarios / computadoras. */
  disabled?: boolean
  locked?: boolean
  expired?: boolean
  /** El objeto puede contener hijos (se muestra en el árbol). */
  isContainer: boolean
  /** Objeto de sistema — sólo visible con "Advanced Features". */
  systemFlagsProtected?: boolean
  showInAdvancedViewOnly?: boolean
  attrs?: Record<string, string[]>
}

export interface AttributeValue {
  name: string
  /** Valores en texto (para binarios: representación amigable). */
  values: string[]
  /** Valores crudos base64 cuando el atributo es binario. */
  raw?: string[]
  isBinary: boolean
  syntax?: string
  singleValued?: boolean
  readOnly?: boolean
}

export interface SchemaAttribute {
  lDAPDisplayName: string
  attributeSyntax: string
  oMSyntax: number
  isSingleValued: boolean
  systemOnly: boolean
  searchFlags: number
  attributeID: string
  rangeLower?: number
  rangeUpper?: number
  adminDescription?: string
}

export interface SchemaClass {
  lDAPDisplayName: string
  objectClassCategory: number
  mayContain: string[]
  mustContain: string[]
  possSuperiors: string[]
  subClassOf: string
  defaultObjectCategory: string
}

export interface SearchRequest {
  baseDN: string
  scope: 'base' | 'one' | 'sub'
  filter: string
  attributes?: string[]
  sizeLimit?: number
  pageSize?: number
  /** Incluir objetos borrados (Deleted Objects / tombstones). */
  includeDeleted?: boolean
}

export interface SearchResult {
  entries: DirEntry[]
  truncated: boolean
  took: number
}

export type ModOp = 'add' | 'delete' | 'replace'

export interface Modification {
  op: ModOp
  attribute: string
  /** Texto plano, o base64 si `base64` = true. */
  values: string[]
  base64?: boolean
}

export interface CreateUserInput {
  parentDN: string
  cn: string
  givenName?: string
  initials?: string
  sn?: string
  displayName?: string
  sAMAccountName: string
  userPrincipalName?: string
  password?: string
  mustChangePassword?: boolean
  cannotChangePassword?: boolean
  passwordNeverExpires?: boolean
  accountDisabled?: boolean
  description?: string
}

export interface CreateGroupInput {
  parentDN: string
  name: string
  sAMAccountName: string
  /** 2=Global, 4=DomainLocal, 8=Universal */
  scope: 2 | 4 | 8
  /** true = grupo de seguridad, false = distribución */
  security: boolean
  description?: string
}

export interface CreateComputerInput {
  parentDN: string
  name: string
  sAMAccountName: string
  description?: string
  /** DN o SID que puede unir el equipo al dominio. */
  managedBy?: string
  isPreWindows2000?: boolean
}

export interface CreateOUInput {
  parentDN: string
  name: string
  description?: string
  protectFromDeletion: boolean
}

export interface CreateContactInput {
  parentDN: string
  cn: string
  givenName?: string
  initials?: string
  sn?: string
  displayName?: string
}

export interface GroupMembership {
  dn: string
  name: string
  kind: NodeKind
  /** Grupo primario del usuario. */
  primary?: boolean
}

export interface AceEntry {
  type: 'allow' | 'deny' | 'allow-object' | 'deny-object' | 'audit' | 'other'
  trusteeSID: string
  trusteeName?: string
  mask: number
  rights: string[]
  inherited: boolean
  inheritOnly: boolean
  containerInherit: boolean
  objectInherit: boolean
  objectType?: string
  objectTypeName?: string
  inheritedObjectType?: string
  inheritedObjectTypeName?: string
  flags: number
}

export interface SecurityDescriptor {
  owner?: string
  ownerName?: string
  group?: string
  groupName?: string
  control: number
  dacl: AceEntry[]
  sacl: AceEntry[]
  daclProtected: boolean
  saclProtected: boolean
}

export interface SavedQuery {
  id: string
  name: string
  description?: string
  baseDN: string
  scope: 'base' | 'one' | 'sub'
  filter: string
  columns?: string[]
}

export interface FsmoRoles {
  schemaMaster?: string
  domainNamingMaster?: string
  pdcEmulator?: string
  ridMaster?: string
  infrastructureMaster?: string
}

export interface DomainControllerInfo {
  name: string
  dnsHostName: string
  site: string
  os: string
  osVersion: string
  isGC: boolean
  dn: string
}

export interface PasswordPolicy {
  minPwdLength: number
  pwdHistoryLength: number
  maxPwdAgeDays: number
  minPwdAgeDays: number
  lockoutThreshold: number
  lockoutDurationMin: number
  lockoutObservationMin: number
  complexityEnabled: boolean
  reversibleEncryption: boolean
}

export interface Preferences {
  theme: 'system' | 'light' | 'dark'
  showAdvancedFeatures: boolean
  showUsersGroupsAsContainers: boolean
  maxItems: number
  columns: string[]
  language: 'es' | 'en'
  confirmDelete: boolean
  density: 'comfortable' | 'compact'
}

export interface AppResult<T> {
  ok: boolean
  data?: T
  error?: string
  /** Código LDAP cuando aplica. */
  code?: number
}
