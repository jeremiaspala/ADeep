import type { DirEntry } from '@shared/types'
import { KIND_LABEL } from './icons'
import { dnToCanonical, filetimeToDate, fmtDate, generalizedTimeToDate, rdnValue } from './format'

export interface ColumnDef {
  id: string
  label: string
  width: number
  value: (e: DirEntry) => string
}

const attr = (e: DirEntry, name: string): string => {
  const a = e.attrs
  if (!a) return ''
  const key = a[name] ? name : Object.keys(a).find((k) => k.toLowerCase() === name.toLowerCase())
  return key ? (a[key] ?? []).join('; ') : ''
}

const filetime = (e: DirEntry, name: string): string => {
  const v = attr(e, name)
  if (!v || v === '0') return ''
  const d = filetimeToDate(v)
  return d ? fmtDate(d) : ''
}

const gtime = (e: DirEntry, name: string): string => {
  const d = generalizedTimeToDate(attr(e, name))
  return d ? fmtDate(d) : ''
}

export const COLUMNS: ColumnDef[] = [
  { id: 'name', label: 'Nombre', width: 260, value: (e) => e.name },
  { id: 'kind', label: 'Tipo', width: 150, value: (e) => KIND_LABEL[e.kind] },
  { id: 'description', label: 'Descripción', width: 300, value: (e) => e.description ?? '' },
  { id: 'sAMAccountName', label: 'Nombre de inicio de sesión', width: 180, value: (e) => attr(e, 'sAMAccountName') },
  { id: 'userPrincipalName', label: 'UPN', width: 220, value: (e) => attr(e, 'userPrincipalName') },
  { id: 'displayName', label: 'Nombre para mostrar', width: 200, value: (e) => attr(e, 'displayName') },
  { id: 'mail', label: 'Correo', width: 220, value: (e) => attr(e, 'mail') },
  { id: 'telephoneNumber', label: 'Teléfono', width: 140, value: (e) => attr(e, 'telephoneNumber') },
  { id: 'title', label: 'Cargo', width: 160, value: (e) => attr(e, 'title') },
  { id: 'department', label: 'Departamento', width: 160, value: (e) => attr(e, 'department') },
  { id: 'company', label: 'Empresa', width: 160, value: (e) => attr(e, 'company') },
  { id: 'physicalDeliveryOfficeName', label: 'Oficina', width: 140, value: (e) => attr(e, 'physicalDeliveryOfficeName') },
  { id: 'manager', label: 'Administrado por', width: 200, value: (e) => rdnValue(attr(e, 'manager')) },
  { id: 'operatingSystem', label: 'Sistema operativo', width: 190, value: (e) => attr(e, 'operatingSystem') },
  { id: 'operatingSystemVersion', label: 'Versión del SO', width: 140, value: (e) => attr(e, 'operatingSystemVersion') },
  { id: 'dNSHostName', label: 'Nombre DNS', width: 220, value: (e) => attr(e, 'dNSHostName') },
  { id: 'location', label: 'Ubicación', width: 160, value: (e) => attr(e, 'location') },
  { id: 'lastLogonTimestamp', label: 'Último inicio de sesión', width: 170, value: (e) => filetime(e, 'lastLogonTimestamp') },
  { id: 'pwdLastSet', label: 'Último cambio de contraseña', width: 190, value: (e) => filetime(e, 'pwdLastSet') },
  { id: 'accountExpires', label: 'Expiración de la cuenta', width: 170, value: (e) => filetime(e, 'accountExpires') },
  { id: 'whenCreated', label: 'Creado', width: 160, value: (e) => gtime(e, 'whenCreated') },
  { id: 'whenChanged', label: 'Modificado', width: 160, value: (e) => gtime(e, 'whenChanged') },
  { id: 'canonical', label: 'Nombre canónico', width: 320, value: (e) => dnToCanonical(e.dn) },
  { id: 'dn', label: 'DN', width: 400, value: (e) => e.dn },
  { id: 'objectSID', label: 'SID', width: 280, value: (e) => e.objectSID ?? '' },
  { id: 'objectGUID', label: 'GUID', width: 280, value: (e) => e.objectGUID ?? '' }
]

export const COLUMN_BY_ID = new Map(COLUMNS.map((c) => [c.id, c]))

export function columnValue(e: DirEntry, id: string): string {
  return COLUMN_BY_ID.get(id)?.value(e) ?? attr(e, id)
}
