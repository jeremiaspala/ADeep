/**
 * Navegador LDAP crudo, al estilo de ADSI Edit: cualquier contexto de nombres,
 * cualquier objeto, sin la interpretación que hace la consola de usuarios.
 */
import type { AdConnection } from '../ldap/connection'
import { firstString, allStrings, toDirEntry } from '../ldap/directory'
import { rdnValue, escapeRDN } from '../ldap/encoding'
import type { LdapBrowserNode, LdapContext } from '../../shared/types'

const CONTEXT_LABELS: Record<string, string> = {
  domain: 'Dominio',
  configuration: 'Configuración',
  schema: 'Esquema',
  domaindnszones: 'DNS del dominio',
  forestdnszones: 'DNS del bosque'
}

/** Contextos de nombres publicados por el rootDSE, más el propio rootDSE. */
export function listContexts(conn: AdConnection): LdapContext[] {
  const out: LdapContext[] = []

  for (const nc of conn.rootDSE.namingContexts) {
    const lower = nc.toLowerCase()
    let key = 'otro'
    if (lower === conn.baseDN.toLowerCase()) key = 'domain'
    else if (lower === conn.configDN.toLowerCase()) key = 'configuration'
    else if (lower === conn.schemaDN.toLowerCase()) key = 'schema'
    else if (lower.startsWith('dc=domaindnszones')) key = 'domaindnszones'
    else if (lower.startsWith('dc=forestdnszones')) key = 'forestdnszones'

    out.push({
      dn: nc,
      label: CONTEXT_LABELS[key] ?? rdnValue(nc),
      key
    })
  }

  return out
}

/** Todos los hijos directos, sin filtrar por clase. */
export async function listChildren(
  conn: AdConnection,
  dn: string,
  limit = 2000
): Promise<LdapBrowserNode[]> {
  const raw = await conn.searchRaw(dn, {
    scope: 'one',
    filter: '(objectClass=*)',
    attributes: [
      'objectClass', 'name', 'cn', 'ou', 'dc', 'description', 'distinguishedName',
      'objectGUID', 'objectSid', 'whenChanged', 'showInAdvancedViewOnly'
    ],
    sizeLimit: limit,
    pageSize: 500
  })

  return raw
    .map((e) => {
      const entry = toDirEntry(e)
      const classes = allStrings(e, 'objectClass')
      return {
        dn: e.dn,
        name: entry.name || rdnValue(e.dn),
        rdn: e.dn.split(',')[0],
        objectClass: classes[classes.length - 1] ?? 'top',
        allClasses: classes,
        kind: entry.kind,
        description: firstString(e, 'description'),
        // En el navegador crudo cualquier objeto puede tener hijos.
        expandable: true
      }
    })
    .sort((a, b) => a.name.localeCompare(b.name, 'es', { numeric: true }))
}

export async function countChildren(conn: AdConnection, dn: string): Promise<number> {
  const raw = await conn
    .searchRaw(dn, { scope: 'one', filter: '(objectClass=*)', attributes: ['distinguishedName'], sizeLimit: 1 })
    .catch(() => [])
  return raw.length
}

/** Crea un objeto indicando su clase y su RDN, como hace ADSI Edit. */
export async function createObject(
  conn: AdConnection,
  parentDN: string,
  rdnAttribute: string,
  rdnValueText: string,
  objectClass: string,
  extra: Record<string, string[]> = {}
): Promise<string> {
  const dn = `${rdnAttribute}=${escapeRDN(rdnValueText)},${parentDN}`
  await conn.add(dn, {
    objectClass: ['top', objectClass],
    [rdnAttribute]: [rdnValueText],
    ...extra
  })
  return dn
}

/** Clases que se pueden crear bajo un contenedor, según el esquema. */
export async function allowedChildClasses(conn: AdConnection, dn: string): Promise<string[]> {
  const entry = await conn.searchOne(dn, ['objectClass'])
  if (!entry) return []
  const classes = allStrings(entry, 'objectClass')
  const target = classes[classes.length - 1]
  if (!target) return []

  const schema = await conn
    .searchRaw(conn.schemaDN, {
      scope: 'one',
      filter: `(&(objectClass=classSchema)(lDAPDisplayName=${target}))`,
      attributes: ['possSuperiors', 'systemPossSuperiors', 'lDAPDisplayName']
    })
    .catch(() => [])
  void schema

  // possSuperiors se declara al revés: hay que buscar qué clases admiten a ésta
  // como superior. Es una consulta al esquema, no algo que se pueda deducir acá.
  const posibles = await conn
    .searchRaw(conn.schemaDN, {
      scope: 'one',
      filter: `(&(objectClass=classSchema)(|(possSuperiors=${target})(systemPossSuperiors=${target}))(!(isDefunct=TRUE)))`,
      attributes: ['lDAPDisplayName']
    })
    .catch(() => [])

  return posibles
    .map((e) => firstString(e, 'lDAPDisplayName') ?? '')
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b))
}
