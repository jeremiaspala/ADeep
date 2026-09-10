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
