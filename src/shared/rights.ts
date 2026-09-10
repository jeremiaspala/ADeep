/** Máscaras de acceso de AD (MS-ADTS 5.1.3.2) para la UI de seguridad. */

export const ACCESS_MASK = {
  CREATE_CHILD: 0x00000001,
  DELETE_CHILD: 0x00000002,
  LIST_CONTENTS: 0x00000004,
  SELF_WRITE: 0x00000008,
  READ_PROP: 0x00000010,
  WRITE_PROP: 0x00000020,
  DELETE_TREE: 0x00000040,
  LIST_OBJECT: 0x00000080,
  CONTROL_ACCESS: 0x00000100,
  DELETE: 0x00010000,
  READ_CONTROL: 0x00020000,
  WRITE_DAC: 0x00040000,
  WRITE_OWNER: 0x00080000,
  SYNCHRONIZE: 0x00100000,
  ACCESS_SYSTEM_SECURITY: 0x01000000,
  GENERIC_ALL: 0x10000000,
  GENERIC_EXECUTE: 0x20000000,
  GENERIC_WRITE: 0x40000000,
  GENERIC_READ: 0x80000000
} as const

export type AccessRight = keyof typeof ACCESS_MASK

export const ACCESS_MASK_LABELS: Record<AccessRight, string> = {
  CREATE_CHILD: 'Crear todos los objetos secundarios',
  DELETE_CHILD: 'Eliminar todos los objetos secundarios',
  LIST_CONTENTS: 'Mostrar contenido',
  SELF_WRITE: 'Escritura validada',
  READ_PROP: 'Leer todas las propiedades',
  WRITE_PROP: 'Escribir todas las propiedades',
  DELETE_TREE: 'Eliminar subárbol',
  LIST_OBJECT: 'Mostrar objeto',
  CONTROL_ACCESS: 'Todos los derechos extendidos',
  DELETE: 'Eliminar',
  READ_CONTROL: 'Leer permisos',
  WRITE_DAC: 'Modificar permisos',
  WRITE_OWNER: 'Modificar propietario',
  SYNCHRONIZE: 'Sincronizar',
  ACCESS_SYSTEM_SECURITY: 'Auditar',
  GENERIC_ALL: 'Control total',
  GENERIC_EXECUTE: 'Ejecución genérica',
  GENERIC_WRITE: 'Escritura genérica',
  GENERIC_READ: 'Lectura genérica'
}

/** Conjuntos que muestra la pestaña Seguridad de ADUC. */
export const PERMISSION_SETS: { id: string; label: string; mask: number }[] = [
  { id: 'full', label: 'Control total', mask: 0x000f01ff },
  { id: 'read', label: 'Lectura', mask: 0x00020094 },
  { id: 'write', label: 'Escritura', mask: 0x00020028 },
  { id: 'createChild', label: 'Crear todos los objetos secundarios', mask: 0x00000001 },
  { id: 'deleteChild', label: 'Eliminar todos los objetos secundarios', mask: 0x00000002 },
  { id: 'deleteTree', label: 'Eliminar subárbol', mask: 0x00000040 },
  { id: 'extended', label: 'Todos los derechos extendidos', mask: 0x00000100 },
  { id: 'delete', label: 'Eliminar', mask: 0x00010000 },
  { id: 'writeDac', label: 'Modificar permisos', mask: 0x00040000 },
  { id: 'writeOwner', label: 'Modificar propietario', mask: 0x00080000 }
]

export function maskHas(mask: number, bits: number): boolean {
  return (mask & bits) === bits
}
