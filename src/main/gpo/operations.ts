/**
 * Directivas de grupo.
 *
 * Un GPO son dos cosas: el objeto `groupPolicyContainer` en
 * `CN=Policies,CN=System,<dominio>` y los archivos en SYSVOL. Acá se administra
 * lo que vive en el directorio, que es todo lo que importa para saber **qué se
 * aplica y dónde**: vínculos, orden, herencia, filtrado de seguridad y estado.
 * Editar el contenido de una directiva necesita llegar a SYSVOL por SMB.
 *
 * Los vínculos están en `gPLink` del dominio, de cada OU y de cada sitio, con el
 * formato `[LDAP://<dn>;<opciones>][LDAP://<dn>;<opciones>]`, del último aplicado
 * al primero. Las opciones son un bitmask: 1 = vínculo deshabilitado,
 * 2 = exigido (enforced).
 */
import type { AdConnection } from '../ldap/connection'
import { firstNumber, firstString } from '../ldap/directory'
import { generalizedTimeToDate, rdnValue } from '../ldap/encoding'
import type { GpoInfo, GpoLink, GpoScope, WmiFilter } from '../../shared/types'

export const LINK_DISABLED = 0x1
export const LINK_ENFORCED = 0x2

/** flags del propio GPO: 1 = configuración de usuario off, 2 = de equipo off. */
export const GPO_USER_DISABLED = 0x1
export const GPO_COMPUTER_DISABLED = 0x2

const STATUS_LABELS: Record<number, string> = {
  0: 'Habilitado',
  1: 'Configuración de usuario deshabilitada',
  2: 'Configuración de equipo deshabilitada',
  3: 'Todo deshabilitado'
}

function toIso(value?: string): string | undefined {
  return value ? generalizedTimeToDate(value)?.toISOString() : undefined
}

export function policiesDN(conn: AdConnection): string {
  return `CN=Policies,CN=System,${conn.baseDN}`
}

export function wmiDN(conn: AdConnection): string {
  return `CN=SOM,CN=WMIPolicy,CN=System,${conn.baseDN}`
}

/** `[LDAP://cn={guid},...;2][LDAP://...;0]` → lista ordenada de vínculos. */
export function parseGpLink(value: string): { dn: string; options: number }[] {
  const out: { dn: string; options: number }[] = []
  const re = /\[LDAP:\/\/([^;\]]+);(\d+)\]/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(value))) {
    out.push({ dn: m[1].trim(), options: Number(m[2]) || 0 })
  }
  return out
}

export function buildGpLink(links: { dn: string; options: number }[]): string {
  return links.map((l) => `[LDAP://${l.dn};${l.options}]`).join('')
}

export async function listGpos(conn: AdConnection): Promise<GpoInfo[]> {
  const [gpos, scopes] = await Promise.all([
    conn.searchRaw(policiesDN(conn), {
      scope: 'one',
      filter: '(objectClass=groupPolicyContainer)',
      attributes: [
        'displayName', 'name', 'gPCFileSysPath', 'versionNumber', 'flags',
        'gPCMachineExtensionNames', 'gPCUserExtensionNames', 'gPCWQLFilter',
        'whenCreated', 'whenChanged'
      ],
      pageSize: 500
    }),
    listScopes(conn)
  ])

  // Cuántas veces está vinculado cada GPO, para mostrarlo en la lista.
  const usos = new Map<string, number>()
  for (const scope of scopes) {
    for (const link of scope.links) {
      const key = link.gpoDN.toLowerCase()
      usos.set(key, (usos.get(key) ?? 0) + 1)
    }
  }

  return gpos
    .map((e) => {
      const flags = firstNumber(e, 'flags') ?? 0
      const version = firstNumber(e, 'versionNumber') ?? 0
      return {
        dn: e.dn,
        // El RDN es el GUID entre llaves; el nombre visible está en displayName.
        guid: rdnValue(e.dn),
        name: firstString(e, 'displayName') ?? rdnValue(e.dn),
        path: firstString(e, 'gPCFileSysPath') ?? '',
        // versionNumber junta las dos versiones: equipo en los 16 bits bajos.
        computerVersion: version & 0xffff,
        userVersion: version >>> 16,
        flags,
        statusLabel: STATUS_LABELS[flags] ?? `Estado ${flags}`,
        userDisabled: (flags & GPO_USER_DISABLED) !== 0,
        computerDisabled: (flags & GPO_COMPUTER_DISABLED) !== 0,
        machineExtensions: extensionCount(firstString(e, 'gPCMachineExtensionNames')),
        userExtensions: extensionCount(firstString(e, 'gPCUserExtensionNames')),
        wmiFilter: parseWmiRef(firstString(e, 'gPCWQLFilter')),
        created: toIso(firstString(e, 'whenCreated')),
        changed: toIso(firstString(e, 'whenChanged')),
        linkCount: usos.get(e.dn.toLowerCase()) ?? 0
      }
    })
    .sort((a, b) => a.name.localeCompare(b.name, 'es'))
}

/** Dominio, OUs y sitios: todo lo que puede tener directivas vinculadas. */
export async function listScopes(conn: AdConnection): Promise<GpoScope[]> {
  const [dominio, ous, sitios, gpos] = await Promise.all([
    conn.searchOne(conn.baseDN, ['name', 'gPLink', 'gPOptions']),
    conn.searchRaw(conn.baseDN, {
      scope: 'sub',
      filter: '(objectCategory=organizationalUnit)',
      attributes: ['name', 'ou', 'gPLink', 'gPOptions'],
      pageSize: 500
    }),
    conn
      .searchRaw(`CN=Sites,${conn.configDN}`, {
        scope: 'one',
        filter: '(objectClass=site)',
        attributes: ['name', 'gPLink', 'gPOptions']
      })
      .catch(() => []),
    conn.searchRaw(policiesDN(conn), {
      scope: 'one',
      filter: '(objectClass=groupPolicyContainer)',
      attributes: ['displayName'],
      pageSize: 500
    })
  ])

  const nombreGpo = new Map(
    gpos.map((g) => [g.dn.toLowerCase(), firstString(g, 'displayName') ?? rdnValue(g.dn)])
  )

  const toScope = (
    e: { dn: string; attrs: Record<string, (string | Buffer)[]> },
    tipo: GpoScope['type']
  ): GpoScope => {
    const raw = e as Parameters<typeof firstString>[0]
    const gpOptions = firstNumber(raw, 'gPOptions') ?? 0
    const links: GpoLink[] = parseGpLink(firstString(raw, 'gPLink') ?? '')
      // gPLink se aplica de derecha a izquierda: el primero de la lista es el
      // que gana, así que se invierte para mostrar el orden de precedencia.
      .reverse()
      .map((l, i) => ({
        gpoDN: l.dn,
        gpoName: nombreGpo.get(l.dn.toLowerCase()) ?? rdnValue(l.dn),
        order: i + 1,
        options: l.options,
        enabled: (l.options & LINK_DISABLED) === 0,
        enforced: (l.options & LINK_ENFORCED) !== 0
      }))

    return {
      dn: e.dn,
      name: firstString(raw, 'name') ?? firstString(raw, 'ou') ?? rdnValue(e.dn),
      type: tipo,
      blockInheritance: (gpOptions & 0x1) !== 0,
      links
    }
  }

  const out: GpoScope[] = []
  if (dominio) out.push(toScope(dominio, 'domain'))
  for (const ou of ous) out.push(toScope(ou, 'ou'))
  for (const site of sitios) out.push(toScope(site, 'site'))
  return out
}

export async function listWmiFilters(conn: AdConnection): Promise<WmiFilter[]> {
  const raw = await conn
    .searchRaw(wmiDN(conn), {
      scope: 'one',
      filter: '(objectClass=msWMI-Som)',
      attributes: ['msWMI-Name', 'msWMI-Parm1', 'msWMI-Parm2', 'msWMI-ID', 'whenChanged']
    })
    .catch(() => [])

  return raw.map((e) => ({
    dn: e.dn,
    id: firstString(e, 'msWMI-ID') ?? rdnValue(e.dn),
    name: firstString(e, 'msWMI-Name') ?? rdnValue(e.dn),
    description: firstString(e, 'msWMI-Parm1'),
    // Parm2 trae la consulta con un prefijo de contadores separados por ';'.
    query: (firstString(e, 'msWMI-Parm2') ?? '').split(';').slice(-1)[0] ?? '',
    changed: toIso(firstString(e, 'whenChanged'))
  }))
}

/* ---------------- Escrituras ---------------- */

export async function setLinkOptions(
  conn: AdConnection,
  scopeDN: string,
  gpoDN: string,
  options: number
): Promise<void> {
  const entry = await conn.searchOne(scopeDN, ['gPLink'])
  const links = parseGpLink(entry ? firstString(entry, 'gPLink') ?? '' : '')
  const i = links.findIndex((l) => l.dn.toLowerCase() === gpoDN.toLowerCase())
  if (i < 0) throw new Error('El vínculo ya no existe.')
  links[i] = { ...links[i], options }
  await conn.modify(scopeDN, [
    { op: 'replace', attribute: 'gPLink', values: [buildGpLink(links)] }
  ])
}

export async function linkGpo(conn: AdConnection, scopeDN: string, gpoDN: string): Promise<void> {
  const entry = await conn.searchOne(scopeDN, ['gPLink'])
  const links = parseGpLink(entry ? firstString(entry, 'gPLink') ?? '' : '')
  if (links.some((l) => l.dn.toLowerCase() === gpoDN.toLowerCase())) return
  // El nuevo vínculo va al final del atributo, que es la primera posición de
  // precedencia: lo mismo que hace la consola de Windows.
  links.push({ dn: gpoDN, options: 0 })
  await conn.modify(scopeDN, [
    { op: 'replace', attribute: 'gPLink', values: [buildGpLink(links)] }
  ])
}

export async function unlinkGpo(conn: AdConnection, scopeDN: string, gpoDN: string): Promise<void> {
  const entry = await conn.searchOne(scopeDN, ['gPLink'])
  const links = parseGpLink(entry ? firstString(entry, 'gPLink') ?? '' : '')
    .filter((l) => l.dn.toLowerCase() !== gpoDN.toLowerCase())
  await conn.modify(scopeDN, [
    links.length
      ? { op: 'replace', attribute: 'gPLink', values: [buildGpLink(links)] }
      : { op: 'delete', attribute: 'gPLink', values: [] }
  ])
}

/** Mueve un vínculo en el orden de precedencia (1 = el que gana). */
export async function moveLink(
  conn: AdConnection,
  scopeDN: string,
  gpoDN: string,
  direction: -1 | 1
): Promise<void> {
  const entry = await conn.searchOne(scopeDN, ['gPLink'])
  const links = parseGpLink(entry ? firstString(entry, 'gPLink') ?? '' : '')
  // En el atributo el orden está invertido respecto de la precedencia.
  const orden = [...links].reverse()
  const i = orden.findIndex((l) => l.dn.toLowerCase() === gpoDN.toLowerCase())
  const j = i + direction
  if (i < 0 || j < 0 || j >= orden.length) return
  ;[orden[i], orden[j]] = [orden[j], orden[i]]
  await conn.modify(scopeDN, [
    { op: 'replace', attribute: 'gPLink', values: [buildGpLink([...orden].reverse())] }
  ])
}

export async function setBlockInheritance(
  conn: AdConnection,
  scopeDN: string,
  block: boolean
): Promise<void> {
  const entry = await conn.searchOne(scopeDN, ['gPOptions'])
  const actual = (entry && firstNumber(entry, 'gPOptions')) ?? 0
  const next = block ? actual | 0x1 : actual & ~0x1
  await conn.modify(scopeDN, [{ op: 'replace', attribute: 'gPOptions', values: [String(next)] }])
}

export async function setGpoStatus(conn: AdConnection, gpoDN: string, flags: number): Promise<void> {
  await conn.modify(gpoDN, [{ op: 'replace', attribute: 'flags', values: [String(flags)] }])
}

/* ---------------- Auxiliares ---------------- */

function extensionCount(value?: string): number {
  if (!value?.trim()) return 0
  // Cada extensión es un par [{guid CSE}{guid herramienta}…].
  return (value.match(/\[/g) ?? []).length
}

function parseWmiRef(value?: string): string | undefined {
  if (!value) return undefined
  const m = /\{[0-9A-Fa-f-]+\}/.exec(value)
  return m ? m[0] : value
}
