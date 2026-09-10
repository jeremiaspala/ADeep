/**
 * Administración de DFS.
 *
 * Espacios de nombres:
 *   - v1 (fTDfs + blob pKT): dominio en modo Windows 2000. Sólo lectura — los
 *     vínculos viven dentro del blob y reescribirlo a ciegas es demasiado riesgoso.
 *   - v2 (msDFS-Namespacev2 / msDFS-Linkv2): modo Windows 2008. Lectura y edición.
 * Replicación DFS-R: msDFSR-* bajo CN=DFSR-GlobalSettings,CN=System.
 *
 * Crear un espacio de nombres nuevo es MS-DFSNM (RPC contra el servidor), no LDAP.
 */
import type { AdConnection } from '../ldap/connection'
import { firstBuffer, firstNumber, firstString, allStrings } from '../ldap/directory'
import { escapeRDN, rdnValue, splitDN } from '../ldap/encoding'
import { parseSchedule, buildSchedule } from '../sites/operations'
import { parsePkt } from './pkt'
import type {
  DfsFolder, DfsNamespace, DfsTarget, DfsrConnectionInfo, DfsrGroup, DfsrMember
} from '../../shared/types'

export function dfsConfigDN(conn: AdConnection): string {
  return `CN=Dfs-Configuration,CN=System,${conn.baseDN}`
}

export function dfsrGlobalDN(conn: AdConnection): string {
  return `CN=DFSR-GlobalSettings,CN=System,${conn.baseDN}`
}

/* ---------------- Espacios de nombres ---------------- */

export async function listNamespaces(conn: AdConnection): Promise<DfsNamespace[]> {
  const [v1, v2] = await Promise.all([
    conn.searchRaw(dfsConfigDN(conn), {
      scope: 'sub', filter: '(objectClass=fTDfs)',
      attributes: ['name', 'pKT', 'remoteServerName', 'description']
    }).catch(() => []),
    conn.searchRaw(dfsConfigDN(conn), {
      scope: 'sub', filter: '(objectClass=msDFS-Namespacev2)',
      attributes: ['name', 'msDFS-Propertiesv2', 'msDFS-Ttlv2', 'msDFS-TargetListv2', 'msDFS-Commentv2']
    }).catch(() => [])
  ])

  const namespaces: DfsNamespace[] = []

  for (const e of v1) {
    const name = firstString(e, 'name') ?? rdnValue(e.dn)
    const blob = parsePkt(firstBuffer(e, 'pKT'))
    const root = blob.elements.find((x) => x.isRoot)

    // Si el blob no se pudo leer, al menos remoteServerName da los destinos de raíz.
    const fallbackTargets: DfsTarget[] = allStrings(e, 'remoteServerName')
      .filter((v) => v.startsWith('\\\\'))
      .map((v) => {
        const parts = v.replace(/^\\\\/, '').split('\\')
        return { path: v, server: parts[0] ?? '', share: parts.slice(1).join('\\'), enabled: true }
      })

    namespaces.push({
      dn: e.dn,
      name,
      version: 1,
      path: root?.prefix ?? `\\\\${conn.netbiosName ?? ''}\\${name}`,
      comment: root?.comment ?? firstString(e, 'description'),
      rootTargets: root?.targets.length ? root.targets : fallbackTargets,
      folders: blob.elements
        .filter((x) => !x.isRoot)
        .map((x) => ({
          path: relativePath(x.prefix, root?.prefix),
          comment: x.comment,
          targets: x.targets
        }))
        .sort((a, b) => a.path.localeCompare(b.path, 'es', { numeric: true })),
      partial: blob.partial
    })
  }

  for (const e of v2) {
    const name = firstString(e, 'name') ?? rdnValue(e.dn)
    const links = await conn.searchRaw(e.dn, {
      scope: 'sub', filter: '(objectClass=msDFS-Linkv2)',
      attributes: ['msDFS-LinkPathv2', 'msDFS-TargetListv2', 'msDFS-Commentv2', 'msDFS-Ttlv2']
    }).catch(() => [])

    namespaces.push({
      dn: e.dn,
      name,
      version: 2,
      path: `\\\\${conn.rootDSE.defaultNamingContext ? domainOf(conn) : ''}\\${name}`,
      comment: firstString(e, 'msDFS-Commentv2'),
      ttl: firstNumber(e, 'msDFS-Ttlv2'),
      rootTargets: parseTargetListV2(firstBuffer(e, 'msDFS-TargetListv2')),
      folders: links
        .map((l) => ({
          dn: l.dn,
          path: firstString(l, 'msDFS-LinkPathv2') ?? rdnValue(l.dn),
          comment: firstString(l, 'msDFS-Commentv2'),
          ttl: firstNumber(l, 'msDFS-Ttlv2'),
          targets: parseTargetListV2(firstBuffer(l, 'msDFS-TargetListv2'))
        }))
        .sort((a, b) => a.path.localeCompare(b.path, 'es', { numeric: true }))
    })
  }

  return namespaces.sort((a, b) => a.name.localeCompare(b.name, 'es'))
}

/**
 * msDFS-TargetListv2 es un XML en UTF-8 (MS-DFSNM 2.3.3.1):
 * <targets><target state="..." ...>\\servidor\recurso</target></targets>
 */
export function parseTargetListV2(buf?: Buffer): DfsTarget[] {
  if (!buf?.length) return []
  const xml = buf.toString('utf8').replace(/^﻿/, '')
  const out: DfsTarget[] = []
  const re = /<target\b([^>]*)>([^<]*)<\/target>/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(xml))) {
    const attrs = m[1]
    const path = m[2].trim()
    if (!path.startsWith('\\\\')) continue
    const parts = path.replace(/^\\\\/, '').split('\\')
    const state = /state="(\d+)"/i.exec(attrs)?.[1]
    const priorityClass = /priorityclass="(\d+)"/i.exec(attrs)?.[1]
    const priorityRank = /priorityrank="(\d+)"/i.exec(attrs)?.[1]
    out.push({
      path,
      server: parts[0] ?? '',
      share: parts.slice(1).join('\\'),
      enabled: state === undefined || (Number(state) & 0x2) !== 0,
      priorityClass: priorityClass ? Number(priorityClass) : undefined,
      priorityRank: priorityRank ? Number(priorityRank) : undefined
    })
  }
  return out
}

export function buildTargetListV2(targets: DfsTarget[]): Buffer {
  const body = targets
    .map((t) => {
      const state = t.enabled ? 2 : 0
      const prio = t.priorityClass !== undefined
        ? ` priorityclass="${t.priorityClass}" priorityrank="${t.priorityRank ?? 0}"`
        : ''
      return `<target state="${state}"${prio}>${escapeXml(t.path)}</target>`
    })
    .join('')
  return Buffer.from(`<targets>${body}</targets>`, 'utf8')
}

/** Sólo v2: en v1 los vínculos viven en el blob pKT y no se editan. */
export async function setFolderTargets(
  conn: AdConnection,
  linkDN: string,
  targets: DfsTarget[]
): Promise<void> {
  await conn.modify(linkDN, [
    { op: 'replace', attribute: 'msDFS-TargetListv2', values: [buildTargetListV2(targets)] }
  ])
}

export async function setFolderComment(conn: AdConnection, linkDN: string, comment: string): Promise<void> {
  await conn.modify(linkDN, [
    comment
      ? { op: 'replace', attribute: 'msDFS-Commentv2', values: [comment] }
      : { op: 'delete', attribute: 'msDFS-Commentv2', values: [] }
  ])
}

export async function setFolderTtl(conn: AdConnection, linkDN: string, ttl: number): Promise<void> {
  await conn.modify(linkDN, [
    { op: 'replace', attribute: 'msDFS-Ttlv2', values: [String(ttl)] }
  ])
}

export async function deleteFolder(conn: AdConnection, linkDN: string): Promise<void> {
  await conn.delete(linkDN)
}

export async function createFolder(
  conn: AdConnection,
  namespaceDN: string,
  path: string,
  targets: DfsTarget[],
  comment?: string
): Promise<string> {
  const cn = path.replace(/^\\+/, '').replace(/\\/g, '_')
  const dn = `CN=${escapeRDN(cn)},${namespaceDN}`
  await conn.add(dn, {
    objectClass: ['top', 'msDFS-Linkv2'],
    cn: [cn],
    'msDFS-LinkPathv2': [path.startsWith('\\') ? path : `\\${path}`],
    'msDFS-TargetListv2': [buildTargetListV2(targets)],
    'msDFS-Ttlv2': ['300'],
    ...(comment ? { 'msDFS-Commentv2': [comment] } : {})
  })
  return dn
}

/* ---------------- Replicación DFS-R ---------------- */

export async function listReplicationGroups(conn: AdConnection): Promise<DfsrGroup[]> {
  const base = dfsrGlobalDN(conn)
  const [groups, contents, members, subscriptions, connections, computers] = await Promise.all([
    conn.searchRaw(base, {
      scope: 'one', filter: '(objectClass=msDFSR-ReplicationGroup)',
      attributes: ['name', 'description', 'msDFSR-ReplicationGroupType', 'msDFSR-Schedule']
    }).catch(() => []),
    conn.searchRaw(base, {
      scope: 'sub', filter: '(objectClass=msDFSR-ContentSet)',
      attributes: ['name', 'description']
    }).catch(() => []),
    conn.searchRaw(base, {
      scope: 'sub', filter: '(objectClass=msDFSR-Member)',
      attributes: ['name', 'msDFSR-ComputerReference']
    }).catch(() => []),
    conn.searchRaw(base, {
      scope: 'sub', filter: '(objectClass=msDFSR-Subscription)',
      attributes: [
        'name', 'msDFSR-RootPath', 'msDFSR-StagingPath', 'msDFSR-Enabled',
        'msDFSR-ReadOnly', 'msDFSR-ContentSetGuid'
      ]
    }).catch(() => []),
    conn.searchRaw(base, {
      scope: 'sub', filter: '(objectClass=msDFSR-Connection)',
      attributes: ['name', 'msDFSR-MemberReference', 'msDFSR-Enabled', 'msDFSR-RdcEnabled', 'msDFSR-Schedule']
    }).catch(() => []),
    conn.searchRaw(conn.baseDN, {
      scope: 'sub', filter: '(objectCategory=computer)', attributes: ['name', 'dNSHostName']
    }).catch(() => [])
  ])

  const computerName = new Map(
    computers.map((c) => [c.dn.toLowerCase(), firstString(c, 'name') ?? rdnValue(c.dn)])
  )
  // El nombre visible de un miembro es el del equipo, no su GUID de RDN.
  const memberLabel = new Map<string, string>()
  for (const m of members) {
    const ref = firstString(m, 'msDFSR-ComputerReference')
    memberLabel.set(
      m.dn.toLowerCase(),
      (ref && computerName.get(ref.toLowerCase())) ?? firstString(m, 'name') ?? rdnValue(m.dn)
    )
  }

  const subsByMember = new Map<string, typeof subscriptions>()
  for (const s of subscriptions) {
    const member = parentOf(s.dn).toLowerCase()
    const list = subsByMember.get(member) ?? []
    list.push(s)
    subsByMember.set(member, list)
  }

  return groups
    .map((g) => {
      const groupKey = g.dn.toLowerCase()
      const inGroup = (dn: string): boolean => dn.toLowerCase().endsWith(`,${groupKey}`)
      const groupType = firstNumber(g, 'msDFSR-ReplicationGroupType') ?? 0

      const groupMembers: DfsrMember[] = members
        .filter((m) => inGroup(m.dn))
        .map((m) => {
          const ref = firstString(m, 'msDFSR-ComputerReference')
          const subs = subsByMember.get(m.dn.toLowerCase()) ?? []
          const sub = subs[0]
          return {
            dn: m.dn,
            name: memberLabel.get(m.dn.toLowerCase()) ?? rdnValue(m.dn),
            computerDN: ref,
            computerName: ref ? computerName.get(ref.toLowerCase()) : undefined,
            contentPath: sub ? firstString(sub, 'msDFSR-RootPath') : undefined,
            stagingPath: sub ? firstString(sub, 'msDFSR-StagingPath') : undefined,
            enabled: !sub || (firstString(sub, 'msDFSR-Enabled') ?? 'TRUE').toUpperCase() === 'TRUE',
            readOnly: !!sub && (firstString(sub, 'msDFSR-ReadOnly') ?? 'FALSE').toUpperCase() === 'TRUE',
            contentSetName: sub ? rdnValue(sub.dn) : undefined
          }
        })
        .sort((a, b) => a.name.localeCompare(b.name, 'es'))

      const groupConnections: DfsrConnectionInfo[] = connections
        .filter((c) => inGroup(c.dn))
        .map((c) => {
          const from = firstString(c, 'msDFSR-MemberReference') ?? ''
          return {
            dn: c.dn,
            name: firstString(c, 'name') ?? rdnValue(c.dn),
            fromMember: from,
            fromMemberName: memberLabel.get(from.toLowerCase()) ?? rdnValue(from),
            toMemberName: memberLabel.get(parentOf(c.dn).toLowerCase()) ?? rdnValue(parentOf(c.dn)),
            enabled: (firstString(c, 'msDFSR-Enabled') ?? 'TRUE').toUpperCase() === 'TRUE',
            rdc: (firstString(c, 'msDFSR-RdcEnabled') ?? 'TRUE').toUpperCase() === 'TRUE',
            schedule: parseSchedule(firstBuffer(c, 'msDFSR-Schedule'))
          }
        })
        .sort((a, b) => a.fromMemberName.localeCompare(b.fromMemberName, 'es'))

      return {
        dn: g.dn,
        name: firstString(g, 'name') ?? rdnValue(g.dn),
        description: firstString(g, 'description'),
        groupType,
        isSysvol: groupType === 1,
        contentSets: contents
          .filter((c) => inGroup(c.dn))
          .map((c) => ({
            dn: c.dn,
            name: firstString(c, 'name') ?? rdnValue(c.dn),
            description: firstString(c, 'description')
          })),
        members: groupMembers,
        connections: groupConnections,
        schedule: parseSchedule(firstBuffer(g, 'msDFSR-Schedule'))
      }
    })
    .sort((a, b) => Number(a.isSysvol) - Number(b.isSysvol) || a.name.localeCompare(b.name, 'es'))
}

export async function setDfsrConnectionEnabled(
  conn: AdConnection,
  dn: string,
  enabled: boolean
): Promise<void> {
  await conn.modify(dn, [
    { op: 'replace', attribute: 'msDFSR-Enabled', values: [enabled ? 'TRUE' : 'FALSE'] }
  ])
}

export async function setDfsrSchedule(
  conn: AdConnection,
  dn: string,
  schedule: boolean[] | null
): Promise<void> {
  await conn.modify(dn, [
    schedule
      ? { op: 'replace', attribute: 'msDFSR-Schedule', values: [buildSchedule(schedule)] }
      : { op: 'delete', attribute: 'msDFSR-Schedule', values: [] }
  ])
}

export async function setDfsrMemberEnabled(
  conn: AdConnection,
  subscriptionDN: string,
  enabled: boolean
): Promise<void> {
  await conn.modify(subscriptionDN, [
    { op: 'replace', attribute: 'msDFSR-Enabled', values: [enabled ? 'TRUE' : 'FALSE'] }
  ])
}

/* ---------------- Auxiliares ---------------- */

function relativePath(prefix: string, rootPrefix?: string): string {
  if (!rootPrefix) return prefix
  const lower = prefix.toLowerCase()
  const rootLower = rootPrefix.toLowerCase()
  return lower.startsWith(rootLower) ? prefix.slice(rootPrefix.length).replace(/^\\/, '') : prefix
}

function domainOf(conn: AdConnection): string {
  return splitDN(conn.baseDN)
    .filter((p) => p.toLowerCase().startsWith('dc='))
    .map((p) => p.slice(3))
    .join('.')
}

function parentOf(dn: string): string {
  return splitDN(dn).slice(1).join(',')
}

function escapeXml(v: string): string {
  return v.replace(/[<>&"']/g, (c) =>
    ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[c] ?? c
  )
}
