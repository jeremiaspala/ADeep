/**
 * Arnés de validación de la Fase 0. **Sólo lectura**: no ejecuta ninguna operación
 * que modifique el directorio, para poder correrlo contra un dominio productivo.
 *
 *   npm run validate
 *
 * Usa el perfil guardado (y su contraseña en safeStorage), por eso corre dentro de
 * Electron y no como script de Node suelto.
 */
import { app } from 'electron'
import { join } from 'node:path'
import { AdConnection } from './ldap/connection'
import {
  LIST_ATTRS, listChildren, listContainerChildren, resolveSids,
  toAttributeValues, toDirEntry
} from './ldap/directory'
import * as ops from './ldap/operations'
import { buildSecurityDescriptor, parseSecurityDescriptor } from './ldap/sddl'
import { SDFlagsControl } from './ldap/controls'
import { firstBuffer } from './ldap/directory'
import { dnToCanonical, escapeFilter } from './ldap/encoding'
import { guidFilter, sidFilter } from './ldap/filters'
import * as store from './store'
import type { DirEntry } from '../shared/types'

interface Check {
  name: string
  ok: boolean
  detail: string
  ms: number
}

const checks: Check[] = []

async function check<T>(name: string, fn: () => Promise<T>, describe: (v: T) => string): Promise<T | undefined> {
  const t0 = Date.now()
  try {
    const value = await fn()
    checks.push({ name, ok: true, detail: describe(value), ms: Date.now() - t0 })
    return value
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    checks.push({ name, ok: false, detail: msg, ms: Date.now() - t0 })
    return undefined
  }
}

async function main(): Promise<void> {
  // Corriendo el bundle suelto, Electron llamaría a la app "Electron" y buscaría el
  // perfil en ~/.config/Electron en vez de ~/.config/adeep.
  app.setName('adeep')
  app.setPath('userData', join(app.getPath('appData'), 'adeep'))
  app.disableHardwareAcceleration()

  await app.whenReady()

  const profiles = await store.getProfiles()
  const profile = profiles[0]
  if (!profile) throw new Error('No hay perfiles guardados en ~/.config/adeep/adeep.json')
  const password = await store.getSecret(profile.id)
  if (!password) {
    throw new Error(
      'El perfil no tiene contraseña guardada. Marcá "Guardar la contraseña" en la app y volvé a conectar.'
    )
  }

  console.log(`\nValidación de sólo lectura contra ${profile.host}:${profile.port} (${profile.security})`)
  console.log(`Bind: ${profile.bindDN}\n`)

  const conn = await AdConnection.connect(profile, password)

  console.log('rootDSE'.padEnd(28), conn.rootDSE.dnsHostName)
  console.log('defaultNamingContext'.padEnd(28), conn.rootDSE.defaultNamingContext)
  console.log('Nivel funcional dominio'.padEnd(28), conn.rootDSE.domainFunctionality)
  console.log('Nivel funcional bosque'.padEnd(28), conn.rootDSE.forestFunctionality)
  console.log('whoami'.padEnd(28), conn.whoami ?? '—')
  console.log('SID del dominio'.padEnd(28), conn.domainSID ?? '—')
  console.log('NetBIOS'.padEnd(28), conn.netbiosName ?? '—')
  console.log('MachineAccountQuota'.padEnd(28), conn.machineAccountQuota ?? '—')
  console.log()

  const base = conn.baseDN

  /* ---------------- Árbol y listado ---------------- */

  const root = await check('dir.roots', async () => {
    const e = await conn.searchOne(base, ['objectClass', 'name', 'objectGUID', 'description', 'dc'])
    if (!e) throw new Error('sin resultado')
    return toDirEntry(e)
  }, (e) => `${e.name} (${e.kind})`)

  const containers = await check('dir.children (raíz)', () =>
    listContainerChildren(conn, base, true), (c) => `${c.length} contenedores: ${c.slice(0, 6).map((x) => x.name).join(', ')}`)

  const usersDN = `CN=Users,${base}`
  const users = await check('dir.list (CN=Users)', () =>
    listChildren(conn, usersDN, { showAdvanced: true, sizeLimit: 2000 }),
    (l) => `${l.length} objetos, ${l.filter((x) => x.kind === 'user').length} usuarios, ${l.filter((x) => x.kind === 'group').length} grupos`)

  await check('dir.hasChildren', () => ops.hasChildren(conn, usersDN), (n) => `${n} hijos`)

  await check('dir.canonical', async () => dnToCanonical(usersDN), (s) => s)

  /* ---------------- Paginación en un contenedor grande ---------------- */

  const allUsers = await check('search.run (todo el dominio, paginado)', async () => {
    const raw = await conn.searchRaw(base, {
      scope: 'sub',
      filter: '(&(objectCategory=person)(objectClass=user))',
      attributes: LIST_ATTRS,
      pageSize: 500,
      sizeLimit: 0
    })
    return raw.map((e) => toDirEntry(e, true))
  }, (l) => `${l.length} usuarios (paginación de a 500)`)

  await check('search.run (equipos)', async () => {
    const raw = await conn.searchRaw(base, {
      scope: 'sub', filter: '(objectCategory=computer)', attributes: LIST_ATTRS, pageSize: 500
    })
    return raw.map((e) => toDirEntry(e))
  }, (l) => `${l.length} equipos`)

  /* ---------------- Un objeto concreto ---------------- */

  const sample: DirEntry | undefined =
    allUsers?.find((u) => u.attrs?.memberOf?.length) ?? allUsers?.[0] ?? users?.find((u) => u.kind === 'user')

  if (sample) {
    console.log(`\nObjeto de muestra: ${sample.name} — ${sample.dn}\n`)

    await check('dir.attributes', async () => {
      const e = await conn.searchOne(sample.dn, ['*'])
      if (!e) throw new Error('sin resultado')
      return toAttributeValues(e)
    }, (a) => `${a.length} atributos, ${a.filter((x) => x.values.length).length} con valor, ${a.filter((x) => x.isBinary).length} binarios`)

    await check('dir.attributes (+operacionales)', async () => {
      const e = await conn.searchOne(sample.dn, ['*', '+'])
      if (!e) throw new Error('sin resultado')
      return toAttributeValues(e)
    }, (a) => `${a.length} atributos`)

    await check('group.memberOf', () => ops.getMemberOf(conn, sample.dn),
      (g) => `${g.length} grupos${g.find((x) => x.primary) ? ` (principal: ${g.find((x) => x.primary)?.name})` : ''}`)

    await check('group.memberOfRecursive', () => ops.getMemberOfRecursive(conn, sample.dn),
      (g) => `${g.length} grupos efectivos`)

    await check('obj.cannotChangePassword.get', () => ops.getCannotChangePassword(conn, sample.dn),
      (v) => String(v))

    await check('obj.protect.get', () => ops.getProtectFromDeletion(conn, sample.dn), (v) => String(v))

    await check('search.byDN', async () => {
      const raw = await conn.searchRaw(base, {
        scope: 'sub',
        filter: `(distinguishedName=${escapeFilter(sample.dn)})`,
        attributes: LIST_ATTRS
      })
      return raw.map((e) => toDirEntry(e))
    }, (l) => `${l.length} coincidencia(s)`)

    if (sample.objectSID) {
      await check('search.bySid', async () => {
        const raw = await conn.searchRaw(base, {
          scope: 'sub', filter: sidFilter(sample.objectSID!), attributes: LIST_ATTRS
        })
        return raw.map((e) => toDirEntry(e))
      }, (l) => `${l.length} coincidencia(s) para ${sample.objectSID}`)
    }

    if (sample.objectGUID) {
      await check('search.byGuid', async () => {
        const raw = await conn.searchRaw(base, {
          scope: 'sub', filter: guidFilter(sample.objectGUID!), attributes: LIST_ATTRS
        })
        return raw.map((e) => toDirEntry(e))
      }, (l) => `${l.length} coincidencia(s) para ${sample.objectGUID}`)
    }

    /* ---------------- Seguridad: LEER y verificar ida y vuelta ---------------- */

    await check('security.read + parse SDDL', async () => {
      const raw = await conn.searchRaw(sample.dn, {
        scope: 'base', filter: '(objectClass=*)',
        attributes: ['nTSecurityDescriptor'],
        controls: [new SDFlagsControl(0x00000007)], pageSize: 0
      })
      const buf = raw[0] && firstBuffer(raw[0], 'nTSecurityDescriptor')
      if (!buf) throw new Error('sin descriptor')
      const sd = parseSecurityDescriptor(buf)
      return { sd, buf }
    }, ({ sd, buf }) =>
      `${buf.length} bytes, ${sd.dacl.length} ACEs, dueño ${sd.owner}, DACL protegida: ${sd.daclProtected}`)

    // El round-trip del descriptor es lo más peligroso de todo el backend:
    // security.write reescribe el SD completo. Se valida sobre un corpus, no sobre un objeto.
    await check('sddl: round-trip sobre 200 objetos (sin escribir)', async () => {
      const targets = await conn.searchRaw(base, {
        scope: 'sub', filter: '(objectClass=*)', attributes: ['distinguishedName'],
        sizeLimit: 200, pageSize: 200
      })
      let checked = 0
      let identical = 0
      const problems: string[] = []

      for (const t of targets) {
        const raw = await conn.searchRaw(t.dn, {
          scope: 'base', filter: '(objectClass=*)',
          attributes: ['nTSecurityDescriptor'],
          controls: [new SDFlagsControl(0x00000007)], pageSize: 0
        })
        const original = raw[0] && firstBuffer(raw[0], 'nTSecurityDescriptor')
        if (!original) continue
        checked++

        const parsed = parseSecurityDescriptor(original)
        const rebuilt = buildSecurityDescriptor(parsed)
        const again = parseSecurityDescriptor(rebuilt)

        if (rebuilt.equals(original)) { identical++; continue }

        // No es byte a byte: verificamos que no se pierda nada semánticamente.
        const same =
          again.owner === parsed.owner &&
          again.group === parsed.group &&
          again.daclProtected === parsed.daclProtected &&
          again.saclProtected === parsed.saclProtected &&
          again.dacl.length === parsed.dacl.length &&
          again.sacl.length === parsed.sacl.length &&
          again.dacl.every((a, i) => {
            const b = parsed.dacl[i]
            return a.type === b.type && a.mask === b.mask && a.flags === b.flags &&
              a.trusteeSID === b.trusteeSID && a.objectType === b.objectType &&
              a.inheritedObjectType === b.inheritedObjectType
          })

        // La diferencia admisible es sólo relleno sobrante al final del buffer del DC.
        const daclEnd = original.readUInt32LE(16) + original.readUInt16LE(original.readUInt32LE(16) + 2)
        const tailOnly = rebuilt.length <= original.length && daclEnd <= rebuilt.length

        if (!same || !tailOnly) {
          problems.push(`${t.dn}: ${original.length}→${rebuilt.length}${same ? '' : ' ACEs distintos'}`)
        }
      }
      return { checked, identical, problems }
    }, (r) =>
      r.problems.length
        ? `${r.checked} objetos, ${r.problems.length} CON PROBLEMAS: ${r.problems.slice(0, 3).join(' | ')}`
        : `${r.checked} objetos, ${r.identical} idénticos byte a byte, ${r.checked - r.identical} equivalentes (relleno del DC)`)

    await check('security.resolveSids', async () => {
      const raw = await conn.searchRaw(sample.dn, {
        scope: 'base', filter: '(objectClass=*)',
        attributes: ['nTSecurityDescriptor'],
        controls: [new SDFlagsControl(0x00000004)], pageSize: 0
      })
      const buf = raw[0] && firstBuffer(raw[0], 'nTSecurityDescriptor')
      const sd = parseSecurityDescriptor(buf!)
      const sids = [...new Set(sd.dacl.map((a) => a.trusteeSID))]
      return resolveSids(conn, sids)
    }, (m) => `${Object.keys(m).length} SIDs resueltos: ${Object.values(m).slice(0, 4).join(', ')}`)
  }

  /* ---------------- Grupos ---------------- */

  const group = users?.find((u) => u.kind === 'group')
  if (group) {
    await check('group.members', () => ops.getMembers(conn, group.dn), (m) => `${group.name}: ${m.length} miembros`)
  }

  /* ---------------- Dominio ---------------- */

  await check('session.passwordPolicy', () => ops.getPasswordPolicy(conn),
    (p) => `mín ${p.minPwdLength}, complejidad ${p.complexityEnabled}, bloqueo ${p.lockoutThreshold}, máx ${p.maxPwdAgeDays}d`)

  await check('session.fsmo', () => ops.getFsmoRoles(conn),
    (f) => `PDC ${f.pdcEmulator}, RID ${f.ridMaster}, esquema ${f.schemaMaster}`)

  await check('session.domainControllers', () => ops.getDomainControllers(conn),
    (d) => `${d.length} DC(s): ${d.map((x) => `${x.name}${x.isGC ? '(GC)' : ''}`).join(', ')}`)

  await check('session.wellKnownContainers', () => ops.getWellKnownContainers(conn),
    (w) => Object.keys(w).join(', '))

  /* ---------------- Búsquedas del selector de objetos ---------------- */

  const pickText = (sample?.name ?? 'a').slice(0, 3)
  await check('search.pick', async () => {
    const q = escapeFilter(pickText)
    const raw = await conn.searchRaw(base, {
      scope: 'sub',
      filter: `(&(|(&(objectCategory=person)(objectClass=user)(!(objectClass=computer)))(objectCategory=group))(|(sAMAccountName=${q}*)(cn=${q}*)(name=${q}*)(displayName=${q}*)))`,
      attributes: LIST_ATTRS,
      sizeLimit: 200
    })
    return raw.map((e) => toDirEntry(e))
  }, (l) => `"${pickText}*" → ${l.length} resultado(s)`)

  /* ---------------- Objetos eliminados ---------------- */

  await check('search.run (objetos eliminados)', async () => {
    const raw = await conn.searchRaw(`CN=Deleted Objects,${base}`, {
      scope: 'one', filter: '(objectClass=*)', attributes: ['name', 'objectClass', 'whenChanged'],
      includeDeleted: true, sizeLimit: 50
    })
    return raw
  }, (l) => `${l.length} objeto(s) en la papelera`)

  /* ---------------- Esquema (para Delegar control) ---------------- */

  await check('security.schemaObjects', async () => {
    const classes = await conn.searchRaw(conn.schemaDN, {
      scope: 'one',
      filter: '(&(objectClass=classSchema)(!(isDefunct=TRUE)))',
      attributes: ['lDAPDisplayName', 'schemaIDGUID'],
      pageSize: 500
    })
    const rights = await conn.searchRaw(`CN=Extended-Rights,${conn.configDN}`, {
      scope: 'one', filter: '(objectClass=controlAccessRight)',
      attributes: ['displayName', 'rightsGuid'], pageSize: 500
    })
    return { classes: classes.length, rights: rights.length }
  }, (r) => `${r.classes} clases del esquema, ${r.rights} derechos extendidos`)

  /* ---------------- Sitios y servicios ---------------- */

  const sitesOps = await import('./sites/operations')
  await check('sites.list', () => sitesOps.listSites(conn),
    (l) => `${l.length} sitio(s): ${l.map((s) => `${s.name} (${s.servers} DC, ${s.subnets.length} subredes)`).join(', ')}`)
  await check('sites.subnets', () => sitesOps.listSubnets(conn),
    (l) => `${l.length} subred(es)${l.length ? ': ' + l.slice(0, 5).map((s) => `${s.name}→${s.siteName ?? 'sin sitio'}`).join(', ') : ''}`)
  await check('sites.links', () => sitesOps.listSiteLinks(conn),
    (l) => l.map((x) => `${x.name} [${x.transport}] coste ${x.cost}, cada ${x.replInterval}min, ${x.siteNames.length} sitios${x.schedule ? ', con programación' : ''}`).join(' | ') || 'ninguno')
  await check('sites.servers', () => sitesOps.listServers(conn),
    (l) => l.map((s) => `${s.name}${s.isGC ? '(GC)' : ''}${s.isISTG ? '(ISTG)' : ''} ${s.connections.length}conn`).join(', '))
  await check('sites.validateSubnet', async () => ({
    ok: sitesOps.validateSubnet('10.20.0.0/16'),
    malaRed: sitesOps.validateSubnet('10.20.1.5/16'),
    basura: sitesOps.validateSubnet('no-es-una-red'),
    v6: sitesOps.validateSubnet('2001:db8::/64')
  }), (r) => `válida:${r.ok === undefined} detecta-no-red:${!!r.malaRed} detecta-basura:${!!r.basura} ipv6:${r.v6 === undefined}`)
  await check('sites.schedule round-trip', async () => {
    const hours = Array.from({ length: 168 }, (_, i) => i % 3 === 0)
    const buf = sitesOps.buildSchedule(hours)
    const back = sitesOps.parseSchedule(buf)
    return { size: buf.length, equal: !!back && back.every((v, i) => v === hours[i]) }
  }, (r) => `${r.size} bytes, ida y vuelta correcta: ${r.equal}`)

  /* ---------------- Dominios y confianzas ---------------- */

  const trustOps = await import('./trusts/operations')
  await check('trusts.forest', () => trustOps.getForestInfo(conn),
    (f) => `${f.partitions.length} particiones, ${f.trusts.length} confianzas, ${f.upnSuffixes.length} sufijos UPN, bosque nivel ${f.forestFunctionality}`)
  await check('trusts.partitions', () => trustOps.listPartitions(conn),
    (l) => l.map((p) => `${p.name}${p.isDomain ? ' [dominio]' : p.isApplicationPartition ? ' [app]' : ' [config]'}`).join(', '))
  await check('trusts.list', () => trustOps.listTrusts(conn),
    (l) => l.length ? l.map((t) => `${t.partner} ${t.directionLabel}/${t.typeLabel}`).join(', ') : 'ninguna (dominio único)')
  await check('trusts.maxSupportedLevel', () => trustOps.maxSupportedLevel(conn), (n) => `nivel ${n}`)

  /* ---------------- DFS ---------------- */

  const dfsOps = await import('./dfs/operations')
  const namespaces = await check('dfs.namespaces', () => dfsOps.listNamespaces(conn),
    (l) => l.map((n) => `${n.name} v${n.version} (${n.rootTargets.length} raíces, ${n.folders.length} carpetas${n.partial ? ', PARCIAL' : ''})`).join(' | '))
  if (namespaces?.length) {
    console.log()
    for (const ns of namespaces) {
      console.log(`   ${ns.path}  (v${ns.version})`)
      for (const t of ns.rootTargets) console.log(`      raíz → ${t.path}${t.enabled ? '' : ' [deshabilitado]'}`)
      for (const f of ns.folders) {
        console.log(`      ${f.path}${f.comment ? `  — ${f.comment}` : ''}`)
        for (const t of f.targets) console.log(`         → ${t.path}${t.enabled ? '' : ' [deshabilitado]'}`)
      }
    }
    console.log()
  }
  await check('dfs.replicationGroups', () => dfsOps.listReplicationGroups(conn),
    (l) => l.map((g) => `${g.name}${g.isSysvol ? '(SYSVOL)' : ''}: ${g.members.length} miembros, ${g.connections.length} conexiones, ${g.contentSets.length} contenidos`).join(' | '))
  await check('dfs.targetList v2 round-trip', async () => {
    const targets = [
      { path: '\\\\srv1\\datos', server: 'srv1', share: 'datos', enabled: true },
      { path: '\\\\srv2\\datos', server: 'srv2', share: 'datos', enabled: false }
    ]
    const xml = dfsOps.buildTargetListV2(targets)
    const back = dfsOps.parseTargetListV2(xml)
    return back.length === 2 && back[0].enabled && !back[1].enabled && back[1].server === 'srv2'
  }, (ok) => ok ? 'correcto' : 'FALLA')

  /* ---------------- DNS ---------------- */

  const dnsOps = await import('./dns/operations')
  const zones = await check('dns.zones', () => dnsOps.listZones(conn),
    (l) => `${l.length} zonas: ${l.map((z) => `${z.name}(${z.records})`).join(', ')}`)

  // La zona con más nombres: es la que mejor ejercita el códec.
  const zonaDirecta = [...(zones ?? [])].sort((a, b) => b.records - a.records)[0]
  if (zonaDirecta) {
    const nodos = await check(`dns.nodes (${zonaDirecta.name})`, () => dnsOps.listNodes(conn, zonaDirecta.dn),
      (l) => {
        const porTipo = new Map<string, number>()
        for (const n of l) for (const r of n.records) porTipo.set(r.typeName, (porTipo.get(r.typeName) ?? 0) + 1)
        return `${l.length} nombres, registros por tipo: ${[...porTipo].map(([t, c]) => `${t}=${c}`).join(' ')}`
      })
    if (nodos) {
      console.log()
      for (const n of nodos.filter((x) => x.records.some((r) => ['A', 'CNAME', 'MX', 'SRV', 'TXT', 'SOA'].includes(r.typeName))).slice(0, 8)) {
        for (const r of n.records) console.log(`   ${n.name.padEnd(34)} ${r.typeName.padEnd(6)} ttl=${String(r.ttl).padEnd(6)} ${r.data}`)
      }
      console.log()
    }
    await check('dns.zoneDetails', () => dnsOps.zoneDetails(conn, zonaDirecta.dn),
      (d) => `SOA ${d.soa?.fields.primary ?? '—'}, ${d.ns.length} NS, envejecimiento ${d.aging ? 'sí' : 'no'}, actualizaciones: ${d.updates ?? '—'}`)
  }

  await check('dns.servers', () => dnsOps.listDnsServers(conn), (l) => l.join(', ') || 'ninguno')

  // El códec tiene que reproducir byte a byte lo que ya está en el directorio.
  await check('dns: round-trip del códec sobre la zona real', async () => {
    const { parseRecord, buildRecord } = await import('./dns/record')
    const raw = await conn.searchRaw(zonaDirecta!.dn, {
      scope: 'one', filter: '(objectClass=dnsNode)', attributes: ['dnsRecord'], pageSize: 500
    })
    let total = 0
    let iguales = 0
    const distintos: string[] = []
    for (const e of raw) {
      for (const v of e.attrs.dnsRecord ?? []) {
        if (!Buffer.isBuffer(v)) continue
        const rec = parseRecord(v)
        if (!rec || !['A', 'AAAA', 'CNAME', 'NS', 'PTR', 'MX', 'TXT', 'SRV'].includes(rec.typeName)) continue
        total++
        const rebuilt = buildRecord({ type: rec.type, ttl: rec.ttl, fields: rec.fields })
        // Sólo se compara la parte de datos: la cabecera lleva serial y timestamp propios.
        if (rebuilt.subarray(24).equals(v.subarray(24, 24 + v.readUInt16LE(0)))) iguales++
        else if (distintos.length < 3) distintos.push(`${rec.typeName}:${rec.data}`)
      }
    }
    return { total, iguales, distintos }
  }, (r) => r.total === r.iguales
    ? `${r.total} registros reconstruidos idénticos`
    : `${r.iguales}/${r.total} idénticos — REVISAR: ${r.distintos.join(' | ')}`)

  /* ---------------- DHCP ---------------- */

  const dhcpOps = await import('./dhcp/operations')
  await check('dhcp.state', () => dhcpOps.getState(conn),
    (d) => `${d.servers.length} servidor(es) autorizado(s)${d.servers.length ? ': ' + d.servers.map((s) => `${s.name ?? ''} ${s.address}`).join(', ') : ''}; ${d.candidates.length} equipo(s) con SPN de DHCP`)

  /* ---------------- Navegador LDAP ---------------- */

  const browserOps = await import('./ldapbrowser/operations')
  await check('ldapb.contexts', async () => browserOps.listContexts(conn),
    (l) => l.map((c) => c.label).join(', '))
  await check('ldapb.children (raíz del dominio)', () => browserOps.listChildren(conn, conn.baseDN),
    (l) => `${l.length} hijos: ${l.slice(0, 6).map((x) => x.name).join(', ')}`)
  await check('ldapb.children (Configuration)', () => browserOps.listChildren(conn, conn.configDN),
    (l) => `${l.length} hijos: ${l.slice(0, 5).map((x) => x.name).join(', ')}`)

  /* ---------------- Directivas de grupo ---------------- */

  const gpoOps = await import('./gpo/operations')
  const gpos = await check('gpo.list', () => gpoOps.listGpos(conn),
    (l) => `${l.length} GPOs, ${l.filter((g) => g.linkCount === 0).length} sin vincular, ${l.filter((g) => g.flags !== 0).length} con configuración deshabilitada`)
  const scopes = await check('gpo.scopes', () => gpoOps.listScopes(conn),
    (l) => `${l.length} ámbitos, ${l.filter((s) => s.links.length).length} con vínculos, ${l.filter((s) => s.blockInheritance).length} bloquean herencia`)
  await check('gpo.wmiFilters', () => gpoOps.listWmiFilters(conn), (l) => `${l.length} filtro(s)`)
  await check('gpo: gPLink ida y vuelta', async () => {
    const conVinculos = (scopes ?? []).filter((s) => s.links.length)
    let iguales = 0
    for (const s of conVinculos) {
      const entry = await conn.searchOne(s.dn, ['gPLink'])
      const original = entry ? (entry.attrs.gPLink?.[0] ?? '').toString() : ''
      const links = gpoOps.parseGpLink(original)
      if (gpoOps.buildGpLink(links) === original) iguales++
    }
    return { total: conVinculos.length, iguales }
  }, (r) => r.total === r.iguales
    ? `${r.total} atributos gPLink reconstruidos idénticos`
    : `${r.iguales}/${r.total} idénticos — REVISAR`)

  if (scopes?.length) {
    console.log()
    for (const s of scopes.filter((x) => x.links.length).slice(0, 5)) {
      console.log(`   ${s.type.padEnd(7)} ${s.name}${s.blockInheritance ? ' [bloquea herencia]' : ''}`)
      for (const l of s.links) {
        console.log(`      ${l.order}. ${l.gpoName}${l.enforced ? ' [exigido]' : ''}${l.enabled ? '' : ' [deshabilitado]'}`)
      }
    }
    console.log()
  }

  /* ---------------- Certificados ---------------- */

  const adcsOps = await import('./adcs/operations')
  await check('adcs.authorities', () => adcsOps.listAuthorities(conn),
    (l) => l.length ? l.map((c) => `${c.name} en ${c.host} (${c.templates.length} plantillas)`).join(', ') : 'ninguna')
  const plantillas = await check('adcs.templates', () => adcsOps.listTemplates(conn),
    (l) => `${l.length} plantillas, ${l.filter((t) => t.publishedBy.length).length} publicadas por alguna CA, ${l.filter((t) => t.risks.some((r) => r.severity === 'alta')).length} con observaciones graves`)
  await check('adcs.stores', () => adcsOps.listTrustStores(conn),
    (l) => l.map((s) => `${s.store}: ${s.certificates}`).join(', '))

  if (plantillas?.some((t) => t.risks.length)) {
    console.log()
    for (const t of plantillas.filter((x) => x.risks.length)) {
      console.log(`   ${t.name}${t.publishedBy.length ? ` — publicada por ${t.publishedBy.join(', ')}` : ' — sin publicar'}`)
      for (const r of t.risks) console.log(`      [${r.id}] (${r.severity}) ${r.label}`)
    }
    console.log()
  }

  await conn.disconnect()

  /* ---------------- Reporte ---------------- */

  console.log('\n' + '─'.repeat(96))
  for (const c of checks) {
    console.log(`${c.ok ? '✓' : '✗'} ${c.name.padEnd(46)} ${String(c.ms).padStart(6)} ms  ${c.detail}`)
  }
  console.log('─'.repeat(96))
  const failed = checks.filter((c) => !c.ok)
  console.log(`${checks.length - failed.length}/${checks.length} verificaciones OK`)
  if (failed.length) {
    console.log('\nFallaron:')
    for (const f of failed) console.log(`  • ${f.name}: ${f.detail}`)
  }
  app.exit(failed.length ? 1 : 0)
}

main().catch((err) => {
  console.error('\nERROR FATAL:', err instanceof Error ? err.message : err)
  app.exit(2)
})
