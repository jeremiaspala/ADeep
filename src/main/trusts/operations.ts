/** Dominios y confianzas: trustedDomain en CN=System y crossRef en CN=Partitions. */
import type { AdConnection } from '../ldap/connection'
import { ConnectionError } from '../ldap/connection'
import { firstBuffer, firstNumber, firstString, allStrings } from '../ldap/directory'
import { generalizedTimeToDate, rdnValue, sidToString } from '../ldap/encoding'
import type { ForestInfo, PartitionInfo, TrustInfo } from '../../shared/types'

/** trustAttributes (MS-ADTS 6.1.6.7.9). */
export const TRUST_ATTRIBUTES = {
  NON_TRANSITIVE: 0x00000001,
  UPLEVEL_ONLY: 0x00000002,
  QUARANTINED_DOMAIN: 0x00000004,
  FOREST_TRANSITIVE: 0x00000008,
  CROSS_ORGANIZATION: 0x00000010,
  WITHIN_FOREST: 0x00000020,
  TREAT_AS_EXTERNAL: 0x00000040,
  USES_RC4_ENCRYPTION: 0x00000080,
  CROSS_ORGANIZATION_NO_TGT_DELEGATION: 0x00000200,
  PIM_TRUST: 0x00000400
} as const

const ATTRIBUTE_LABELS: [number, string][] = [
  [TRUST_ATTRIBUTES.NON_TRANSITIVE, 'No transitiva'],
  [TRUST_ATTRIBUTES.UPLEVEL_ONLY, 'Sólo Windows 2000 o superior'],
  [TRUST_ATTRIBUTES.QUARANTINED_DOMAIN, 'Filtrado de SID activado'],
  [TRUST_ATTRIBUTES.FOREST_TRANSITIVE, 'Transitiva de bosque'],
  [TRUST_ATTRIBUTES.CROSS_ORGANIZATION, 'Entre organizaciones (autenticación selectiva)'],
  [TRUST_ATTRIBUTES.WITHIN_FOREST, 'Dentro del mismo bosque'],
  [TRUST_ATTRIBUTES.TREAT_AS_EXTERNAL, 'Tratar como externa'],
  [TRUST_ATTRIBUTES.USES_RC4_ENCRYPTION, 'Usa cifrado RC4'],
  [TRUST_ATTRIBUTES.CROSS_ORGANIZATION_NO_TGT_DELEGATION, 'Sin delegación de TGT'],
  [TRUST_ATTRIBUTES.PIM_TRUST, 'Confianza PIM/PAM']
]

const DIRECTION_LABELS: Record<number, string> = {
  0: 'Deshabilitada',
  1: 'Entrante',
  2: 'Saliente',
  3: 'Bidireccional'
}

const TYPE_LABELS: Record<number, string> = {
  1: 'Windows NT (downlevel)',
  2: 'Active Directory',
  3: 'Kerberos MIT',
  4: 'DCE'
}

export function trustsDN(conn: AdConnection): string {
  return `CN=System,${conn.baseDN}`
}

export function partitionsDN(conn: AdConnection): string {
  return `CN=Partitions,${conn.configDN}`
}

/**
 * msDS-TrustForestTrustInfo (MS-ADTS 6.1.6.9.3): cabecera de versión + cantidad de
 * registros, y cada registro lleva longitud, flags, timestamp, tipo y datos. Sólo
 * extraemos los nombres de dominio DNS y NetBIOS de los registros TOP_LEVEL_NAME (0)
 * y DOMAIN_INFO (2), que es lo que muestra la consola de MMC.
 */
export function parseForestTrustInfo(buf?: Buffer): string[] {
  if (!buf || buf.length < 8) return []
  const out: string[] = []
  try {
    const count = buf.readUInt32LE(4)
    let p = 8
    for (let i = 0; i < count && p + 11 <= buf.length; i++) {
      const recordLen = buf.readUInt32LE(p)
      const type = buf.readUInt8(p + 16)
      const end = p + 4 + recordLen
      let q = p + 17

      if (type === 0 || type === 1) {
        // TOP_LEVEL_NAME / TOP_LEVEL_NAME_EX: un LSA_UNICODE_STRING en UTF-8.
        const len = buf.readUInt32LE(q)
        q += 4
        if (len > 0 && q + len <= buf.length) out.push(buf.subarray(q, q + len).toString('utf8'))
      } else if (type === 2) {
        // DOMAIN_INFO: SID, nombre DNS y nombre NetBIOS.
        const sidLen = buf.readUInt32LE(q)
        q += 4 + sidLen
        if (q + 4 <= buf.length) {
          const dnsLen = buf.readUInt32LE(q)
          q += 4
          if (dnsLen > 0 && q + dnsLen <= buf.length) {
            out.push(buf.subarray(q, q + dnsLen).toString('utf8'))
            q += dnsLen
          }
        }
      }
      if (end <= p) break
      p = end
    }
  } catch {
    // Blob con un formato que no reconocemos: preferimos no mostrar nada antes que basura.
    return out
  }
  return [...new Set(out)]
}

function toIso(value?: string): string | undefined {
  return value ? generalizedTimeToDate(value)?.toISOString() : undefined
}

export function toTrustInfo(e: {
  dn: string
  attrs: Record<string, (string | Buffer)[]>
}): TrustInfo {
  const raw = e as Parameters<typeof firstString>[0]
  const direction = firstNumber(raw, 'trustDirection') ?? 0
  const type = firstNumber(raw, 'trustType') ?? 0
  const attributes = firstNumber(raw, 'trustAttributes') ?? 0
  const sidBuf = firstBuffer(raw, 'securityIdentifier')

  return {
    dn: e.dn,
    name: firstString(raw, 'name') ?? rdnValue(e.dn),
    partner: firstString(raw, 'trustPartner') ?? rdnValue(e.dn),
    flatName: firstString(raw, 'flatName'),
    direction,
    directionLabel: DIRECTION_LABELS[direction] ?? `Desconocida (${direction})`,
    type,
    typeLabel: TYPE_LABELS[type] ?? `Desconocido (${type})`,
    attributes,
    attributeLabels: ATTRIBUTE_LABELS.filter(([bit]) => (attributes & bit) !== 0).map(([, label]) => label),
    transitive: (attributes & TRUST_ATTRIBUTES.NON_TRANSITIVE) === 0,
    forestTransitive: (attributes & TRUST_ATTRIBUTES.FOREST_TRANSITIVE) !== 0,
    sidFiltering: (attributes & TRUST_ATTRIBUTES.QUARANTINED_DOMAIN) !== 0,
    selectiveAuth: (attributes & TRUST_ATTRIBUTES.CROSS_ORGANIZATION) !== 0,
    sid: sidBuf && sidBuf.length >= 8 ? sidToString(sidBuf) : undefined,
    encryptionTypes: firstNumber(raw, 'msDS-SupportedEncryptionTypes'),
    whenCreated: toIso(firstString(raw, 'whenCreated')),
    whenChanged: toIso(firstString(raw, 'whenChanged')),
    forestNamespaces: parseForestTrustInfo(firstBuffer(raw, 'msDS-TrustForestTrustInfo'))
  }
}

export async function listTrusts(conn: AdConnection): Promise<TrustInfo[]> {
  const raw = await conn.searchRaw(trustsDN(conn), {
    scope: 'one',
    filter: '(objectClass=trustedDomain)',
    attributes: [
      'name', 'trustPartner', 'flatName', 'trustDirection', 'trustType', 'trustAttributes',
      'securityIdentifier', 'msDS-SupportedEncryptionTypes', 'msDS-TrustForestTrustInfo',
      'whenCreated', 'whenChanged'
    ]
  })
  return raw.map(toTrustInfo).sort((a, b) => a.partner.localeCompare(b.partner, 'es'))
}

/**
 * Cambia los atributos de una confianza existente. Crear, validar o restablecer una
 * confianza necesita LSA RPC (MS-LSAD): eso queda fuera de lo que se puede hacer por LDAP.
 */
export async function updateTrust(
  conn: AdConnection,
  dn: string,
  patch: { sidFiltering?: boolean; selectiveAuth?: boolean; encryptionTypes?: number }
): Promise<void> {
  const e = await conn.searchOne(dn, ['trustAttributes'])
  if (!e) throw new ConnectionError('La confianza ya no existe.')
  let attributes = firstNumber(e, 'trustAttributes') ?? 0

  if (patch.sidFiltering !== undefined) {
    attributes = patch.sidFiltering
      ? attributes | TRUST_ATTRIBUTES.QUARANTINED_DOMAIN
      : attributes & ~TRUST_ATTRIBUTES.QUARANTINED_DOMAIN
  }
  if (patch.selectiveAuth !== undefined) {
    attributes = patch.selectiveAuth
      ? attributes | TRUST_ATTRIBUTES.CROSS_ORGANIZATION
      : attributes & ~TRUST_ATTRIBUTES.CROSS_ORGANIZATION
  }

  const mods: { op: 'replace'; attribute: string; values: string[] }[] = [
    { op: 'replace', attribute: 'trustAttributes', values: [String(attributes >>> 0)] }
  ]
  if (patch.encryptionTypes !== undefined) {
    mods.push({
      op: 'replace',
      attribute: 'msDS-SupportedEncryptionTypes',
      values: [String(patch.encryptionTypes)]
    })
  }
  await conn.modify(dn, mods)
}

/* ---------------- Particiones del bosque ---------------- */

const SYSTEM_FLAG_NC = 0x00000001
const SYSTEM_FLAG_DOMAIN = 0x00000002

export async function listPartitions(conn: AdConnection): Promise<PartitionInfo[]> {
  const raw = await conn.searchRaw(partitionsDN(conn), {
    scope: 'one',
    filter: '(objectClass=crossRef)',
    attributes: ['name', 'nCName', 'dnsRoot', 'nETBIOSName', 'msDS-Behavior-Version', 'systemFlags']
  })
  const wellKnownNCs = new Set([conn.configDN.toLowerCase(), conn.schemaDN.toLowerCase()])

  return raw
    .map((e) => {
      const systemFlags = firstNumber(e, 'systemFlags') ?? 0
      const ncName = firstString(e, 'nCName') ?? ''
      const isDomain = (systemFlags & SYSTEM_FLAG_DOMAIN) !== 0
      return {
        dn: e.dn,
        name: firstString(e, 'name') ?? rdnValue(e.dn),
        ncName,
        dnsRoot: firstString(e, 'dnsRoot') ?? '',
        netbiosName: firstString(e, 'nETBIOSName'),
        behaviorVersion: firstNumber(e, 'msDS-Behavior-Version'),
        systemFlags,
        isDomain,
        // Configuration y Schema también son NC sin ser particiones de aplicación.
        isApplicationPartition:
          (systemFlags & SYSTEM_FLAG_NC) !== 0 && !isDomain && !wellKnownNCs.has(ncName.toLowerCase())
      }
    })
    .sort((a, b) => Number(b.isDomain) - Number(a.isDomain) || a.dnsRoot.localeCompare(b.dnsRoot))
}

export async function getForestInfo(conn: AdConnection): Promise<ForestInfo> {
  const [partitions, trusts, container] = await Promise.all([
    listPartitions(conn),
    listTrusts(conn).catch(() => []),
    conn.searchOne(partitionsDN(conn), ['uPNSuffixes', 'msDS-SpnSuffixes', 'msDS-Behavior-Version'])
  ])

  return {
    rootDomain: conn.rootDSE.rootDomainNamingContext,
    forestFunctionality: conn.rootDSE.forestFunctionality,
    domainFunctionality: conn.rootDSE.domainFunctionality,
    partitionsDN: partitionsDN(conn),
    upnSuffixes: container ? allStrings(container, 'uPNSuffixes') : [],
    spnSuffixes: container ? allStrings(container, 'msDS-SpnSuffixes') : [],
    partitions,
    trusts
  }
}

/* ---------------- Sufijos UPN ---------------- */

export async function setUpnSuffixes(conn: AdConnection, suffixes: string[]): Promise<void> {
  const clean = [...new Set(suffixes.map((s) => s.trim().replace(/^@/, '')).filter(Boolean))]
  await conn.modify(partitionsDN(conn), [
    clean.length
      ? { op: 'replace', attribute: 'uPNSuffixes', values: clean }
      : { op: 'delete', attribute: 'uPNSuffixes', values: [] }
  ])
}

export async function setSpnSuffixes(conn: AdConnection, suffixes: string[]): Promise<void> {
  const clean = [...new Set(suffixes.map((s) => s.trim()).filter(Boolean))]
  await conn.modify(partitionsDN(conn), [
    clean.length
      ? { op: 'replace', attribute: 'msDS-SpnSuffixes', values: clean }
      : { op: 'delete', attribute: 'msDS-SpnSuffixes', values: [] }
  ])
}

/* ---------------- Niveles funcionales ---------------- */

/**
 * Elevar el nivel funcional es irreversible. El del dominio se escribe en el objeto
 * domainDNS; el del bosque, en CN=Partitions.
 */
export async function raiseDomainFunctionalLevel(conn: AdConnection, level: number): Promise<void> {
  if (level <= conn.rootDSE.domainFunctionality) {
    throw new ConnectionError('El nivel funcional sólo se puede elevar, nunca bajar.')
  }
  await conn.modify(conn.baseDN, [
    { op: 'replace', attribute: 'msDS-Behavior-Version', values: [String(level)] }
  ])
}

export async function raiseForestFunctionalLevel(conn: AdConnection, level: number): Promise<void> {
  if (level <= conn.rootDSE.forestFunctionality) {
    throw new ConnectionError('El nivel funcional sólo se puede elevar, nunca bajar.')
  }
  await conn.modify(partitionsDN(conn), [
    { op: 'replace', attribute: 'msDS-Behavior-Version', values: [String(level)] }
  ])
}

/** Nivel funcional máximo que soportan todos los DCs del dominio. */
export async function maxSupportedLevel(conn: AdConnection): Promise<number> {
  const dcs = await conn.searchRaw(conn.baseDN, {
    scope: 'sub',
    filter: '(&(objectCategory=computer)(userAccountControl:1.2.840.113556.1.4.803:=8192))',
    attributes: ['msDS-Behavior-Version', 'operatingSystemVersion', 'name']
  })
  const levels = dcs
    .map((d) => firstNumber(d, 'msDS-Behavior-Version'))
    .filter((n): n is number => n !== undefined)
  return levels.length ? Math.min(...levels) : conn.rootDSE.domainFunctionality
}
