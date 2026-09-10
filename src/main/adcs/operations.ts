/**
 * Servicios de certificados (ADCS).
 *
 * Todo lo que se administra acá vive en
 * `CN=Public Key Services,CN=Services,CN=Configuration`:
 *   - `CN=Certificate Templates` → plantillas (`pKICertificateTemplate`)
 *   - `CN=Enrollment Services`   → entidades emisoras (`pKIEnrollmentService`)
 *   - `CN=Certification Authorities` → CAs de confianza raíz
 *   - `CN=NTAuthCertificates`    → CAs habilitadas para autenticar en el dominio
 *
 * Emitir o revocar certificados es MS-ICPR (RPC) y queda fuera: por LDAP se
 * administran las plantillas, sus permisos y qué CA publica cada una.
 */
import type { AdConnection } from '../ldap/connection'
import { firstNumber, firstString, allStrings } from '../ldap/directory'
import { rdnValue } from '../ldap/encoding'
import type { CertificateAuthority, CertificateTemplate, TemplateRisk } from '../../shared/types'

export function pkiDN(conn: AdConnection): string {
  return `CN=Public Key Services,CN=Services,${conn.configDN}`
}

/** msPKI-Certificate-Name-Flag (MS-CRTD 2.27). */
export const NAME_FLAG = {
  ENROLLEE_SUPPLIES_SUBJECT: 0x00000001,
  ENROLLEE_SUPPLIES_SUBJECT_ALT_NAME: 0x00010000,
  SUBJECT_ALT_REQUIRE_DOMAIN_DNS: 0x00400000,
  SUBJECT_ALT_REQUIRE_SPN: 0x00800000,
  SUBJECT_ALT_REQUIRE_DIRECTORY_GUID: 0x01000000,
  SUBJECT_ALT_REQUIRE_UPN: 0x02000000,
  SUBJECT_ALT_REQUIRE_EMAIL: 0x04000000,
  SUBJECT_ALT_REQUIRE_DNS: 0x08000000,
  SUBJECT_REQUIRE_DNS_AS_CN: 0x10000000,
  SUBJECT_REQUIRE_EMAIL: 0x20000000,
  SUBJECT_REQUIRE_COMMON_NAME: 0x40000000,
  SUBJECT_REQUIRE_DIRECTORY_PATH: 0x80000000
} as const

/** msPKI-Enrollment-Flag (MS-CRTD 2.26). */
export const ENROLLMENT_FLAG = {
  INCLUDE_SYMMETRIC_ALGORITHMS: 0x00000001,
  PEND_ALL_REQUESTS: 0x00000002,
  PUBLISH_TO_KRA_CONTAINER: 0x00000004,
  PUBLISH_TO_DS: 0x00000008,
  AUTO_ENROLLMENT_CHECK_USER_DS_CERTIFICATE: 0x00000010,
  AUTO_ENROLLMENT: 0x00000020,
  PREVIOUS_APPROVAL_VALIDATE_REENROLLMENT: 0x00000040,
  USER_INTERACTION_REQUIRED: 0x00000100,
  REMOVE_INVALID_CERTIFICATE_FROM_PERSONAL_STORE: 0x00000400,
  ALLOW_ENROLL_ON_BEHALF_OF: 0x00000800,
  NO_REVOCATION_INFO_IN_ISSUED_CERTS: 0x00001000,
  INCLUDE_BASIC_CONSTRAINTS_FOR_EE_CERTS: 0x00002000,
  ALLOW_PREVIOUS_APPROVAL_KEYBASEDRENEWAL_VALIDATE_REENROLLMENT: 0x00004000,
  ISSUANCE_POLICIES_FROM_REQUEST: 0x00008000,
  SKIP_AUTO_RENEWAL: 0x00010000,
  NO_SECURITY_EXTENSION: 0x00080000
} as const

/** Usos extendidos de clave que habilitan autenticación. */
const EKU_NAMES: Record<string, string> = {
  '1.3.6.1.5.5.7.3.1': 'Autenticación de servidor',
  '1.3.6.1.5.5.7.3.2': 'Autenticación de cliente',
  '1.3.6.1.5.5.7.3.3': 'Firma de código',
  '1.3.6.1.5.5.7.3.4': 'Correo seguro',
  '1.3.6.1.5.5.7.3.5': 'Sistema final IPsec',
  '1.3.6.1.5.5.7.3.8': 'Sellado de tiempo',
  '1.3.6.1.5.5.7.3.9': 'Firma de respuesta OCSP',
  '1.3.6.1.4.1.311.10.3.4': 'Sistema de cifrado de archivos (EFS)',
  '1.3.6.1.4.1.311.10.3.4.1': 'Recuperación de archivos',
  '1.3.6.1.4.1.311.10.3.12': 'Firma de documentos',
  '1.3.6.1.4.1.311.20.2.2': 'Inicio de sesión con tarjeta inteligente',
  '1.3.6.1.4.1.311.20.2.1': 'Agente de solicitud de certificados',
  '1.3.6.1.4.1.311.21.5': 'Agente de recuperación de claves',
  '1.3.6.1.4.1.311.21.6': 'Agente de recuperación de claves (KRA)',
  '2.5.29.37.0': 'Cualquier propósito'
}

/** EKUs que alcanzan para autenticarse como otro usuario. */
const AUTH_EKUS = new Set([
  '1.3.6.1.5.5.7.3.2', // autenticación de cliente
  '1.3.6.1.4.1.311.20.2.2', // inicio de sesión con tarjeta inteligente
  '1.3.6.1.5.2.3.4', // PKINIT
  '2.5.29.37.0' // cualquier propósito
])

export async function listTemplates(conn: AdConnection): Promise<CertificateTemplate[]> {
  const [plantillas, cas] = await Promise.all([
    conn
      .searchRaw(`CN=Certificate Templates,${pkiDN(conn)}`, {
        scope: 'one',
        filter: '(objectClass=pKICertificateTemplate)',
        attributes: [
          'cn', 'displayName', 'revision', 'msPKI-Template-Schema-Version',
          'msPKI-Certificate-Name-Flag', 'msPKI-Enrollment-Flag', 'msPKI-RA-Signature',
          'msPKI-Minimal-Key-Size', 'pKIExtendedKeyUsage', 'msPKI-Cert-Template-OID',
          'pKIExpirationPeriod', 'whenChanged'
        ],
        pageSize: 500
      })
      .catch(() => []),
    listAuthorities(conn)
  ])

  const publicadaPor = new Map<string, string[]>()
  for (const ca of cas) {
    for (const t of ca.templates) {
      const key = t.toLowerCase()
      publicadaPor.set(key, [...(publicadaPor.get(key) ?? []), ca.name])
    }
  }

  return plantillas
    .map((e) => {
      const nameFlags = firstNumber(e, 'msPKI-Certificate-Name-Flag') ?? 0
      const enrollFlags = firstNumber(e, 'msPKI-Enrollment-Flag') ?? 0
      const raSignatures = firstNumber(e, 'msPKI-RA-Signature') ?? 0
      const ekus = allStrings(e, 'pKIExtendedKeyUsage')
      const cn = firstString(e, 'cn') ?? rdnValue(e.dn)
      const publishedBy = publicadaPor.get(cn.toLowerCase()) ?? []

      const suppliesSubject = (nameFlags & NAME_FLAG.ENROLLEE_SUPPLIES_SUBJECT) !== 0
      const requiresApproval = (enrollFlags & ENROLLMENT_FLAG.PEND_ALL_REQUESTS) !== 0
      const autoEnroll = (enrollFlags & ENROLLMENT_FLAG.AUTO_ENROLLMENT) !== 0
      // Sin EKU declarado, el certificado sirve para cualquier cosa.
      const authEku = !ekus.length || ekus.some((o) => AUTH_EKUS.has(o))

      return {
        dn: e.dn,
        cn,
        name: firstString(e, 'displayName') ?? cn,
        schemaVersion: firstNumber(e, 'msPKI-Template-Schema-Version') ?? 1,
        revision: firstNumber(e, 'revision') ?? 0,
        nameFlags,
        enrollmentFlags: enrollFlags,
        raSignatures,
        minimalKeySize: firstNumber(e, 'msPKI-Minimal-Key-Size') ?? 0,
        ekus,
        ekuNames: ekus.length ? ekus.map((o) => EKU_NAMES[o] ?? o) : ['(cualquiera)'],
        suppliesSubject,
        requiresApproval,
        autoEnroll,
        publishToDs: (enrollFlags & ENROLLMENT_FLAG.PUBLISH_TO_DS) !== 0,
        noSecurityExtension: (enrollFlags & ENROLLMENT_FLAG.NO_SECURITY_EXTENSION) !== 0,
        publishedBy,
        validity: formatPeriod(e.attrs.pKIExpirationPeriod?.[0]),
        risks: assessRisks({
          suppliesSubject, requiresApproval, raSignatures, ekus, authEku, enrollFlags,
          published: publishedBy.length > 0
        })
      }
    })
    .sort((a, b) => a.name.localeCompare(b.name, 'es'))
}

/**
 * Marca las combinaciones peligrosas conocidas. No reemplaza a una auditoría,
 * pero deja a la vista lo que en la práctica permite escalar privilegios.
 */
function assessRisks(t: {
  suppliesSubject: boolean
  requiresApproval: boolean
  raSignatures: number
  ekus: string[]
  authEku: boolean
  enrollFlags: number
  published: boolean
}): TemplateRisk[] {
  const out: TemplateRisk[] = []
  const sinControles = !t.requiresApproval && t.raSignatures === 0
  // Una plantilla que ninguna CA publica no se puede pedir: la observación
  // sigue valiendo, pero no es explotable hasta que alguien la publique.
  const grave = (s: TemplateRisk['severity']): TemplateRisk['severity'] =>
    t.published ? s : 'baja'
  const nota = t.published ? '' : ' Hoy ninguna entidad emisora la publica, así que no es solicitable.'

  if (t.suppliesSubject && t.authEku && sinControles) {
    out.push({
      id: 'ESC1',
      severity: grave('alta'),
      label: 'El solicitante elige el sujeto y el certificado sirve para autenticar',
      detail:
        'Cualquiera que pueda inscribirse puede pedir un certificado a nombre de otro usuario, ' +
        'incluido un administrador de dominio. Pedí aprobación del administrador o firmas de ' +
        'agente de inscripción, o sacá el uso de autenticación.' + nota
    })
  }

  if (t.ekus.includes('2.5.29.37.0') && sinControles) {
    out.push({
      id: 'ESC2',
      severity: grave('alta'),
      label: 'Uso «cualquier propósito» sin aprobación',
      detail: 'Un certificado emitido con esta plantilla sirve para cualquier cosa, incluida la autenticación.' + nota
    })
  }

  if (!t.ekus.length && sinControles) {
    out.push({
      id: 'ESC2',
      severity: grave('alta'),
      label: 'Sin uso extendido de clave declarado',
      detail: 'Sin EKU, el certificado no tiene restricción de uso.' + nota
    })
  }

  if (t.ekus.includes('1.3.6.1.4.1.311.20.2.1') && sinControles) {
    out.push({
      id: 'ESC3',
      severity: grave('alta'),
      label: 'Agente de solicitud de certificados sin aprobación',
      detail: 'Permite pedir certificados en nombre de otros usuarios.' + nota
    })
  }

  if ((t.enrollFlags & ENROLLMENT_FLAG.NO_SECURITY_EXTENSION) !== 0) {
    out.push({
      id: 'ESC9',
      severity: t.published ? 'media' : 'baja',
      label: 'Sin extensión de seguridad (SID)',
      detail:
        'El certificado no lleva el SID del solicitante, así que la asignación al usuario queda ' +
        'sólo por el nombre. Debilita las mitigaciones de KB5014754.'
    })
  }

  return out
}

export async function listAuthorities(conn: AdConnection): Promise<CertificateAuthority[]> {
  const raw = await conn
    .searchRaw(`CN=Enrollment Services,${pkiDN(conn)}`, {
      scope: 'one',
      filter: '(objectClass=pKIEnrollmentService)',
      attributes: ['cn', 'displayName', 'dNSHostName', 'certificateTemplates', 'cACertificateDN', 'flags']
    })
    .catch(() => [])

  return raw.map((e) => ({
    dn: e.dn,
    name: firstString(e, 'displayName') ?? firstString(e, 'cn') ?? rdnValue(e.dn),
    host: firstString(e, 'dNSHostName') ?? '',
    templates: allStrings(e, 'certificateTemplates'),
    subject: firstString(e, 'cACertificateDN') ?? '',
    flags: firstNumber(e, 'flags') ?? 0
  }))
}

/** CAs de confianza del bosque: raíces, NTAuth e intermedias. */
export async function listTrustStores(
  conn: AdConnection
): Promise<{ store: string; label: string; certificates: number; dn: string }[]> {
  const stores: { cn: string; label: string }[] = [
    { cn: 'Certification Authorities', label: 'Entidades de certificación raíz de confianza' },
    { cn: 'NTAuthCertificates', label: 'CAs habilitadas para autenticar en el dominio (NTAuth)' },
    { cn: 'AIA', label: 'Acceso a la información de la entidad emisora (AIA)' },
    { cn: 'KRA', label: 'Agentes de recuperación de claves' }
  ]

  const out: { store: string; label: string; certificates: number; dn: string }[] = []
  for (const s of stores) {
    const dn = `CN=${s.cn},${pkiDN(conn)}`
    const found = await conn
      .searchRaw(dn, { scope: 'sub', filter: '(cACertificate=*)', attributes: ['cACertificate', 'cn'] })
      .catch(() => [])
    const total = found.reduce((n, e) => n + (e.attrs.cACertificate?.length ?? 0), 0)
    out.push({ store: s.cn, label: s.label, certificates: total, dn })
  }
  return out
}

/**
 * Certificados de las CAs del bosque, en PEM. Sirven para verificar el
 * certificado LDAPS del controlador de dominio sin tener que desactivar la
 * validación: la CA que lo firmó ya está publicada en el propio directorio.
 */
export async function getCaCertificates(
  conn: AdConnection
): Promise<{ name: string; store: string; pem: string }[]> {
  const out: { name: string; store: string; pem: string }[] = []

  for (const store of ['Certification Authorities', 'NTAuthCertificates', 'AIA']) {
    const found = await conn
      .searchRaw(`CN=${store},${pkiDN(conn)}`, {
        scope: 'sub',
        filter: '(cACertificate=*)',
        attributes: ['cACertificate', 'cn']
      })
      .catch(() => [])

    for (const e of found) {
      const nombre = firstString(e, 'cn') ?? rdnValue(e.dn)
      for (const v of e.attrs.cACertificate ?? []) {
        if (!Buffer.isBuffer(v) || v.length < 100) continue
        const pem = toPem(v)
        if (!out.some((c) => c.pem === pem)) out.push({ name: nombre, store, pem })
      }
    }
  }

  return out
}

function toPem(der: Buffer): string {
  const b64 = der.toString('base64').replace(/(.{64})/g, '$1\n').replace(/\n$/, '')
  return `-----BEGIN CERTIFICATE-----\n${b64}\n-----END CERTIFICATE-----\n`
}

/** pKIExpirationPeriod es un FILETIME negativo de 8 bytes. */
function formatPeriod(value?: string | Buffer): string {
  if (!Buffer.isBuffer(value) || value.length < 8) return '—'
  const intervalos = value.readBigInt64LE(0)
  if (intervalos >= 0n) return '—'
  const segundos = Number(-intervalos / 10_000_000n)
  const dias = Math.round(segundos / 86400)
  if (dias % 365 === 0) return `${dias / 365} año(s)`
  if (dias % 30 === 0) return `${dias / 30} mes(es)`
  return `${dias} día(s)`
}

export { EKU_NAMES }
