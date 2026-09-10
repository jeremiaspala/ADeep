/** Controles LDAP específicos de Active Directory. */
import { Control } from 'ldapts'
import asn1 from 'asn1'
import type { BerWriter as BerWriterType } from 'asn1'

const { BerWriter } = asn1

/** Envuelve el valor del control en el OCTET STRING que espera el protocolo. */
function writeIntControlValue(writer: BerWriterType, value: number): void {
  const inner = new BerWriter()
  inner.startSequence()
  inner.writeInt(value)
  inner.endSequence()
  writer.writeBuffer(inner.buffer, 0x04)
}

export const OID = {
  SD_FLAGS: '1.2.840.113556.1.4.801',
  SHOW_DELETED: '1.2.840.113556.1.4.417',
  SHOW_RECYCLED: '1.2.840.113556.1.4.2064',
  SHOW_DEACTIVATED_LINK: '1.2.840.113556.1.4.2065',
  TREE_DELETE: '1.2.840.113556.1.4.805',
  PERMISSIVE_MODIFY: '1.2.840.113556.1.4.1413',
  LAZY_COMMIT: '1.2.840.113556.1.4.619',
  DOMAIN_SCOPE: '1.2.840.113556.1.4.1339',
  SEARCH_OPTIONS: '1.2.840.113556.1.4.1340',
  NOTIFICATION: '1.2.840.113556.1.4.528',
  EXTENDED_DN: '1.2.840.113556.1.4.529',
  SORT: '1.2.840.113556.1.4.473',
  VLV: '2.16.840.1.113730.3.4.9',
  DIRSYNC: '1.2.840.113556.1.4.841',
  FAST_BIND: '1.2.840.113556.1.4.1781',
  WHOAMI: '1.3.6.1.4.1.4203.1.11.3',
  START_TLS: '1.3.6.1.4.1.1466.20037',
  PASSWORD_MODIFY: '1.3.6.1.4.1.4203.1.11.1'
} as const

/** LDAP_SERVER_SD_FLAGS_OID — qué partes del descriptor de seguridad leer/escribir. */
export class SDFlagsControl extends Control {
  static type = OID.SD_FLAGS
  value: number

  constructor(flags: number, critical = true) {
    super(OID.SD_FLAGS, { critical })
    this.value = flags
  }

  public override writeControl(writer: BerWriterType): void {
    writeIntControlValue(writer, this.value)
  }
}

/** LDAP_SERVER_SHOW_DELETED_OID — incluye tombstones en la búsqueda. */
export class ShowDeletedControl extends Control {
  constructor(critical = true) {
    super(OID.SHOW_DELETED, { critical })
  }
}

/** LDAP_SERVER_SHOW_RECYCLED_OID — necesario con la papelera de reciclaje de AD habilitada. */
export class ShowRecycledControl extends Control {
  constructor(critical = true) {
    super(OID.SHOW_RECYCLED, { critical })
  }
}

/** LDAP_SERVER_TREE_DELETE_OID — borra un subárbol completo en una operación. */
export class TreeDeleteControl extends Control {
  constructor(critical = true) {
    super(OID.TREE_DELETE, { critical })
  }
}

/** LDAP_SERVER_PERMISSIVE_MODIFY_OID — add de valor existente / delete de inexistente no falla. */
export class PermissiveModifyControl extends Control {
  constructor(critical = false) {
    super(OID.PERMISSIVE_MODIFY, { critical })
  }
}

/** LDAP_SERVER_EXTENDED_DN_OID — devuelve DNs con GUID y SID embebidos. */
export class ExtendedDNControl extends Control {
  value: number

  /** 0 = SID/GUID en hexadecimal, 1 = formato string. */
  constructor(flag: 0 | 1 = 1, critical = false) {
    super(OID.EXTENDED_DN, { critical })
    this.value = flag
  }

  public override writeControl(writer: BerWriterType): void {
    writeIntControlValue(writer, this.value)
  }
}
