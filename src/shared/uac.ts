/** Flags de userAccountControl (MS-ADTS 2.2.16). */
export const UAC = {
  SCRIPT: 0x0001,
  ACCOUNTDISABLE: 0x0002,
  HOMEDIR_REQUIRED: 0x0008,
  LOCKOUT: 0x0010,
  PASSWD_NOTREQD: 0x0020,
  PASSWD_CANT_CHANGE: 0x0040,
  ENCRYPTED_TEXT_PWD_ALLOWED: 0x0080,
  TEMP_DUPLICATE_ACCOUNT: 0x0100,
  NORMAL_ACCOUNT: 0x0200,
  INTERDOMAIN_TRUST_ACCOUNT: 0x0800,
  WORKSTATION_TRUST_ACCOUNT: 0x1000,
  SERVER_TRUST_ACCOUNT: 0x2000,
  DONT_EXPIRE_PASSWORD: 0x10000,
  MNS_LOGON_ACCOUNT: 0x20000,
  SMARTCARD_REQUIRED: 0x40000,
  TRUSTED_FOR_DELEGATION: 0x80000,
  NOT_DELEGATED: 0x100000,
  USE_DES_KEY_ONLY: 0x200000,
  DONT_REQ_PREAUTH: 0x400000,
  PASSWORD_EXPIRED: 0x800000,
  TRUSTED_TO_AUTH_FOR_DELEGATION: 0x1000000,
  PARTIAL_SECRETS_ACCOUNT: 0x04000000
} as const

export type UACFlag = keyof typeof UAC

export const UAC_LABELS: Record<UACFlag, string> = {
  SCRIPT: 'Ejecutar script de inicio de sesión',
  ACCOUNTDISABLE: 'Cuenta deshabilitada',
  HOMEDIR_REQUIRED: 'Carpeta particular requerida',
  LOCKOUT: 'Cuenta bloqueada',
  PASSWD_NOTREQD: 'No se requiere contraseña',
  PASSWD_CANT_CHANGE: 'El usuario no puede cambiar la contraseña',
  ENCRYPTED_TEXT_PWD_ALLOWED: 'Guardar contraseña con cifrado reversible',
  TEMP_DUPLICATE_ACCOUNT: 'Cuenta duplicada temporal',
  NORMAL_ACCOUNT: 'Cuenta de usuario normal',
  INTERDOMAIN_TRUST_ACCOUNT: 'Cuenta de confianza entre dominios',
  WORKSTATION_TRUST_ACCOUNT: 'Cuenta de equipo (workstation/servidor miembro)',
  SERVER_TRUST_ACCOUNT: 'Cuenta de controlador de dominio',
  DONT_EXPIRE_PASSWORD: 'La contraseña nunca expira',
  MNS_LOGON_ACCOUNT: 'Cuenta de inicio de sesión MNS',
  SMARTCARD_REQUIRED: 'Requiere tarjeta inteligente para inicio de sesión interactivo',
  TRUSTED_FOR_DELEGATION: 'La cuenta es de confianza para delegación',
  NOT_DELEGATED: 'La cuenta es importante y no se puede delegar',
  USE_DES_KEY_ONLY: 'Usar sólo tipos de cifrado DES de Kerberos',
  DONT_REQ_PREAUTH: 'No requerir autenticación previa de Kerberos',
  PASSWORD_EXPIRED: 'Contraseña expirada',
  TRUSTED_TO_AUTH_FOR_DELEGATION: 'Confiar para delegación con cualquier protocolo',
  PARTIAL_SECRETS_ACCOUNT: 'Controlador de dominio de sólo lectura (RODC)'
}

export function hasFlag(uac: number, flag: number): boolean {
  return (uac & flag) === flag
}

export function setFlag(uac: number, flag: number, on: boolean): number {
  return on ? uac | flag : uac & ~flag
}

export function decodeUAC(uac: number): UACFlag[] {
  return (Object.keys(UAC) as UACFlag[]).filter((k) => hasFlag(uac, UAC[k]))
}

/** msDS-User-Account-Control-Computed (sólo lectura, calculado por el DC). */
export const UAC_COMPUTED = {
  LOCKOUT: 0x0010,
  PASSWORD_EXPIRED: 0x800000
} as const

/** groupType (MS-ADTS 2.2.12). */
export const GROUP_TYPE = {
  BUILTIN_LOCAL: 0x00000001,
  ACCOUNT_GROUP: 0x00000002, // Global
  RESOURCE_GROUP: 0x00000004, // Domain local
  UNIVERSAL_GROUP: 0x00000008,
  APP_BASIC_GROUP: 0x00000010,
  APP_QUERY_GROUP: 0x00000020,
  SECURITY_ENABLED: 0x80000000
} as const

export type GroupScope = 'global' | 'domainLocal' | 'universal' | 'builtinLocal'

export function groupScopeOf(groupType: number): GroupScope {
  if (groupType & GROUP_TYPE.UNIVERSAL_GROUP) return 'universal'
  if (groupType & GROUP_TYPE.RESOURCE_GROUP) return 'domainLocal'
  if (groupType & GROUP_TYPE.BUILTIN_LOCAL) return 'builtinLocal'
  return 'global'
}

export function isSecurityGroup(groupType: number): boolean {
  // groupType es int32 con signo en AD: 0x80000000 llega como negativo.
  return (groupType & GROUP_TYPE.SECURITY_ENABLED) !== 0 || groupType < 0
}

export function buildGroupType(scope: 2 | 4 | 8, security: boolean): number {
  const base = scope
  // -2147483648 === 0x80000000 como int32 con signo.
  return security ? base | -2147483648 : base
}

/** sAMAccountType (MS-ADTS 2.2.8). */
export const SAM_ACCOUNT_TYPE: Record<number, string> = {
  0x0: 'SAM_DOMAIN_OBJECT',
  0x10000000: 'SAM_GROUP_OBJECT',
  0x10000001: 'SAM_NON_SECURITY_GROUP_OBJECT',
  0x20000000: 'SAM_ALIAS_OBJECT',
  0x20000001: 'SAM_NON_SECURITY_ALIAS_OBJECT',
  0x30000000: 'SAM_USER_OBJECT',
  0x30000001: 'SAM_MACHINE_ACCOUNT',
  0x30000002: 'SAM_TRUST_ACCOUNT',
  0x40000000: 'SAM_APP_BASIC_GROUP',
  0x40000001: 'SAM_APP_QUERY_GROUP'
}

/** instanceType (MS-ADTS 2.2.9). */
export const INSTANCE_TYPE: Record<number, string> = {
  0x00000001: 'IS_NC_HEAD',
  0x00000002: 'NC no instanciado',
  0x00000004: 'IS_WRITEABLE',
  0x00000008: 'NC padre presente',
  0x00000010: 'NC en construcción',
  0x00000020: 'NC en eliminación'
}

/** systemFlags (MS-ADTS 2.2.10). */
export const SYSTEM_FLAGS = {
  NOT_REPLICATED: 0x00000001,
  REPLICATED_TO_GC: 0x00000002,
  CONSTRUCTED: 0x00000004,
  BASE_SCHEMA: 0x00000010,
  DISALLOW_DELETE: 0x80000000,
  DOMAIN_DISALLOW_RENAME: 0x08000000,
  DOMAIN_DISALLOW_MOVE: 0x04000000,
  CONFIG_ALLOW_LIMITED_MOVE: 0x10000000,
  CONFIG_ALLOW_MOVE: 0x20000000,
  CONFIG_ALLOW_RENAME: 0x40000000
} as const
