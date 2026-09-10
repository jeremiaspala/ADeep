/**
 * Parser/serializador de SECURITY_DESCRIPTOR binario (nTSecurityDescriptor).
 * MS-DTYP 2.4.6 (SD), 2.4.5 (ACL), 2.4.4 (ACE).
 */
import { sidToString, stringToSid, guidToString, stringToGuid } from './encoding'
import { ACCESS_MASK, EXTENDED_RIGHTS } from './wellknown'
import type { AceEntry, SecurityDescriptor } from '../../shared/types'

export const SD_CONTROL = {
  OWNER_DEFAULTED: 0x0001,
  GROUP_DEFAULTED: 0x0002,
  DACL_PRESENT: 0x0004,
  DACL_DEFAULTED: 0x0008,
  SACL_PRESENT: 0x0010,
  SACL_DEFAULTED: 0x0020,
  DACL_AUTO_INHERIT_REQ: 0x0100,
  SACL_AUTO_INHERIT_REQ: 0x0200,
  DACL_AUTO_INHERITED: 0x0400,
  SACL_AUTO_INHERITED: 0x0800,
  DACL_PROTECTED: 0x1000,
  SACL_PROTECTED: 0x2000,
  RM_CONTROL_VALID: 0x4000,
  SELF_RELATIVE: 0x8000
} as const

export const ACE_TYPE = {
  ACCESS_ALLOWED: 0x00,
  ACCESS_DENIED: 0x01,
  SYSTEM_AUDIT: 0x02,
  SYSTEM_ALARM: 0x03,
  ACCESS_ALLOWED_COMPOUND: 0x04,
  ACCESS_ALLOWED_OBJECT: 0x05,
  ACCESS_DENIED_OBJECT: 0x06,
  SYSTEM_AUDIT_OBJECT: 0x07,
  SYSTEM_ALARM_OBJECT: 0x08
} as const

export const ACE_FLAGS = {
  OBJECT_INHERIT: 0x01,
  CONTAINER_INHERIT: 0x02,
  NO_PROPAGATE_INHERIT: 0x04,
  INHERIT_ONLY: 0x08,
  INHERITED: 0x10,
  SUCCESSFUL_ACCESS: 0x40,
  FAILED_ACCESS: 0x80
} as const

const ACE_OBJECT_TYPE_PRESENT = 0x00000001
const ACE_INHERITED_OBJECT_TYPE_PRESENT = 0x00000002

function maskToRights(mask: number): string[] {
  const out: string[] = []
  for (const [name, bit] of Object.entries(ACCESS_MASK) as [string, number][]) {
    if (bit !== 0 && (mask & bit) === bit) out.push(name)
  }
  return out
}

function aceTypeLabel(t: number): AceEntry['type'] {
  switch (t) {
    case ACE_TYPE.ACCESS_ALLOWED: return 'allow'
    case ACE_TYPE.ACCESS_DENIED: return 'deny'
    case ACE_TYPE.ACCESS_ALLOWED_OBJECT: return 'allow-object'
    case ACE_TYPE.ACCESS_DENIED_OBJECT: return 'deny-object'
    case ACE_TYPE.SYSTEM_AUDIT:
    case ACE_TYPE.SYSTEM_AUDIT_OBJECT: return 'audit'
    default: return 'other'
  }
}

function parseAcl(buf: Buffer, offset: number): AceEntry[] {
  const aces: AceEntry[] = []
  if (offset === 0 || offset >= buf.length) return aces
  const aceCount = buf.readUInt16LE(offset + 4)
  let p = offset + 8
  for (let i = 0; i < aceCount && p + 4 <= buf.length; i++) {
    const aceType = buf.readUInt8(p)
    const aceFlags = buf.readUInt8(p + 1)
    const aceSize = buf.readUInt16LE(p + 2)
    if (aceSize === 0 || p + aceSize > buf.length) break
    const mask = buf.readUInt32LE(p + 4)
    let q = p + 8
    let objectType: string | undefined
    let inheritedObjectType: string | undefined

    const isObjectAce =
      aceType === ACE_TYPE.ACCESS_ALLOWED_OBJECT ||
      aceType === ACE_TYPE.ACCESS_DENIED_OBJECT ||
      aceType === ACE_TYPE.SYSTEM_AUDIT_OBJECT ||
      aceType === ACE_TYPE.SYSTEM_ALARM_OBJECT

    if (isObjectAce) {
      const objFlags = buf.readUInt32LE(q)
      q += 4
      if (objFlags & ACE_OBJECT_TYPE_PRESENT) {
        objectType = guidToString(buf.subarray(q, q + 16))
        q += 16
      }
      if (objFlags & ACE_INHERITED_OBJECT_TYPE_PRESENT) {
        inheritedObjectType = guidToString(buf.subarray(q, q + 16))
        q += 16
      }
    }

    const sidLen = Math.max(0, p + aceSize - q)
    const trusteeSID = sidLen >= 8 ? sidToString(buf.subarray(q, q + sidLen)) : ''

    aces.push({
      type: aceTypeLabel(aceType),
      trusteeSID,
      mask,
      rights: maskToRights(mask),
      inherited: (aceFlags & ACE_FLAGS.INHERITED) !== 0,
      inheritOnly: (aceFlags & ACE_FLAGS.INHERIT_ONLY) !== 0,
      containerInherit: (aceFlags & ACE_FLAGS.CONTAINER_INHERIT) !== 0,
      objectInherit: (aceFlags & ACE_FLAGS.OBJECT_INHERIT) !== 0,
      objectType,
      objectTypeName: objectType ? EXTENDED_RIGHTS[objectType] : undefined,
      inheritedObjectType,
      inheritedObjectTypeName: inheritedObjectType
        ? EXTENDED_RIGHTS[inheritedObjectType]
        : undefined,
      flags: aceFlags
    })
    p += aceSize
  }
  return aces
}

export function parseSecurityDescriptor(buf: Buffer): SecurityDescriptor {
  if (!buf || buf.length < 20) {
    return { control: 0, dacl: [], sacl: [], daclProtected: false, saclProtected: false }
  }
  const control = buf.readUInt16LE(2)
  const ownerOffset = buf.readUInt32LE(4)
  const groupOffset = buf.readUInt32LE(8)
  const saclOffset = buf.readUInt32LE(12)
  const daclOffset = buf.readUInt32LE(16)

  return {
    owner: ownerOffset ? sidToString(buf.subarray(ownerOffset)) : undefined,
    group: groupOffset ? sidToString(buf.subarray(groupOffset)) : undefined,
    control,
    dacl: control & SD_CONTROL.DACL_PRESENT ? parseAcl(buf, daclOffset) : [],
    sacl: control & SD_CONTROL.SACL_PRESENT ? parseAcl(buf, saclOffset) : [],
    daclProtected: (control & SD_CONTROL.DACL_PROTECTED) !== 0,
    saclProtected: (control & SD_CONTROL.SACL_PROTECTED) !== 0
  }
}

function aceTypeCode(a: AceEntry): number {
  switch (a.type) {
    case 'allow': return ACE_TYPE.ACCESS_ALLOWED
    case 'deny': return ACE_TYPE.ACCESS_DENIED
    case 'allow-object': return ACE_TYPE.ACCESS_ALLOWED_OBJECT
    case 'deny-object': return ACE_TYPE.ACCESS_DENIED_OBJECT
    case 'audit':
      return a.objectType ? ACE_TYPE.SYSTEM_AUDIT_OBJECT : ACE_TYPE.SYSTEM_AUDIT
    default: return ACE_TYPE.ACCESS_ALLOWED
  }
}

function buildAce(a: AceEntry): Buffer {
  const sid = stringToSid(a.trusteeSID)
  const type = aceTypeCode(a)
  const isObjectAce =
    type === ACE_TYPE.ACCESS_ALLOWED_OBJECT ||
    type === ACE_TYPE.ACCESS_DENIED_OBJECT ||
    type === ACE_TYPE.SYSTEM_AUDIT_OBJECT

  let objFlags = 0
  const guids: Buffer[] = []
  if (isObjectAce) {
    if (a.objectType) { objFlags |= ACE_OBJECT_TYPE_PRESENT; guids.push(stringToGuid(a.objectType)) }
    if (a.inheritedObjectType) {
      objFlags |= ACE_INHERITED_OBJECT_TYPE_PRESENT
      guids.push(stringToGuid(a.inheritedObjectType))
    }
  }

  const body = Buffer.concat([
    ...(isObjectAce ? [(() => { const b = Buffer.alloc(4); b.writeUInt32LE(objFlags, 0); return b })()] : []),
    ...guids,
    sid
  ])
  const size = 8 + body.length
  const head = Buffer.alloc(8)
  head.writeUInt8(type, 0)
  head.writeUInt8(a.flags, 1)
  head.writeUInt16LE(size, 2)
  head.writeUInt32LE(a.mask >>> 0, 4)
  return Buffer.concat([head, body])
}

function buildAcl(aces: AceEntry[]): Buffer {
  const aceBufs = aces.map(buildAce)
  const total = 8 + aceBufs.reduce((n, b) => n + b.length, 0)
  const head = Buffer.alloc(8)
  head.writeUInt8(4, 0) // ACL_REVISION_DS
  head.writeUInt8(0, 1)
  head.writeUInt16LE(total, 2)
  head.writeUInt16LE(aces.length, 4)
  head.writeUInt16LE(0, 6)
  return Buffer.concat([head, ...aceBufs])
}

export function buildSecurityDescriptor(sd: SecurityDescriptor): Buffer {
  const owner = sd.owner ? stringToSid(sd.owner) : Buffer.alloc(0)
  const group = sd.group ? stringToSid(sd.group) : Buffer.alloc(0)
  const dacl = sd.dacl.length || sd.control & SD_CONTROL.DACL_PRESENT ? buildAcl(sd.dacl) : Buffer.alloc(0)
  const sacl = sd.sacl.length ? buildAcl(sd.sacl) : Buffer.alloc(0)

  let control = (sd.control | SD_CONTROL.SELF_RELATIVE) & 0xffff
  if (dacl.length) control |= SD_CONTROL.DACL_PRESENT
  if (sacl.length) control |= SD_CONTROL.SACL_PRESENT
  control = sd.daclProtected ? control | SD_CONTROL.DACL_PROTECTED : control & ~SD_CONTROL.DACL_PROTECTED
  control = sd.saclProtected ? control | SD_CONTROL.SACL_PROTECTED : control & ~SD_CONTROL.SACL_PROTECTED

  const header = Buffer.alloc(20)
  header.writeUInt8(1, 0) // revision
  header.writeUInt8(0, 1) // sbz1
  header.writeUInt16LE(control, 2)

  let off = 20
  const parts: Buffer[] = []
  const offsets = { owner: 0, group: 0, sacl: 0, dacl: 0 }
  // Orden habitual de Windows: SACL, DACL, owner, group.
  if (sacl.length) { offsets.sacl = off; parts.push(sacl); off += sacl.length }
  if (dacl.length) { offsets.dacl = off; parts.push(dacl); off += dacl.length }
  if (owner.length) { offsets.owner = off; parts.push(owner); off += owner.length }
  if (group.length) { offsets.group = off; parts.push(group); off += group.length }

  header.writeUInt32LE(offsets.owner, 4)
  header.writeUInt32LE(offsets.group, 8)
  header.writeUInt32LE(offsets.sacl, 12)
  header.writeUInt32LE(offsets.dacl, 16)

  return Buffer.concat([header, ...parts])
}

/** Control LDAP_SERVER_SD_FLAGS_OID: qué partes del SD leer/escribir. */
export const SD_FLAGS = {
  OWNER: 0x01,
  GROUP: 0x02,
  DACL: 0x04,
  SACL: 0x08
} as const

/** Presets de permisos que muestra la pestaña Seguridad de ADUC. */
export const PERMISSION_PRESETS = [
  { key: 'fullControl', label: 'Control total', mask: 0x000f01ff },
  { key: 'read', label: 'Lectura', mask: ACCESS_MASK.READ_PROP | ACCESS_MASK.READ_CONTROL | ACCESS_MASK.LIST_CONTENTS | ACCESS_MASK.LIST_OBJECT },
  { key: 'write', label: 'Escritura', mask: ACCESS_MASK.WRITE_PROP | ACCESS_MASK.SELF_WRITE },
  { key: 'createChild', label: 'Crear todos los objetos secundarios', mask: ACCESS_MASK.CREATE_CHILD },
  { key: 'deleteChild', label: 'Eliminar todos los objetos secundarios', mask: ACCESS_MASK.DELETE_CHILD },
  { key: 'deleteTree', label: 'Eliminar subárbol', mask: ACCESS_MASK.DELETE_TREE },
  { key: 'delete', label: 'Eliminar', mask: ACCESS_MASK.DELETE },
  { key: 'readPermissions', label: 'Leer permisos', mask: ACCESS_MASK.READ_CONTROL },
  { key: 'modifyPermissions', label: 'Modificar permisos', mask: ACCESS_MASK.WRITE_DAC },
  { key: 'modifyOwner', label: 'Modificar propietario', mask: ACCESS_MASK.WRITE_OWNER },
  { key: 'allExtended', label: 'Todos los derechos extendidos', mask: ACCESS_MASK.CONTROL_ACCESS }
] as const
