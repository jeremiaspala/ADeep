/**
 * Operaciones de la consola de WSUS sobre MS-WSUSAR. Las posiciones de columna
 * salen de la especificación y de contrastarla contra un WSUS 10.0.26100: las
 * filas de actualizaciones traen cuatro columnas más que lo documentado (título,
 * descripción y dos reservadas), así que se leen por índice, no por orden.
 */
import type {
  WsusApproval, WsusApprovalRule, WsusCategory, WsusCleanupResult, WsusComputer,
  WsusComputerUpdate, WsusConfigSummary, WsusDownstreamServer, WsusEmailConfig, WsusEvent,
  WsusGroup, WsusOverview, WsusProductsAndClassifications, WsusStateCounts, WsusSyncRun,
  WsusUpdate, WsusUpdateDetail, WsusUpdateRef
} from '../../shared/types'
import { readRow, readRows, type Row, type WsusSoapClient } from './soap'
import { adminNameFor, clientFor, writableClient } from './session'
import { child, children, escapeXml, textOf, type XmlNode } from './xml'

const CULTURE = 'es'
const ANY_PUBLICATION = 2147483647
const SCOPE_ALL_UPDATES = '<UpdateScope ApprovedStates="-1" />'
const SCOPE_ALL_COMPUTERS = '<ComputerTargetScope IncludeDownstreamComputerTargets="false" />'
/** Sin fecha límite, como la manda la consola de Windows. */
const NO_DEADLINE = '9999-12-31T23:59:59.997'

export const GROUP_ALL = 'a0a08746-4dbe-4a37-9adf-9e7652c0b421'
export const GROUP_UNASSIGNED = 'b73ca6ed-5727-47f3-84de-015e03f6a88a'
export const GROUP_DOWNSTREAM = 'd374f42a-9be2-4163-a0fa-3c86a401b7a7'
const BUILTIN = new Set([GROUP_ALL, GROUP_UNASSIGNED, GROUP_DOWNSTREAM])

const str = (v: unknown): string | undefined => (v === null || v === undefined || v === '' ? undefined : String(v))
const num = (v: unknown): number => (typeof v === 'number' ? v : Number(v) || 0)
const bool = (v: unknown): boolean => v === true || v === 'true' || v === 1

/** Fechas de SQL Server sin zona: son UTC. */
function utc(v: unknown): string | undefined {
  const s = str(v)
  if (!s || s.startsWith('0001-01-01') || s.startsWith('1753-01-01') || s.startsWith('9999-')) return undefined
  return /[zZ]|[+-]\d\d:\d\d$/.test(s) ? s : `${s}Z`
}

function emptyCounts(): WsusStateCounts {
  return { unknown: 0, notApplicable: 0, notInstalled: 0, downloaded: 0, installed: 0, failed: 0, pendingReboot: 0 }
}

const STATE_KEYS: (keyof WsusStateCounts)[] = [
  'unknown', 'notApplicable', 'notInstalled', 'downloaded', 'installed', 'failed', 'pendingReboot'
]

function addCount(c: WsusStateCounts, state: number, n: number): void {
  const k = STATE_KEYS[state]
  if (k) c[k] += n
}

function revisionXml(id: string, revision: number): { xml: string } {
  return { xml: `<UpdateId>${escapeXml(id)}</UpdateId><RevisionNumber>${revision}</RevisionNumber>` }
}

function guids(ids: string[]): { items: string[]; tag: string } {
  return { items: ids, tag: 'guid' }
}

/* ------------------------------ Resumen ------------------------------ */

export async function overview(serverId: string): Promise<WsusOverview> {
  const { client, server } = await clientFor(serverId)
  const [version, protocolVersion, role] = await Promise.all([
    client.scalar('GetServerVersion'),
    client.scalar('GetServerProtocolVersion').catch(() => undefined),
    client.scalar('GetCurrentUserRole')
  ])
  if (Number(role) === 0) {
    throw new Error('El usuario no tiene ningún rol en este WSUS: hace falta ser administrador local o de «Administradores WSUS».')
  }
  const [db, computers, updates, subscription, progress, download, errors, config] = await Promise.all([
    client.call('GetDatabaseConfiguration').catch(() => undefined),
    client.scalar('ExecuteSPGetComputerCount', [['computerTargetScopeXml', SCOPE_ALL_COMPUTERS]]),
    client.scalar('ExecuteSPGetUpdateCount', [
      ['updateScopeXml', SCOPE_ALL_UPDATES], ['preferredCulture', CULTURE], ['publicationState', ANY_PUBLICATION]
    ]),
    readSubscription(client),
    client.rows('GetServerSyncProgress').catch(() => [] as Row[]),
    client.call('ExecuteSPGetContentDownloadProgress').catch(() => undefined),
    client.call('ExecuteSPGetComponentsWithErrors').catch(() => undefined),
    readConfiguration(client)
  ])
  const dl = children(child(download, 'Values'), 'anyType').map((n) => Number(n.text) || 0)
  const languages = await client.rows('ExecuteSPGetAllLanguagesWithEnabledState').catch(() => [] as Row[])

  return {
    version: version ?? '',
    protocolVersion,
    role: Number(role) || 0,
    database: {
      server: textOf(db, 'serverName') ?? textOf(child(db, 'GetDatabaseConfigurationResult'), 'serverName'),
      name: textOf(db, 'databaseName') ?? textOf(child(db, 'GetDatabaseConfigurationResult'), 'databaseName')
    },
    computerCount: Number(computers) || 0,
    updateCount: Number(updates) || 0,
    subscription,
    syncPhase: num(progress[0]?.[0]),
    syncRunning: num(progress[0]?.[0]) !== 0 || subscription.state === 2 || subscription.state === 3,
    syncTotal: num(progress[0]?.[1]),
    syncProcessed: num(progress[0]?.[2]),
    // La especificación no fija el orden de los dos valores; lo descargado nunca supera al total.
    download: { done: Math.min(dl[0] ?? 0, dl[1] ?? 0), total: Math.max(dl[0] ?? 0, dl[1] ?? 0) },
    componentsWithErrors: children(errors, 'string').map((n) => n.text),
    config: summarizeConfig(config, languages),
    allowWrites: server.allowWrites,
    adminName: adminNameFor(server)
  }
}

async function readSubscription(client: WsusSoapClient): Promise<WsusOverview['subscription']> {
  const [sub, next, state] = await Promise.all([
    client.call('GetSubscription'),
    client.scalar('GetSubscriptionNextSynchronizationTime').catch(() => undefined),
    client.scalar('GetSubscriptionState').catch(() => undefined)
  ])
  return {
    synchronizeAutomatically: textOf(sub, 'SynchronizeAutomatically') === 'true',
    timeOfDay: Number(textOf(sub, 'synchronizeAutomaticallyTimeOfDay')) || 0,
    perDay: Number(textOf(sub, 'NumberOfSynchronizationsPerDay')) || 1,
    lastSync: utc(textOf(sub, 'LastSynchronizationTime')),
    nextSync: utc(next),
    lastModifiedBy: str(textOf(sub, 'LastModifiedBy')),
    lastModified: utc(textOf(sub, 'LastModifiedTime')),
    state: Number(state) || 0
  }
}

async function readConfiguration(client: WsusSoapClient): Promise<XmlNode> {
  const r = await client.call('ExecuteSPGetConfiguration')
  const cfg = child(r, 'Configuration')
  if (!cfg) throw new Error('El servidor no devolvió su configuración.')
  return cfg
}

function summarizeConfig(cfg: XmlNode, languages: Row[]): WsusConfigSummary {
  const t = (n: string): string | undefined => str(textOf(cfg, n))
  const b = (n: string): boolean => textOf(cfg, n) === 'true'
  return {
    syncFromMicrosoft: b('SyncToMU'),
    upstreamServer: t('UpstreamServerName'),
    upstreamPort: Number(t('ServerPortNumber')) || 8530,
    upstreamSsl: b('UpstreamServerUseSsl'),
    replica: b('ReplicaMode'),
    useProxy: b('UseProxy'),
    proxyName: t('ProxyName'),
    proxyPort: Number(t('ProxyServerPort')) || 80,
    storeLocally: !b('HostOnMu'),
    contentPath: t('LocalContentCacheLocation'),
    downloadOnlyApproved: b('LazySync'),
    expressPackages: b('DownloadExpressPackages'),
    serverTargeting: b('ServerTargeting'),
    computerDeletionDays: Number(t('computerDeletionTimeThreshold')) || 30,
    allLanguages: b('ServerSupportsAllLanguages'),
    languages: languages.filter((r) => r[0] !== 'all' && bool(r[1])).map((r) => String(r[0])),
    driversDisabled: b('DisableSyncDrivers')
  }
}

/* ------------------------------ Grupos y equipos ------------------------------ */

export async function groups(serverId: string): Promise<WsusGroup[]> {
  const { client } = await clientFor(serverId)
  return parseGroups(await client.rows('ExecuteSPGetAllTargetGroups'))
}

function parseGroups(rows: Row[]): WsusGroup[] {
  // «Downstream Servers» es del tipo de grupo de los servidores secundarios: va aparte.
  return rows.filter((r) => r[0] === 'Computers').map((r) => ({
    id: String(r[2]),
    name: String(r[1]),
    parentId: str(r[5]),
    builtin: BUILTIN.has(String(r[2])),
    computerCount: 0
  }))
}

export async function computers(serverId: string): Promise<{ computers: WsusComputer[]; groups: WsusGroup[] }> {
  const { client } = await clientFor(serverId)
  const [sets, summaries, groupRows] = await Promise.all([
    client.rowSets('ExecuteSPSearchComputers', [['computerTargetScopeXml', SCOPE_ALL_COMPUTERS]]),
    client.rows('ExecuteSPGetSummariesPerComputer', [
      ['updateScopeXml', SCOPE_ALL_UPDATES], ['computerTargetScopeXml', SCOPE_ALL_COMPUTERS],
      ['preferredCulture', CULTURE], ['publicationState', ANY_PUBLICATION]
    ]),
    client.rows('ExecuteSPGetAllTargetGroups')
  ])

  const counts = new Map<string, WsusStateCounts>()
  for (const r of summaries) {
    const id = String(r[2])
    const c = counts.get(id) ?? emptyCounts()
    addCount(c, num(r[3]), num(r[4]))
    counts.set(id, c)
  }

  const assigned = new Map<string, string[]>()
  for (const r of sets[2] ?? []) {
    const list = assigned.get(String(r[0])) ?? []
    list.push(String(r[1]))
    assigned.set(String(r[0]), list)
  }

  const list = (sets[0] ?? []).map((r) => parseComputer(r, assigned.get(String(r[0])) ?? [], counts.get(String(r[0]))))
  const groupList = parseGroups(groupRows)
  for (const g of groupList) {
    g.computerCount = list.filter((c) => c.groupIds.includes(g.id)).length
  }
  return { computers: list, groups: groupList }
}

function parseComputer(r: Row, groupIds: string[], counts?: WsusStateCounts): WsusComputer {
  const version = [r[5], r[6], r[7]].filter((v) => v !== null && v !== undefined).join('.')
  return {
    id: String(r[0]),
    name: String(r[4] ?? r[0]),
    ip: str(r[3]),
    lastSync: utc(r[1]),
    lastReport: utc(r[2]),
    osVersion: version || undefined,
    locale: str(r[10]),
    make: str(r[11]),
    model: str(r[12]),
    requestedGroup: str(r[17]),
    lastSyncResult: num(r[20]),
    clientVersion: str(r[25]),
    os: str(r[27]) ?? str(r[26]),
    groupIds,
    counts: counts ?? emptyCounts()
  }
}

/**
 * Ojo: MS-WSUSAR documenta el parámetro como «ComputerId», pero el servicio lo
 * espera en minúscula; con la mayúscula responde «Value cannot be null».
 */
export async function computerUpdates(serverId: string, computerId: string): Promise<WsusComputerUpdate[]> {
  const { client } = await clientFor(serverId)
  const [rows, updates] = await Promise.all([
    client.rows('ExecuteSPGetUpdateInstallationInfoForComputer', [
      ['computerId', computerId], ['updateScopeXml', SCOPE_ALL_UPDATES],
      ['preferredCulture', CULTURE], ['publicationState', ANY_PUBLICATION]
    ]),
    updateIndex(serverId, client)
  ])
  // UpdateInstallationInformation: 0 actualización, 1 equipo, 2 estado, 3 acción, 4 grupo.
  return rows.map((r) => {
    const u = updates.get(String(r[0]))
    return {
      updateId: String(r[0]),
      title: u?.title ?? String(r[0]),
      kb: u?.kb ?? [],
      classification: u?.classification,
      msrc: u?.msrc ?? 'Unspecified',
      state: num(r[2])
    }
  })
}

export async function computerEvents(serverId: string, computerId: string, days = 30): Promise<WsusEvent[]> {
  const { client } = await clientFor(serverId)
  return searchEvents(client, { days, targetId: computerId })
}

export async function createGroup(serverId: string, name: string, parentId: string): Promise<WsusGroup> {
  const client = await writableClient(serverId)
  const r = await client.call('ExecuteSPCreateTargetGroup1', [['name', name], ['parentGroupId', parentId || GROUP_ALL]])
  const row = readRow(r)
  return { id: String(row[2] ?? ''), name, parentId: parentId || GROUP_ALL, builtin: false, computerCount: 0 }
}

export async function deleteGroup(serverId: string, groupId: string): Promise<void> {
  if (BUILTIN.has(groupId)) throw new Error('Los grupos que trae WSUS no se pueden borrar.')
  const { server } = await clientFor(serverId)
  const client = await writableClient(serverId)
  await client.call('ExecuteSPDeleteTargetGroup', [['id', groupId], ['adminName', adminNameFor(server)], ['failIfReplica', true]])
}

/**
 * Pertenencia de un equipo. Con asignación del lado del servidor un equipo puede
 * estar en varios grupos; «Todos los equipos» y «Sin asignar» los maneja WSUS.
 */
export async function setComputerGroups(serverId: string, computerId: string, current: string[], wanted: string[]): Promise<void> {
  const client = await writableClient(serverId)
  const manejables = (ids: string[]): string[] => ids.filter((g) => g !== GROUP_ALL && g !== GROUP_UNASSIGNED)
  for (const g of manejables(wanted)) {
    if (!current.includes(g)) {
      await client.call('ExecuteSPAddComputerToTargetGroupAllowMultipleGroups', [['targetGroupId', g], ['computerId', computerId]])
    }
  }
  for (const g of manejables(current)) {
    if (!wanted.includes(g)) {
      await client.call('ExecuteSPRemoveComputerFromTargetGroup', [['targetGroupId', g], ['computerId', computerId]])
    }
  }
}

export async function deleteComputer(serverId: string, computerId: string): Promise<void> {
  const client = await writableClient(serverId)
  await client.call('ExecuteSPDeleteComputer', [['id', computerId]])
}

/* ------------------------------ Actualizaciones ------------------------------ */

interface UpdateIndexEntry {
  title: string
  kb: string[]
  classification?: string
  msrc: string
  revision: number
  declined: boolean
}

/**
 * Títulos por id, para armar las vistas por equipo sin volver a traer 10 MB de
 * metadatos. Se renueva cada vez que se lista el catálogo completo.
 */
const indexCache = new Map<string, { at: number; map: Map<string, UpdateIndexEntry> }>()

async function updateIndex(serverId: string, client: WsusSoapClient): Promise<Map<string, UpdateIndexEntry>> {
  const cached = indexCache.get(serverId)
  if (cached && Date.now() - cached.at < 10 * 60_000) return cached.map
  await searchUpdates(serverId, client)
  return indexCache.get(serverId)!.map
}

async function searchUpdates(serverId: string, client: WsusSoapClient): Promise<WsusUpdate[]> {
  const r = await client.call('ExecuteSPSearchUpdates', [
    ['updateScopeXml', SCOPE_ALL_UPDATES], ['preferredCulture', CULTURE], ['publicationState', ANY_PUBLICATION]
  ])
  const list = parseCompleteUpdates(r)
  const map = new Map<string, UpdateIndexEntry>()
  for (const u of list) {
    map.set(u.id, { title: u.title, kb: u.kb, classification: u.classification, msrc: u.msrc, revision: u.revision, declined: u.declined })
  }
  indexCache.set(serverId, { at: Date.now(), map })
  return list
}

function parseCompleteUpdates(node: XmlNode | undefined): WsusUpdate[] {
  const minimal = readRows(child(node, 'minimalProperties'))
  const byRevision = new Map<number, WsusUpdate>()
  const list: WsusUpdate[] = []
  for (const r of minimal) {
    const u: WsusUpdate = {
      id: String(r[0]),
      revision: num(r[1]),
      revisionId: num(r[2]),
      localId: num(r[3]),
      rebootBehavior: num(r[7]),
      uninstallable: bool(r[10]),
      created: utc(r[17]),
      state: num(r[19]),
      requiresEula: bool(r[21]),
      declined: bool(r[22]),
      latestRevision: bool(r[24]),
      arrival: utc(r[25]),
      supersedes: bool(r[26]),
      msrc: str(r[28]) ?? 'Unspecified',
      title: str(r[29]) ?? str(r[27]) ?? String(r[0]),
      description: str(r[30]),
      superseded: bool(r[34]),
      expired: num(r[16]) === 1,
      kb: [],
      bulletins: [],
      urls: [],
      products: [],
      approvals: [],
      counts: emptyCounts()
    }
    byRevision.set(u.revisionId, u)
    list.push(u)
  }
  for (const r of readRows(child(node, 'localizedCategoryTitleRows'))) {
    const u = byRevision.get(num(r[0]))
    if (!u) continue
    if (r[1] === 'UpdateClassification') u.classification = String(r[2])
    else if (r[1] === 'Product') u.products.push(String(r[2]))
  }
  for (const [set, key] of [['kbArticles', 'kb'], ['bulletins', 'bulletins'], ['infoUrls', 'urls']] as const) {
    for (const r of readRows(child(node, set))) byRevision.get(num(r[0]))?.[key].push(String(r[1]))
  }
  return list
}

function parseApproval(r: Row): WsusApproval & { updateId: string } {
  return {
    time: utc(r[0]),
    action: num(r[2]),
    deadline: utc(r[4]),
    admin: str(r[5]),
    id: String(r[6]),
    updateId: String(r[8]),
    revision: num(r[9]),
    groupId: String(r[10])
  }
}

export async function updates(serverId: string): Promise<WsusUpdate[]> {
  const { client } = await clientFor(serverId)
  const [list, deployments, summaries] = await Promise.all([
    searchUpdates(serverId, client),
    client.rows('ExecuteSPGetDeployments', [
      ['updateScopeXml', SCOPE_ALL_UPDATES], ['preferredCulture', CULTURE], ['publicationState', ANY_PUBLICATION]
    ]),
    client.rows('ExecuteSPGetSummariesPerUpdate', [
      ['updateScopeXml', SCOPE_ALL_UPDATES], ['computerTargetScopeXml', SCOPE_ALL_COMPUTERS],
      ['preferredCulture', CULTURE], ['publicationState', ANY_PUBLICATION]
    ])
  ])
  const byId = new Map(list.map((u) => [u.id, u]))
  for (const r of deployments) {
    const a = parseApproval(r)
    const u = byId.get(a.updateId)
    if (u) {
      const { updateId: _u, ...rest } = a
      u.approvals.push(rest)
    }
  }
  for (const r of summaries) {
    const u = byId.get(String(r[0]))
    if (u) addCount(u.counts, num(r[3]), num(r[4]))
  }
  return list
}

function toRef(u: WsusUpdate): WsusUpdateRef {
  return { id: u.id, revision: u.revision, title: u.title, kb: u.kb, declined: u.declined }
}

export async function updateDetail(serverId: string, updateId: string, revision: number): Promise<WsusUpdateDetail> {
  const { client } = await clientFor(serverId)
  const rid = revisionXml(updateId, revision)
  const [by, sup, installs, groupRows] = await Promise.all([
    client.call('ExecuteSPGetUpdatesThatSupersedeUpdate', [['preferredCulture', CULTURE], ['id', rid]]),
    client.call('ExecuteSPGetUpdatesSupersededByUpdate', [['preferredCulture', CULTURE], ['id', rid]]),
    client.rows('ExecuteSPGetUpdateInstallationInfoForUpdate', [['updateId', updateId], ['computerTargetScopeXml', SCOPE_ALL_COMPUTERS]]),
    client.rows('ExecuteSPGetTargetGroupSummariesForUpdate', [['updateId', updateId], ['includeSubgroups', true]])
  ])
  const groupMap = new Map<string, WsusStateCounts>()
  for (const r of groupRows) {
    const g = String(r[1])
    const c = groupMap.get(g) ?? emptyCounts()
    addCount(c, num(r[3]), num(r[4]))
    groupMap.set(g, c)
  }
  return {
    supersededBy: parseCompleteUpdates(by).map(toRef),
    supersedes: parseCompleteUpdates(sup).map(toRef),
    // UpdateInstallationInformation: 0 actualización, 1 equipo, 2 estado, 3 acción, 4 grupo.
    computers: installs.map((r) => ({ computerId: String(r[1]), state: num(r[2]), groupId: str(r[4]) })),
    groups: [...groupMap].map(([groupId, counts]) => ({ groupId, counts }))
  }
}

/**
 * Aprobar, quitar o volver a «no aprobada» para un grupo. Es la misma llamada
 * que hace la consola de Windows: una aprobación por grupo, con fecha límite
 * opcional. Aprobar algo rechazado lo saca del rechazo.
 */
export async function approve(
  serverId: string,
  items: { id: string; revision: number }[],
  approvals: { groupId: string; action: number; deadline?: string }[]
): Promise<{ id: string; error?: string }[]> {
  const { server } = await clientFor(serverId)
  const client = await writableClient(serverId)
  const admin = adminNameFor(server)
  const out: { id: string; error?: string }[] = []
  for (const u of items) {
    try {
      for (const a of approvals) {
        // En el protocolo «no aprobada» es 2, aunque MS-WSUSAR 2.2.5.3 diga 3: con 3 el
        // servidor crea un bloqueo, o la rechaza si el grupo es «Todos los equipos».
        if (![0, 1, 2].includes(a.action)) throw new Error(`Acción de aprobación desconocida: ${a.action}`)
        await client.call('ExecuteSPDeployUpdate1', [
          ['updateId', revisionXml(u.id, u.revision)],
          ['deploymentAction', a.action],
          ['targetGroupId', a.groupId],
          ['deadline', a.deadline ? new Date(a.deadline) : NO_DEADLINE],
          ['adminName', admin],
          ['isAssigned', true]
        ])
      }
      out.push({ id: u.id })
    } catch (e) {
      out.push({ id: u.id, error: (e as Error).message })
    }
  }
  indexCache.delete(serverId)
  return out
}

export async function decline(serverId: string, ids: string[]): Promise<{ id: string; error?: string }[]> {
  const { server } = await clientFor(serverId)
  const client = await writableClient(serverId)
  const admin = adminNameFor(server)
  const out: { id: string; error?: string }[] = []
  for (const id of ids) {
    try {
      await client.call('ExecuteSPDeclineUpdate', [['updateId', id], ['adminName', admin], ['failIfReplica', true]])
      out.push({ id })
    } catch (e) {
      out.push({ id, error: (e as Error).message })
    }
  }
  indexCache.delete(serverId)
  return out
}

export async function setDownload(serverId: string, items: { id: string; revision: number }[], resume: boolean): Promise<void> {
  const client = await writableClient(serverId)
  for (const u of items) {
    await client.call(resume ? 'ExecuteSPResumeDownload' : 'ExecuteSPCancelDownload', [['id', revisionXml(u.id, u.revision)]])
  }
}

export async function setAllDownloads(serverId: string, resume: boolean): Promise<void> {
  const client = await writableClient(serverId)
  await client.call(resume ? 'ExecuteSPResumeAllDownloads' : 'ExecuteSPCancelAllDownloads')
}

export async function acceptEula(serverId: string, updateId: string, revision: number): Promise<void> {
  const { client: reader, server } = await clientFor(serverId)
  const r = await reader.call('ExecuteSPGetUpdateById', [['preferredCulture', CULTURE], ['id', revisionXml(updateId, revision)]])
  const eulaId = str(readRows(child(r, 'minimalProperties'))[0]?.[20])
  if (!eulaId) throw new Error('La actualización no tiene un contrato de licencia asociado.')
  const client = await writableClient(serverId)
  await client.call('ExecuteSPAcceptEula', [['eulaId', eulaId], ['adminName', adminNameFor(server)], ['updateId', revisionXml(updateId, revision)]])
}

/* ------------------------------ Sincronización ------------------------------ */

export async function startSync(serverId: string): Promise<void> {
  const client = await writableClient(serverId)
  await client.call('StartSubscriptionManually')
}

export async function stopSync(serverId: string): Promise<void> {
  const client = await writableClient(serverId)
  await client.call('StopSubscription')
}

/** Eventos de servidor de MS-WSUSAR: espacio de nombres 2, del 381 al 386. */
const SYNC_EVENTS = [381, 382, 383, 384, 385, 386]
const SYNC_MESSAGE: Record<number, string> = {
  384: 'Sincronización completa.',
  385: 'Sincronización cancelada.',
  386: 'La sincronización falló.'
}

export async function syncHistory(serverId: string, days = 60): Promise<WsusSyncRun[]> {
  const { client } = await clientFor(serverId)
  const events = await searchEvents(client, { days, namespace: 2, eventIds: SYNC_EVENTS })
  events.sort((a, b) => a.time.localeCompare(b.time))
  const runs: WsusSyncRun[] = []
  let open: WsusSyncRun | null = null
  for (const e of events) {
    if (e.eventId === 381 || e.eventId === 382) {
      open = { start: e.time, manual: e.eventId === 382, result: 'en curso' }
      runs.push(open)
    } else if (e.eventId >= 384) {
      const run: WsusSyncRun = open ?? { start: e.time, manual: false, result: 'en curso' }
      if (!open) runs.push(run)
      run.end = e.time
      run.result = e.eventId === 384 ? 'ok' : e.eventId === 385 ? 'cancelada' : 'error'
      if (e.hresult) run.hresult = e.hresult
      run.message = SYNC_MESSAGE[e.eventId] ?? e.message
      open = null
    }
  }
  return runs.reverse()
}

async function searchEvents(
  client: WsusSoapClient,
  q: { days: number; namespace?: number; eventIds?: number[]; targetId?: string }
): Promise<WsusEvent[]> {
  const to = new Date(Date.now() + 86_400_000).toISOString()
  const from = new Date(Date.now() - q.days * 86_400_000).toISOString()
  const ids = (q.eventIds ?? [])
    .map((id) => `<EventIdFilter><NamespaceId>${q.namespace ?? 1}</NamespaceId><EventId>${id}</EventId></EventIdFilter>`)
    .join('')
  const filter =
    (ids ? `<eventIdFilter>${ids}</eventIdFilter>` : '') +
    `<fromTimeAtTarget>${from}</fromTimeAtTarget><toTimeAtTarget>${to}</toTimeAtTarget>` +
    `<fromTimeAtServer>${from}</fromTimeAtServer><toTimeAtServer>${to}</toTimeAtServer>` +
    (q.targetId ? `<targetId>${escapeXml(q.targetId)}</targetId>` : '')
  const r = await client.call('ExecuteSPSearchEventHistory', [['eventHistoryFilter', { xml: filter }]])
  return children(r, 'EventHistoryTableRow').map((n) => {
    const repl = children(child(n, 'ReplacementStrings'), 'string').map((s) => s.text)
    const template = textOf(n, 'MessageTemplate') ?? ''
    return {
      time: utc(textOf(n, 'TimeAtServer')) ?? '',
      namespace: Number(textOf(n, 'NamespaceId')) || 0,
      eventId: Number(textOf(n, 'EventId')) || 0,
      severity: Number(textOf(n, 'SeverityId')) || 0,
      hresult: Number(textOf(n, 'Win32HResult')) || 0,
      message: template.replace(/%(\d+)/g, (_m, i: string) => repl[Number(i) - 1] ?? ''),
      computerId: str(textOf(n, 'ComputerId')),
      updateId: str(textOf(n, 'UpdateId'))
    }
  })
}

/* ------------------------------ Opciones ------------------------------ */

export async function productsAndClassifications(serverId: string): Promise<WsusProductsAndClassifications> {
  const { client } = await clientFor(serverId)
  const desde = '2000-01-01T00:00:00Z'
  const hasta = new Date(Date.now() + 86_400_000).toISOString()
  const [classes, cats, selClasses, selCats] = await Promise.all([
    client.rows('ExecuteSPGetCategories', [['preferredCulture', CULTURE], ['retrieveUpdateClassifications', true], ['fromSyncDate', desde], ['toSyncDate', hasta]]),
    client.rows('ExecuteSPGetCategories', [['preferredCulture', CULTURE], ['retrieveUpdateClassifications', false], ['fromSyncDate', desde], ['toSyncDate', hasta]]),
    client.rows('GetSubscriptionCategories', [['preferredCulture', CULTURE], ['retrieveUpdateClassifications', true]]),
    client.rows('GetSubscriptionCategories', [['preferredCulture', CULTURE], ['retrieveUpdateClassifications', false]])
  ])
  const products = cats.map(parseCategory)
  // El árbol de productos no viene en la fila: hay que pedir los hijos de cada familia.
  await fillParents(client, products)
  return {
    classifications: classes.map(parseCategory).sort((a, b) => a.title.localeCompare(b.title, 'es')),
    products,
    selectedClassifications: selClasses.map((r) => String(r[1])),
    selectedProducts: selCats.map((r) => String(r[1]))
  }
}

function parseCategory(r: Row): WsusCategory {
  return {
    id: String(r[1]),
    type: String(r[2]),
    title: str(r[7]) ?? String(r[1]),
    description: str(r[8]),
    arrival: utc(r[10])
  }
}

async function fillParents(client: WsusSoapClient, list: WsusCategory[]): Promise<void> {
  const byId = new Map(list.map((c) => [c.id, c]))
  const parents = list.filter((c) => c.type === 'Company' || c.type === 'ProductFamily')
  const results = await Promise.all(parents.map((p) =>
    client.rows('ExecuteSPGetSubcategories', [['preferredCulture', CULTURE], ['categoryId', p.id]])
      .then((rows) => ({ p, rows }))
      .catch(() => ({ p, rows: [] as Row[] }))
  ))
  for (const { p, rows } of results) {
    for (const r of rows) {
      const c = byId.get(String(r[1]))
      if (c && !c.parentId) c.parentId = p.id
    }
  }
}

export async function setProductsAndClassifications(serverId: string, productIds: string[], classificationIds: string[]): Promise<void> {
  const { client: reader, server } = await clientFor(serverId)
  const client = await writableClient(serverId)
  const sub = await reader.call('GetSubscription')
  if (!sub) throw new Error('El servidor no devolvió la suscripción.')
  await client.call('SetSubscription', [
    ['subscription', { xml: reserialize(sub) }],
    ['categoryIds', guids(productIds)],
    ['updateClassificationIds', guids(classificationIds)],
    ['userName', adminNameFor(server)]
  ])
}

export async function setSchedule(
  serverId: string,
  s: { synchronizeAutomatically: boolean; timeOfDay: number; perDay: number }
): Promise<void> {
  if (s.perDay < 1 || s.perDay > 24) throw new Error('Las sincronizaciones por día van de 1 a 24.')
  const { client: reader, server } = await clientFor(serverId)
  const client = await writableClient(serverId)
  const [sub, selClasses, selCats] = await Promise.all([
    reader.call('GetSubscription'),
    reader.rows('GetSubscriptionCategories', [['preferredCulture', CULTURE], ['retrieveUpdateClassifications', true]]),
    reader.rows('GetSubscriptionCategories', [['preferredCulture', CULTURE], ['retrieveUpdateClassifications', false]])
  ])
  if (!sub) throw new Error('El servidor no devolvió la suscripción.')
  // SetSubscription reemplaza también productos y clasificaciones: van los actuales.
  await client.call('SetSubscription', [
    ['subscription', {
      xml: reserialize(sub, {
        SynchronizeAutomatically: String(s.synchronizeAutomatically),
        synchronizeAutomaticallyTimeOfDay: String(Math.round(s.timeOfDay) % 86400),
        NumberOfSynchronizationsPerDay: String(s.perDay)
      })
    }],
    ['categoryIds', guids(selCats.map((r) => String(r[1])))],
    ['updateClassificationIds', guids(selClasses.map((r) => String(r[1])))],
    ['userName', adminNameFor(server)]
  ])
}

/** Reescribe un elemento leído del servidor tal cual, cambiando sólo los campos pedidos. */
function reserialize(node: XmlNode, patch: Record<string, string | null> = {}): string {
  return node.children.map((c) => {
    const v = c.name in patch ? patch[c.name] : c.attrs.nil === 'true' ? null : c.text
    return v === null ? `<${c.name} xsi:nil="true"/>` : `<${c.name}>${escapeXml(v)}</${c.name}>`
  }).join('')
}

export interface WsusConfigPatch {
  syncFromMicrosoft?: boolean
  upstreamServer?: string
  upstreamPort?: number
  upstreamSsl?: boolean
  replica?: boolean
  useProxy?: boolean
  proxyName?: string
  proxyPort?: number
  storeLocally?: boolean
  downloadOnlyApproved?: boolean
  expressPackages?: boolean
  serverTargeting?: boolean
  computerDeletionDays?: number
}

export async function setConfiguration(serverId: string, p: WsusConfigPatch): Promise<void> {
  const { client: reader } = await clientFor(serverId)
  const client = await writableClient(serverId)
  const cfg = await readConfiguration(reader)
  const patch: Record<string, string | null> = {}
  const set = (k: string, v: string | number | boolean | undefined): void => { if (v !== undefined) patch[k] = String(v) }
  set('SyncToMU', p.syncFromMicrosoft)
  if (p.upstreamServer !== undefined) patch.UpstreamServerName = p.upstreamServer.trim() || null
  set('ServerPortNumber', p.upstreamPort)
  set('UpstreamServerUseSsl', p.upstreamSsl)
  set('ReplicaMode', p.replica)
  set('UseProxy', p.useProxy)
  if (p.proxyName !== undefined) patch.ProxyName = p.proxyName.trim() || null
  set('ProxyServerPort', p.proxyPort)
  if (p.storeLocally !== undefined) patch.HostOnMu = String(!p.storeLocally)
  set('LazySync', p.downloadOnlyApproved)
  set('DownloadExpressPackages', p.expressPackages)
  set('ServerTargeting', p.serverTargeting)
  set('computerDeletionTimeThreshold', p.computerDeletionDays)
  if (p.syncFromMicrosoft === false && !(p.upstreamServer ?? textOf(cfg, 'UpstreamServerName'))) {
    throw new Error('Para sincronizar desde otro WSUS hace falta el nombre del servidor de origen.')
  }
  await client.call('ExecuteSPSetConfiguration', [
    ['row', { xml: reserialize(cfg, patch) }],
    ['listTrue', { xml: '' }],
    ['listFalse', { xml: '' }],
    ['ussListTrue', { xml: '' }],
    ['ussListFalse', { xml: '' }],
    ['programKeys', { xml: '' }]
  ])
}

/* ------------------------------ Aprobaciones automáticas ------------------------------ */

export async function approvalRules(serverId: string): Promise<WsusApprovalRule[]> {
  const { client } = await clientFor(serverId)
  const r = await client.call('GetAutomaticUpdateApprovalRules', [['preferredCulture', CULTURE]])
  return children(r, 'CompleteAutomaticUpdateApprovalRule').map(parseRule)
}

function parseRule(n: XmlNode): WsusApprovalRule {
  const row = child(n, 'RuleRow')
  const offset = textOf(row, 'DateOffset')
  const minutes = textOf(row, 'MinutesAfterMidnight')
  return {
    id: Number(textOf(row, 'Id')) || 0,
    name: textOf(row, 'Name') ?? '',
    enabled: textOf(row, 'Enabled') === 'true',
    action: Number(textOf(row, 'Action')) || 0,
    deadlineDays: offset ? Number(offset) : undefined,
    deadlineMinutes: minutes ? Number(minutes) : undefined,
    classificationIds: readRows(child(n, 'UpdateClassificationTableRows')).map((r) => String(r[1])),
    categoryIds: readRows(child(n, 'CategoryTableRows')).map((r) => String(r[1])),
    groupIds: readRows(child(n, 'TargetGroupTableRows')).map((r) => String(r[2]))
  }
}

export async function saveApprovalRule(serverId: string, rule: WsusApprovalRule): Promise<WsusApprovalRule> {
  const client = await writableClient(serverId)
  if (!rule.name.trim()) throw new Error('La regla necesita un nombre.')
  let id = rule.id
  if (!id) {
    const created = await client.call('CreateInstallApprovalRule', [['name', rule.name.trim()]])
    id = Number(textOf(child(created, 'RuleRow'), 'Id')) || 0
    if (!id) throw new Error('El servidor no devolvió el id de la regla nueva.')
  }
  await client.call('SetAutomaticUpdateApprovalRule', [
    ['ruleId', id],
    ['name', rule.name.trim()],
    ['enabled', rule.enabled],
    // Las reglas existentes vuelven con Action 0 (instalar): se respeta lo leído.
    ['action', rule.action],
    ['updateClassificationIds', guids(rule.classificationIds)],
    ['categoryIds', guids(rule.categoryIds)],
    ['targetGroupIds', guids(rule.groupIds)]
  ])
  return { ...rule, id }
}

export async function deleteApprovalRule(serverId: string, ruleId: number): Promise<void> {
  const client = await writableClient(serverId)
  await client.call('DeleteInstallApprovalRule', [['ruleId', ruleId]])
}

export async function runApprovalRule(serverId: string, ruleId: number): Promise<number> {
  const client = await writableClient(serverId)
  const r = await client.call('ApplyAutomaticUpdateApprovalRule', [['ruleId', ruleId]])
  return children(r, 'UpdateRevisionId').length
}

/* ------------------------------ Limpieza ------------------------------ */

export interface CleanupOptions {
  declineSuperseded: boolean
  declineExpired: boolean
  deleteObsoleteUpdates: boolean
  compressUpdates: boolean
  deleteObsoleteComputers: boolean
  deleteUnneededFiles: boolean
}

export async function cleanupPreview(serverId: string): Promise<{ obsoleteUpdates: number; updatesToCompress: number; staleComputers: number; computerDays: number }> {
  const { client } = await clientFor(serverId)
  const cfg = await readConfiguration(client)
  const days = Number(textOf(cfg, 'computerDeletionTimeThreshold')) || 30
  const [obsolete, compress, stale] = await Promise.all([
    client.scalar('ExecuteSPCountObsoleteUpdatesToCleanup'),
    client.scalar('ExecuteSPCountUpdatesToCompress'),
    client.scalar('ExecuteSPGetComputersNotContactedSinceCount', [['fromDate', new Date(Date.now() - days * 86_400_000)]])
  ])
  return { obsoleteUpdates: Number(obsolete) || 0, updatesToCompress: Number(compress) || 0, staleComputers: Number(stale) || 0, computerDays: days }
}

/**
 * El asistente de limpieza de la consola de Windows, paso por paso. Cada paso
 * sigue aunque falle el anterior: es lo que hace el asistente y lo que conviene
 * cuando la base es grande y un paso se corta por tiempo.
 */
export async function cleanup(serverId: string, o: CleanupOptions): Promise<WsusCleanupResult> {
  const { server } = await clientFor(serverId)
  const client = await writableClient(serverId)
  const admin = adminNameFor(server)
  const res: WsusCleanupResult = { errors: [] }
  const paso = async (label: string, fn: () => Promise<void>): Promise<void> => {
    try { await fn() } catch (e) { res.errors.push(`${label}: ${(e as Error).message}`) }
  }
  if (o.declineSuperseded) {
    await paso('Rechazar reemplazadas', async () => {
      res.supersededDeclined = Number(await client.scalar('ExecuteSPDeclineSupersededUpdates', [['adminName', admin]])) || 0
    })
  }
  if (o.declineExpired) {
    await paso('Rechazar vencidas', async () => {
      res.expiredDeclined = Number(await client.scalar('ExecuteSPDeclineExpiredUpdates', [['adminName', admin]])) || 0
    })
  }
  if (o.deleteObsoleteUpdates) {
    await paso('Borrar actualizaciones obsoletas', async () => {
      const r = await client.call('ExecuteSPGetObsoleteUpdatesToCleanup')
      const ids = children(r, 'int').map((n) => Number(n.text))
      res.obsoleteUpdatesDeleted = 0
      for (const id of ids) {
        await client.call('ExecuteSPDeleteUpdate', [['localUpdateID', id]])
        res.obsoleteUpdatesDeleted++
      }
    })
  }
  if (o.compressUpdates) {
    await paso('Comprimir revisiones', async () => {
      const r = await client.call('ExecuteSPGetUpdatesToCompress')
      const ids = children(r, 'int').map((n) => Number(n.text))
      res.updatesCompressed = 0
      for (const id of ids) {
        await client.call('ExecuteSPCompressUpdate', [['localUpdateID', id]])
        res.updatesCompressed++
      }
    })
  }
  if (o.deleteObsoleteComputers) {
    await paso('Borrar equipos que no se reportan', async () => {
      res.computersDeleted = Number(await client.scalar('ExecuteSPCleanupObsoleteComputers')) || 0
    })
  }
  if (o.deleteUnneededFiles) {
    await paso('Borrar archivos innecesarios', async () => {
      res.bytesFreed = Number(await client.scalar('ExecuteSPCleanupUnneededContentFiles2', [
        ['updateServerName', server.host], ['cleanupLocalPublishedContentFiles', false]
      ])) || 0
    })
  }
  indexCache.delete(serverId)
  return res
}

/* ------------------------------ Correo ------------------------------ */

export async function emailConfig(serverId: string): Promise<WsusEmailConfig> {
  const { client } = await clientFor(serverId)
  const [cfg, sync, status] = await Promise.all([
    client.call('ExecuteSPGetEmailNotificationConfiguration'),
    client.scalar('ExecuteSPGetEmailNotificationRecipients', [['value', 'NewSync']]).catch(() => ''),
    client.scalar('ExecuteSPGetEmailNotificationRecipients', [['value', 'Summary']]).catch(() => '')
  ])
  return {
    sendSyncNotification: textOf(cfg, 'EmailNeedToSendNewSyncNotification') === 'true',
    sendStatusNotification: textOf(cfg, 'EmailNeedToSendStatusNotification') === 'true',
    statusFrequency: textOf(cfg, 'StatusNotification') === 'Weekly' ? 'Weekly' : 'Daily',
    statusTimeOfDay: Number(textOf(cfg, 'statusNotificationTimeOfDay')) || 0,
    smtpHost: textOf(cfg, 'SmtpHostName') ?? '',
    smtpPort: Number(textOf(cfg, 'SmtpPort')) || 25,
    smtpRequiresAuth: textOf(cfg, 'SmtpServerRequireAuthentication') === 'true',
    smtpUser: textOf(cfg, 'SmtpUserName') ?? '',
    senderName: textOf(cfg, 'SmtpUserDisplayName') ?? '',
    senderAddress: textOf(cfg, 'SmtpUserMailAddress') ?? '',
    language: textOf(cfg, 'EmailLanguage') ?? 'en',
    syncRecipients: sync ?? '',
    statusRecipients: status ?? ''
  }
}

export async function setEmailConfig(serverId: string, e: WsusEmailConfig): Promise<void> {
  const { client: reader, server } = await clientFor(serverId)
  const client = await writableClient(serverId)
  const cfg = await reader.call('ExecuteSPGetEmailNotificationConfiguration')
  if (!cfg) throw new Error('El servidor no devolvió la configuración de correo.')
  await client.call('ExecuteSPSetEmailNotificationConfiguration', [['setting', {
    xml: reserialize(cfg, {
      statusNotificationTimeOfDay: String(Math.round(e.statusTimeOfDay) % 86400),
      EmailNeedToSendNewSyncNotification: String(e.sendSyncNotification),
      EmailNeedToSendStatusNotification: String(e.sendStatusNotification),
      StatusNotification: e.statusFrequency,
      SmtpServerRequireAuthentication: String(e.smtpRequiresAuth),
      SmtpHostName: e.smtpHost,
      SmtpPort: String(e.smtpPort),
      SmtpUserName: e.smtpUser,
      SmtpUserDisplayName: e.senderName,
      SmtpUserMailAddress: e.senderAddress,
      EmailLanguage: e.language || 'en',
      LastModifiedTime: new Date().toISOString(),
      LastModifiedBy: adminNameFor(server)
    })
  }]])
  await client.call('ExecuteSPSetEmailNotificationRecipients', [['recipients', e.syncRecipients], ['notificationType', 'NewSync']])
  await client.call('ExecuteSPSetEmailNotificationRecipients', [['recipients', e.statusRecipients], ['notificationType', 'Summary']])
}

export async function sendTestEmail(serverId: string, e: WsusEmailConfig): Promise<void> {
  const client = await writableClient(serverId)
  const to = e.statusRecipients || e.syncRecipients
  if (!to) throw new Error('Cargá al menos un destinatario.')
  await client.call('SendTestEmail', [
    ['emailLanguage', e.language || 'en'],
    ['smtpUserName', e.senderName],
    ['senderEmailAddress', e.senderAddress],
    ['smtpHostName', e.smtpHost],
    ['smtpPort', e.smtpPort],
    ['recipients', to]
  ])
}

/* ------------------------------ Servidores secundarios ------------------------------ */

export async function downstreamServers(serverId: string): Promise<WsusDownstreamServer[]> {
  const { client } = await clientFor(serverId)
  const rows = await client.rows('ExecuteSPGetAllDownstreamServers', [
    ['parentServerId', '00000000-0000-0000-0000-000000000000'], ['includeNestedChildren', true]
  ])
  return rows.map((r) => ({
    name: String(r[0]),
    id: String(r[1]),
    lastSync: utc(r[2]),
    parentId: str(r[3]),
    lastRollup: utc(r[4]),
    version: str(r[5]),
    replica: bool(r[6])
  }))
}

/** Para probar la conexión sin traer nada pesado. */
export async function ping(serverId: string): Promise<{ version: string; role: number }> {
  const { client } = await clientFor(serverId)
  const [version, role] = await Promise.all([client.scalar('GetServerVersion'), client.scalar('GetCurrentUserRole')])
  return { version: version ?? '', role: Number(role) || 0 }
}
