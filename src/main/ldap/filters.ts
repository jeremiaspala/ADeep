/**
 * Filtros LDAP con valores binarios.
 *
 * Un filtro escrito como texto con escapes `\XX` (p.ej. `(objectSid=\01\05\d7…)`)
 * llega a ldapts como string y se serializa a BER en UTF-8: todo byte ≥ 0x80 se
 * convierte en dos bytes (0xd7 → 0xc3 0x97) y la búsqueda no encuentra nada.
 * Para SIDs y GUIDs hay que construir el filtro con un Buffer.
 */
import { EqualityFilter, OrFilter, type Filter } from 'ldapts'
import { stringToGuid, stringToSid } from './encoding'

export function sidFilter(sid: string, attribute = 'objectSid'): Filter {
  return new EqualityFilter({ attribute, value: stringToSid(sid) })
}

export function guidFilter(guid: string, attribute = 'objectGUID'): Filter {
  return new EqualityFilter({ attribute, value: stringToGuid(guid) })
}

/** OR de varios filtros; devuelve undefined si la lista queda vacía. */
export function anyOf(filters: Filter[]): Filter | undefined {
  if (!filters.length) return undefined
  if (filters.length === 1) return filters[0]
  return new OrFilter({ filters })
}

/** OR de SIDs, descartando los que no se puedan parsear. */
export function sidsFilter(sids: string[], attribute = 'objectSid'): Filter | undefined {
  const filters: Filter[] = []
  for (const sid of sids) {
    try { filters.push(sidFilter(sid, attribute)) } catch { /* SID inválido */ }
  }
  return anyOf(filters)
}

/** OR de GUIDs, descartando los que no se puedan parsear. */
export function guidsFilter(guids: string[], attribute = 'objectGUID'): Filter | undefined {
  const filters: Filter[] = []
  for (const guid of guids) {
    try { filters.push(guidFilter(guid, attribute)) } catch { /* GUID inválido */ }
  }
  return anyOf(filters)
}
