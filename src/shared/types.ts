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
  /** CAs de confianza en PEM, normalmente tomadas del propio directorio. */
  caCertificates?: string[]
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
  // Sitios y servicios
  | 'sitesRoot' | 'site' | 'subnetsRoot' | 'subnet' | 'transportsRoot' | 'transport'
  | 'siteLink' | 'siteLinkBridge' | 'serversRoot' | 'server' | 'ntdsSettings' | 'connection'
  // Dominios y confianzas
  | 'forest' | 'partition' | 'trust'
  // DFS
  | 'dfsRoot' | 'dfsNamespace' | 'dfsFolder' | 'dfsTarget'
  | 'dfsrRoot' | 'dfsrGroup' | 'dfsrContent' | 'dfsrMember' | 'dfsrConnection'
  // DNS y DHCP
  | 'dnsRoot' | 'dnsZone' | 'dnsReverseZone' | 'dnsRecord' | 'dhcpRoot' | 'dhcpServer'
  // Hyper-V
  | 'hvRoot' | 'hvHost' | 'hvGuest' | 'hvCluster' | 'hvDelegation' | 'hvCheck'
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
  /** Composición por GPU. Apagada ahorra ~100 MB y esta UI no la necesita. */
  hardwareAcceleration: boolean
  /**
   * Hallazgos de las revisiones que ya se miraron y son a propósito. Se siguen
   * evaluando y se muestran aparte: no se ocultan, se separan de lo que falta
   * mirar. La clave es el `id` del hallazgo.
   */
  acceptedFindings: string[]
}

export interface AppResult<T> {
  ok: boolean
  data?: T
  error?: string
  /** Código LDAP cuando aplica. */
  code?: number
}

/* ---------------- Sitios y servicios ---------------- */

export interface SiteInfo {
  dn: string
  name: string
  description?: string
  location?: string
  servers: number
  subnets: string[]
  /** DN del NTDS Settings que actúa de ISTG. */
  istg?: string
  /** options de nTDSSiteSettings. */
  settingsOptions: number
}

export interface SubnetInfo {
  dn: string
  /** RDN, en formato CIDR: 10.0.0.0/24 */
  name: string
  siteDN?: string
  siteName?: string
  location?: string
  description?: string
}

export interface SiteLinkInfo {
  dn: string
  name: string
  transport: 'IP' | 'SMTP'
  cost: number
  /** Minutos entre replicaciones. */
  replInterval: number
  sites: string[]
  siteNames: string[]
  /** Bit 1 de options: replicación con notificación. */
  notify: boolean
  /** Bit 2: compresión deshabilitada. */
  noCompression: boolean
  description?: string
  /** Bitmap de 7x24 (168 posiciones); vacío = siempre disponible. */
  schedule?: boolean[]
}

export interface DsaServerInfo {
  dn: string
  name: string
  siteDN: string
  siteName: string
  dnsHostName?: string
  /** DN del objeto computer en el dominio. */
  serverReference?: string
  ntdsDN?: string
  /** options de nTDSDSA: bit 1 = catálogo global. */
  ntdsOptions: number
  isGC: boolean
  isISTG: boolean
  connections: ConnectionInfo[]
}

export interface ConnectionInfo {
  dn: string
  name: string
  /** DN del NTDS Settings origen. */
  fromServer: string
  fromServerName: string
  enabled: boolean
  /** Bit 1 de options: la generó el KCC. */
  generatedByKcc: boolean
  /** Bit 8: sin compresión entre sitios. */
  noCompression: boolean
  schedule?: boolean[]
}

/* ---------------- Dominios y confianzas ---------------- */

export interface TrustInfo {
  dn: string
  name: string
  partner: string
  flatName?: string
  /** 1 entrante, 2 saliente, 3 bidireccional. */
  direction: number
  directionLabel: string
  /** 1 downlevel, 2 uplevel, 3 MIT Kerberos, 4 DCE. */
  type: number
  typeLabel: string
  attributes: number
  attributeLabels: string[]
  transitive: boolean
  forestTransitive: boolean
  sidFiltering: boolean
  selectiveAuth: boolean
  sid?: string
  encryptionTypes?: number
  whenCreated?: string
  whenChanged?: string
  /** Espacios de nombres de una confianza de bosque. */
  forestNamespaces?: string[]
}

export interface PartitionInfo {
  dn: string
  name: string
  ncName: string
  dnsRoot: string
  netbiosName?: string
  /** msDS-Behavior-Version del dominio. */
  behaviorVersion?: number
  systemFlags: number
  isDomain: boolean
  isApplicationPartition: boolean
}

export interface ForestInfo {
  rootDomain: string
  forestFunctionality: number
  domainFunctionality: number
  partitionsDN: string
  upnSuffixes: string[]
  spnSuffixes: string[]
  partitions: PartitionInfo[]
  trusts: TrustInfo[]
}

/* ---------------- DFS ---------------- */

export interface DfsTarget {
  /** \\servidor\recurso */
  path: string
  server: string
  share: string
  /** El destino está habilitado (state 2 = online en v1). */
  enabled: boolean
  /** Sólo v2. */
  priorityClass?: number
  priorityRank?: number
}

export interface DfsFolder {
  /** Ruta relativa dentro del espacio de nombres. */
  path: string
  comment?: string
  /** Segundos de TTL del referral. */
  ttl?: number
  targets: DfsTarget[]
  /** DN del objeto msDFS-Linkv2 (sólo en namespaces v2). */
  dn?: string
}

export interface DfsNamespace {
  dn: string
  name: string
  /** 1 = standalone/dominio modo 2000 (fTDfs + pKT); 2 = modo Windows 2008 (msDFS-*v2). */
  version: 1 | 2
  /** \\dominio\nombre */
  path: string
  comment?: string
  ttl?: number
  rootTargets: DfsTarget[]
  folders: DfsFolder[]
  /** El blob pKT no se pudo interpretar; sólo hay destinos de raíz. */
  partial?: boolean
}

export interface DfsrMember {
  dn: string
  name: string
  computerDN?: string
  computerName?: string
  /** Ruta local replicada. */
  contentPath?: string
  stagingPath?: string
  enabled: boolean
  readOnly: boolean
  contentSetName?: string
}

export interface DfsrConnectionInfo {
  dn: string
  name: string
  fromMember: string
  fromMemberName: string
  toMemberName: string
  enabled: boolean
  rdc: boolean
  schedule?: boolean[]
}

export interface DfsrGroup {
  dn: string
  name: string
  description?: string
  /** 0 = grupo común, 1 = SYSVOL. */
  groupType: number
  isSysvol: boolean
  contentSets: { dn: string; name: string; description?: string }[]
  members: DfsrMember[]
  connections: DfsrConnectionInfo[]
  schedule?: boolean[]
}

/* ---------------- DNS ---------------- */

export interface DnsZone {
  dn: string
  name: string
  scope: 'domain' | 'forest' | 'legacy'
  scopeLabel: string
  reverse: boolean
  records: number
  /** MS-DNSP dwZoneType: 1 principal, 2 secundaria, 3 stub, 4 reenvío condicional. */
  zoneType?: number
  zoneTypeLabel?: string
  /** ALLOW_UPDATE crudo: 0 ninguna, 1 insegura, 2 sólo segura. */
  allowUpdate?: number
  updates?: string
  aging: boolean
  /** Maestros de una zona secundaria, stub o de reenvío condicional. */
  masterServers: string[]
}

export interface DnsRecordView {
  type: number
  typeName: string
  ttl: number
  /** Representación en texto, como la muestra la consola de Windows. */
  data: string
  fields: Record<string, string | number>
  /** timeStamp 0: no lo borra el proceso de limpieza. */
  static: boolean
  /** El blob original en base64, para poder modificar o borrar ese valor exacto. */
  raw: string
}

export interface DnsNode {
  dn: string
  name: string
  fqdn: string
  tombstoned: boolean
  records: DnsRecordView[]
}

export interface DnsZoneDetails {
  soa?: DnsRecordView
  ns: DnsRecordView[]
  aging: boolean
  noRefresh?: number
  refresh?: number
  allowUpdate?: number
  updates?: string
  zoneType?: number
  zoneTypeLabel?: string
  masterServers: string[]
  scavengingServers: string[]
}

export interface DnsIssue {
  id: string
  severity: 'alta' | 'media' | 'baja'
  zone: string
  /** Nombre del registro, si el hallazgo es de uno concreto. */
  record?: string
  label: string
  detail: string
}

export interface DnsRootHintServer {
  name: string
  addresses: string[]
  /** Dirección vigente según la lista oficial; vacío si el nombre no es un servidor raíz. */
  expected?: string
  stale: boolean
}

export interface DnsRootHints {
  dn: string
  /** En qué partición vive esta copia. */
  scope: 'domain' | 'forest' | 'legacy'
  scopeLabel: string
  servers: DnsRootHintServer[]
  /** Servidores raíz que faltan en esta copia. */
  missing: string[]
}

export interface DnsReview {
  issues: DnsIssue[]
  /** Nombres revisados, para poder decir sobre qué se pronunció. */
  zonesChecked: number
  recordsChecked: number
  rootHints: DnsRootHints[]
}

/* ---------------- DHCP ---------------- */

export interface DhcpAuthorizedServer {
  /** Dirección IP publicada en el directorio. */
  address: string
  name?: string
}

export interface DhcpState {
  /** CN=DhcpRoot,CN=NetServices,CN=Services,CN=Configuration */
  rootDN?: string
  servers: DhcpAuthorizedServer[]
  /** Equipos del dominio que publican el SPN del servicio DHCP. */
  candidates: { name: string; dnsHostName?: string; dn: string }[]
}

/* ---------------- Navegador LDAP ---------------- */

export interface LdapContext {
  dn: string
  label: string
  key: string
}

export interface LdapBrowserNode {
  dn: string
  name: string
  rdn: string
  /** Clase más específica del objeto. */
  objectClass: string
  allClasses: string[]
  kind: NodeKind
  description?: string
  expandable: boolean
}

/* ---------------- Directivas de grupo ---------------- */

export interface GpoInfo {
  dn: string
  guid: string
  name: string
  /** Ruta en SYSVOL donde viven los archivos de la directiva. */
  path: string
  computerVersion: number
  userVersion: number
  flags: number
  statusLabel: string
  userDisabled: boolean
  computerDisabled: boolean
  machineExtensions: number
  userExtensions: number
  wmiFilter?: string
  created?: string
  changed?: string
  /** En cuántos sitios, dominios u OUs está vinculada. */
  linkCount: number
}

export interface GpoLink {
  gpoDN: string
  gpoName: string
  /** 1 = el de mayor precedencia. */
  order: number
  options: number
  enabled: boolean
  enforced: boolean
}

export interface GpoScope {
  dn: string
  name: string
  type: 'domain' | 'ou' | 'site'
  blockInheritance: boolean
  links: GpoLink[]
}

export interface WmiFilter {
  dn: string
  id: string
  name: string
  description?: string
  query: string
  changed?: string
}

/* ---------------- Certificados ---------------- */

export interface TemplateRisk {
  id: string
  severity: 'alta' | 'media' | 'baja'
  label: string
  detail: string
}

export interface CertificateTemplate {
  dn: string
  cn: string
  name: string
  schemaVersion: number
  revision: number
  nameFlags: number
  enrollmentFlags: number
  raSignatures: number
  minimalKeySize: number
  ekus: string[]
  ekuNames: string[]
  /** El solicitante elige el sujeto del certificado. */
  suppliesSubject: boolean
  requiresApproval: boolean
  autoEnroll: boolean
  publishToDs: boolean
  noSecurityExtension: boolean
  publishedBy: string[]
  validity: string
  risks: TemplateRisk[]
}

export interface CertificateAuthority {
  dn: string
  name: string
  host: string
  templates: string[]
  subject: string
  flags: number
}

/* ---------------- Hyper-V ---------------- */

/** Servicios de Hyper-V que un host publica como SPN. */
export interface HyperVServices {
  /** `Microsoft Virtual System Migration Service` — migración en vivo. */
  migration: boolean
  /** `Microsoft Virtual Console Service` — VMConnect. */
  console: boolean
  /** `Hyper-V Replica Service` — réplica. */
  replica: boolean
  /** `WSMAN` — WinRM registrado, condición para administrar el host de verdad. */
  winrm: boolean
}

export interface HyperVHost {
  dn: string
  name: string
  dnsHostName?: string
  operatingSystem?: string
  operatingSystemVersion?: string
  description?: string
  location?: string
  services: HyperVServices
  /** Existe el punto de conexión `CN=Microsoft Hyper-V` bajo el objeto del equipo. */
  hasScp: boolean
  /** Puerto del listener de VMConnect declarado en el SCP (2179 por omisión). */
  consolePort?: number
  enabled: boolean
  /** TRUSTED_FOR_DELEGATION: delegación no restringida. */
  unconstrained: boolean
  /** TRUSTED_TO_AUTH_FOR_DELEGATION: delegación con cualquier protocolo. */
  anyProtocol: boolean
  /** Hosts a los que puede migrar en vivo con Kerberos. */
  migratesTo: string[]
  /** Hosts a los que puede replicar. */
  replicatesTo: string[]
  /** Destinos de `msDS-AllowedToDelegateTo` que no son hosts conocidos. */
  foreignDelegation: string[]
  /** Quién puede suplantar usuarios contra este host (RBCD). */
  rbcd: { sid: string; name: string }[]
  /** `msDS-SupportedEncryptionTypes`: qué cifrados Kerberos acepta. */
  encryptionTypes?: number
  encryptionLabels: string[]
  /** RC4 habilitado: cifrado débil, todavía aceptado por compatibilidad. */
  rc4Enabled: boolean
  lastLogon?: string
  created?: string
  clusterName?: string
}

export interface HyperVGuest {
  dn: string
  name: string
  dnsHostName?: string
  operatingSystem?: string
  enabled: boolean
  lastLogon?: string
  created?: string
  /** DN del punto de conexión `CN=Windows Virtual Machine`. */
  scpDN: string
}

export interface HyperVCluster {
  dn: string
  name: string
  dnsHostName?: string
  enabled: boolean
  /**
   * Nombres virtuales (VCO) del clúster: objetos de equipo cuyo dueño es el CNO.
   * Sin ejercitar — este dominio no tiene ningún clúster.
   */
  virtualNames: string[]
}

export interface HyperVIssue {
  id: string
  severity: 'alta' | 'media' | 'baja'
  host: string
  label: string
  detail: string
}

export interface HyperVState {
  hosts: HyperVHost[]
  guests: HyperVGuest[]
  clusters: HyperVCluster[]
  issues: HyperVIssue[]
}
