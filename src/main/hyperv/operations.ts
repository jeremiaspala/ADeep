/**
 * Hyper-V.
 *
 * Active Directory guarda el *fabric*, no las máquinas. Cada host publica:
 *
 *   - un punto de conexión `CN=Microsoft Hyper-V` bajo su objeto de equipo, con
 *     el listener de VMConnect en `serviceBindingInformation`
 *     (`"RDP listener port=2179"`);
 *   - los SPN `Microsoft Virtual System Migration Service`,
 *     `Microsoft Virtual Console Service` y `Hyper-V Replica Service`;
 *   - en `msDS-AllowedToDelegateTo`, los hosts a los que puede migrar en vivo
 *     con Kerberos.
 *
 * Cada invitado con los servicios de integración publica a su vez
 * `CN=Windows Virtual Machine` bajo su propio objeto de equipo, así que el
 * inventario de VM unidas al dominio también sale del directorio.
 *
 * Lo que **no** está acá: el estado de las VM, su memoria, sus discos, sus
 * conmutadores y sus puntos de control. Eso vive en el WMI del host
 * (`root\virtualization\v2`) y necesita otro transporte.
 */
import type { AdConnection } from '../ldap/connection'
import { firstString, firstNumber, firstBuffer, allStrings, resolveSids } from '../ldap/directory'
import { parseSecurityDescriptor } from '../ldap/sddl'
import { filetimeToDate, generalizedTimeToDate, parentDN, sidToString } from '../ldap/encoding'
import { UAC } from '../../shared/uac'
import type {
  HyperVCluster,
  HyperVGuest,
  HyperVHost,
  HyperVIssue,
  HyperVState
} from '../../shared/types'

/** Clases de SPN que identifican los servicios del fabric. */
export const SPN_CLASS = {
  migration: 'Microsoft Virtual System Migration Service',
  console: 'Microsoft Virtual Console Service',
  replica: 'Hyper-V Replica Service',
  winrm: 'WSMAN',
  cluster: 'MSServerCluster'
} as const

/** `cn` de los puntos de conexión que publica Hyper-V. */
const SCP_HOST = 'microsoft hyper-v'
const SCP_GUEST = 'windows virtual machine'

const COMPUTER_ATTRS = [
  'name',
  'dNSHostName',
  'operatingSystem',
  'operatingSystemVersion',
  'description',
  'location',
  'servicePrincipalName',
  'msDS-AllowedToDelegateTo',
  'msDS-AllowedToActOnBehalfOfOtherIdentity',
  'msDS-SupportedEncryptionTypes',
  'userAccountControl',
  'lastLogonTimestamp',
  'whenCreated'
]

/** `msDS-SupportedEncryptionTypes` (MS-KILE 2.2.7). */
const ETYPE = [
  { bit: 0x01, label: 'DES-CBC-CRC', debil: true },
  { bit: 0x02, label: 'DES-CBC-MD5', debil: true },
  { bit: 0x04, label: 'RC4-HMAC', debil: true },
  { bit: 0x08, label: 'AES128', debil: false },
  { bit: 0x10, label: 'AES256', debil: false },
  { bit: 0x20, label: 'AES128-SHA256', debil: false },
  { bit: 0x40, label: 'AES256-SHA384', debil: false }
] as const

function spnClass(spn: string): string {
  return spn.slice(0, spn.indexOf('/'))
}

function spnHost(spn: string): string {
  return spn.slice(spn.indexOf('/') + 1).split(':')[0]
}

/** Nombre corto en mayúsculas: es la clave con la que se cruzan SPN y DN. */
function shortName(host: string): string {
  return host.split('.')[0].toUpperCase()
}

function isoDate(d: Date | null): string | undefined {
  return d ? d.toISOString() : undefined
}

/** `RDP listener port=2179` dentro de `serviceBindingInformation`. */
export function parseConsolePort(values: string[]): number | undefined {
  for (const v of values) {
    const m = /port\s*=\s*(\d+)/i.exec(v)
    if (m) return Number(m[1])
  }
  return undefined
}

/**
 * SPN que Windows escribe en `msDS-AllowedToDelegateTo` cuando se habilita la
 * migración en vivo con Kerberos hacia otro host. Van el nombre corto y el FQDN
 * de cada destino porque el cliente puede pedir el ticket con cualquiera de los dos.
 */
export function delegationSpns(
  targets: { name: string; dnsHostName?: string }[],
  includeReplica: boolean
): string[] {
  const out: string[] = []
  for (const t of targets) {
    const names = [t.dnsHostName, t.name].filter((n): n is string => !!n)
    const classes = ['CIFS', 'HOST', SPN_CLASS.migration]
    if (includeReplica) classes.push(SPN_CLASS.replica)
    for (const cls of classes) for (const n of names) out.push(`${cls}/${n}`)
  }
  return out
}

export async function getState(conn: AdConnection): Promise<HyperVState> {
  const [scps, computers] = await Promise.all([
    conn
      .searchRaw(conn.baseDN, {
        scope: 'sub',
        filter: `(&(objectClass=serviceConnectionPoint)(|(cn=Microsoft Hyper-V)(cn=Windows Virtual Machine)))`,
        attributes: ['cn', 'serviceBindingInformation']
      })
      .catch(() => []),
    conn.searchRaw(conn.baseDN, {
      scope: 'sub',
      filter: '(objectCategory=computer)',
      attributes: COMPUTER_ATTRS
    })
  ])

  const byDN = new Map<string, (typeof computers)[number]>()
  for (const e of computers) byDN.set(e.dn.toLowerCase(), e)

  /* Los SCP cuelgan del objeto del equipo: el padre es el host o el invitado. */
  const hostScp = new Map<string, { port?: number }>()
  const guestScp = new Map<string, string>()
  for (const scp of scps) {
    const cn = (firstString(scp, 'cn') ?? '').toLowerCase()
    const owner = parentDN(scp.dn).toLowerCase()
    if (cn === SCP_HOST) {
      hostScp.set(owner, { port: parseConsolePort(allStrings(scp, 'serviceBindingInformation')) })
    } else if (cn === SCP_GUEST) {
      guestScp.set(owner, scp.dn)
    }
  }

  /* Un host se reconoce por el SCP o por cualquiera de los SPN del rol. */
  const hostDNs = new Set(hostScp.keys())
  const clusterDNs = new Set<string>()
  for (const e of computers) {
    const spns = allStrings(e, 'servicePrincipalName')
    for (const spn of spns) {
      const cls = spnClass(spn)
      if (cls === SPN_CLASS.migration || cls === SPN_CLASS.console || cls === SPN_CLASS.replica) {
        hostDNs.add(e.dn.toLowerCase())
      } else if (cls === SPN_CLASS.cluster) {
        clusterDNs.add(e.dn.toLowerCase())
      }
    }
  }

  const hosts: HyperVHost[] = []
  for (const dn of hostDNs) {
    const e = byDN.get(dn)
    if (!e) continue
    const spns = allStrings(e, 'servicePrincipalName')
    const classes = new Set(spns.map(spnClass))
    const uac = firstNumber(e, 'userAccountControl') ?? 0
    const scp = hostScp.get(dn)
    const etypes = firstNumber(e, 'msDS-SupportedEncryptionTypes')
    hosts.push({
      dn: e.dn,
      name: firstString(e, 'name') ?? '',
      dnsHostName: firstString(e, 'dNSHostName'),
      operatingSystem: firstString(e, 'operatingSystem'),
      operatingSystemVersion: firstString(e, 'operatingSystemVersion'),
      description: firstString(e, 'description'),
      location: firstString(e, 'location'),
      services: {
        migration: classes.has(SPN_CLASS.migration),
        console: classes.has(SPN_CLASS.console),
        replica: classes.has(SPN_CLASS.replica),
        winrm: classes.has(SPN_CLASS.winrm)
      },
      hasScp: !!scp,
      consolePort: scp?.port,
      enabled: !(uac & UAC.ACCOUNTDISABLE),
      unconstrained: !!(uac & UAC.TRUSTED_FOR_DELEGATION),
      anyProtocol: !!(uac & UAC.TRUSTED_TO_AUTH_FOR_DELEGATION),
      migratesTo: [],
      replicatesTo: [],
      foreignDelegation: [],
      rbcd: [],
      encryptionTypes: etypes,
      encryptionLabels: etypes === undefined
        ? []
        : ETYPE.filter((t) => etypes & t.bit).map((t) => t.label),
      rc4Enabled: etypes === undefined ? false : ETYPE.some((t) => t.debil && etypes & t.bit),
      lastLogon: isoDate(filetimeToDate(firstString(e, 'lastLogonTimestamp') ?? '0')),
      created: isoDate(generalizedTimeToDate(firstString(e, 'whenCreated') ?? ''))
    })
  }
  hosts.sort((a, b) => a.name.localeCompare(b.name, 'es', { numeric: true }))

  /* Delegación: se resuelve recién con la lista de hosts armada, porque hay que
     distinguir un destino conocido de uno que ya no existe. */
  const known = new Map(hosts.map((h) => [shortName(h.name), h.name]))
  for (const h of hosts) {
    const e = byDN.get(h.dn.toLowerCase())!
    const migrate = new Set<string>()
    const replicate = new Set<string>()
    const foreign = new Set<string>()
    for (const spn of allStrings(e, 'msDS-AllowedToDelegateTo')) {
      const cls = spnClass(spn)
      if (cls !== SPN_CLASS.migration && cls !== SPN_CLASS.replica) continue
      const target = known.get(shortName(spnHost(spn)))
      if (!target) foreign.add(spn)
      else if (cls === SPN_CLASS.migration) migrate.add(target)
      else replicate.add(target)
    }
    h.migratesTo = [...migrate].sort()
    h.replicatesTo = [...replicate].sort()
    h.foreignDelegation = [...foreign].sort()
  }

  /*
   * RBCD: `msDS-AllowedToActOnBehalfOfOtherIdentity` es un descriptor de
   * seguridad cuyo DACL enumera quién puede pedir tickets en nombre de
   * cualquier usuario contra este host. Se escribe desde el host de destino,
   * así que no hace falta ser administrador del dominio para ponerlo: es un
   * camino de escalación clásico y conviene mirarlo siempre.
   */
  const sidsRbcd = new Set<string>()
  for (const h of hosts) {
    const buf = firstBuffer(byDN.get(h.dn.toLowerCase())!, 'msDS-AllowedToActOnBehalfOfOtherIdentity')
    if (!buf?.length) continue
    try {
      const sd = parseSecurityDescriptor(buf)
      for (const ace of sd.dacl) {
        if (ace.type !== 'allow' && ace.type !== 'allow-object') continue
        if (!ace.trusteeSID) continue
        h.rbcd.push({ sid: ace.trusteeSID, name: ace.trusteeSID })
        sidsRbcd.add(ace.trusteeSID)
      }
    } catch {
      h.rbcd.push({ sid: '', name: 'descriptor ilegible' })
    }
  }
  if (sidsRbcd.size) {
    const nombres = await resolveSids(conn, [...sidsRbcd]).catch(() => ({}) as Record<string, string>)
    for (const h of hosts) {
      for (const r of h.rbcd) if (nombres[r.sid]) r.name = nombres[r.sid]
    }
  }

  const guests: HyperVGuest[] = []
  for (const [dn, scpDN] of guestScp) {
    const e = byDN.get(dn)
    if (!e) continue
    const uac = firstNumber(e, 'userAccountControl') ?? 0
    guests.push({
      dn: e.dn,
      name: firstString(e, 'name') ?? '',
      dnsHostName: firstString(e, 'dNSHostName'),
      operatingSystem: firstString(e, 'operatingSystem'),
      enabled: !(uac & UAC.ACCOUNTDISABLE),
      lastLogon: isoDate(filetimeToDate(firstString(e, 'lastLogonTimestamp') ?? '0')),
      created: isoDate(generalizedTimeToDate(firstString(e, 'whenCreated') ?? '')),
      scpDN
    })
  }
  guests.sort((a, b) => a.name.localeCompare(b.name, 'es', { numeric: true }))

  const clusters: HyperVCluster[] = []
  for (const dn of clusterDNs) {
    const e = byDN.get(dn)
    if (!e) continue
    const uac = firstNumber(e, 'userAccountControl') ?? 0
    clusters.push({
      dn: e.dn,
      name: firstString(e, 'name') ?? '',
      dnsHostName: firstString(e, 'dNSHostName'),
      enabled: !(uac & UAC.ACCOUNTDISABLE),
      virtualNames: []
    })
  }
  clusters.sort((a, b) => a.name.localeCompare(b.name, 'es', { numeric: true }))
  if (clusters.length) await asociarVcos(conn, clusters)

  return { hosts, guests, clusters, issues: review(hosts, guests) }
}

/**
 * Los nombres virtuales del clúster (VCO) son objetos de equipo que crea el
 * propio CNO, así que quedan con el CNO como dueño del descriptor de seguridad.
 * No hay atributo que los enlace: el dueño es la única pista fiable.
 *
 * **Sin ejercitar:** este dominio no tiene ningún clúster.
 */
async function asociarVcos(conn: AdConnection, clusters: HyperVCluster[]): Promise<void> {
  const { SDFlagsControl } = await import('../ldap/controls')
  const porSid = new Map<string, HyperVCluster>()

  for (const c of clusters) {
    const e = await conn.searchOne(c.dn, ['objectSid']).catch(() => null)
    const sid = e && firstBuffer(e, 'objectSid')
    if (sid) porSid.set(sidToString(sid), c)
  }
  if (!porSid.size) return

  // Sólo el dueño: pedir el DACL de cada equipo del dominio sería carísimo.
  const equipos = await conn
    .searchRaw(conn.baseDN, {
      scope: 'sub',
      filter: '(objectCategory=computer)',
      attributes: ['name', 'nTSecurityDescriptor'],
      controls: [new SDFlagsControl(0x01)],
      pageSize: 500
    })
    .catch(() => [])

  for (const e of equipos) {
    const buf = firstBuffer(e, 'nTSecurityDescriptor')
    if (!buf?.length) continue
    try {
      const dueño = parseSecurityDescriptor(buf).owner
      const cluster = dueño && porSid.get(dueño)
      const nombre = firstString(e, 'name')
      if (cluster && nombre && nombre !== cluster.name) cluster.virtualNames.push(nombre)
    } catch {
      /* un descriptor ilegible no puede tumbar la lectura entera */
    }
  }
  for (const c of clusters) c.virtualNames.sort()
}

/**
 * Revisión del fabric. Todo lo que se puede afirmar mirando sólo el directorio:
 * no dice si la migración en vivo funciona, dice si Kerberos la puede autorizar.
 */
export function review(hosts: HyperVHost[], guests: HyperVGuest[] = []): HyperVIssue[] {
  const issues: HyperVIssue[] = []
  const solo = hosts.length < 2

  for (const h of hosts) {
    if (!h.enabled) {
      issues.push({
        id: `${h.name}:disabled`,
        severity: 'baja',
        host: h.name,
        label: 'Host fuera de servicio',
        detail:
          'La cuenta de equipo está deshabilitada: el host no puede autenticarse en el dominio. Si ' +
          'se dio de baja, es lo esperado, pero el objeto sigue publicando sus SPN y otros hosts ' +
          'pueden seguir delegando hacia él.'
      })
    }

    if (h.unconstrained) {
      issues.push({
        id: `${h.name}:unconstrained`,
        // Con la cuenta deshabilitada nadie puede autenticarse contra el host, así que
        // la delegación abierta no es explotable hasta que alguien lo vuelva a habilitar.
        severity: h.enabled ? 'alta' : 'baja',
        host: h.name,
        label: h.enabled
          ? 'Delegación no restringida'
          : 'Delegación no restringida (inerte: la cuenta está deshabilitada)',
        detail:
          'El host está marcado como de confianza para delegación sin restricciones: guarda el TGT ' +
          'de todo el que se autentica contra él y puede suplantarlo ante cualquier servicio del ' +
          'dominio. Para migración en vivo alcanza con delegación restringida a los otros hosts.' +
          (h.enabled
            ? ''
            : ' Hoy no es explotable porque la cuenta está deshabilitada, pero volvería a serlo ' +
              'si alguien la reactiva.')
      })
    }

    if (h.rbcd.length) {
      issues.push({
        id: `${h.name}:rbcd`,
        severity: h.enabled ? 'alta' : 'media',
        host: h.name,
        label: 'Delegación restringida basada en recursos (RBCD)',
        detail:
          'Estas identidades pueden pedir tickets en nombre de cualquier usuario contra este host: ' +
          h.rbcd.map((r) => r.name).join(', ') +
          '. El atributo se escribe desde el propio host, así que no hace falta ser administrador ' +
          'del dominio para ponerlo: es un camino de escalación conocido. Confirmá que cada una ' +
          'tiene motivo para estar.'
      })
    }

    if (h.anyProtocol && h.enabled) {
      issues.push({
        id: `${h.name}:anyprotocol`,
        severity: 'media',
        host: h.name,
        label: 'Delegación con cualquier protocolo',
        detail:
          'El host tiene TRUSTED_TO_AUTH_FOR_DELEGATION (transición de protocolo): puede fabricarse ' +
          'un ticket a nombre de cualquier usuario sin que ese usuario se haya autenticado. La ' +
          'migración en vivo no lo necesita: le alcanza con «sólo Kerberos».'
      })
    }

    if (h.rc4Enabled && h.enabled) {
      issues.push({
        id: `${h.name}:rc4`,
        severity: 'media',
        host: h.name,
        label: 'Acepta RC4 para Kerberos',
        detail:
          `msDS-SupportedEncryptionTypes = ${h.encryptionTypes} (${h.encryptionLabels.join(', ')}). ` +
          'RC4 permite ataques de fuerza bruta sobre el ticket (Kerberoasting) mucho más baratos que ' +
          'AES. Si todos los equipos que hablan con este host son Windows 8/2012 o posteriores, se ' +
          'puede dejar sólo AES128 y AES256 (valor 24).'
      })
    }

    if (!h.services.migration) {
      issues.push({
        id: `${h.name}:nomigration`,
        severity: 'media',
        host: h.name,
        label: 'Sin SPN de migración en vivo',
        detail:
          'El host no registró «Microsoft Virtual System Migration Service». Sin ese SPN ningún ' +
          'otro host puede pedir un ticket para migrarle máquinas.'
      })
    } else if (!solo && !h.migratesTo.length && !h.unconstrained) {
      issues.push({
        id: `${h.name}:nodelegation`,
        severity: 'media',
        host: h.name,
        label: 'No puede iniciar migraciones con Kerberos',
        detail:
          'No tiene delegación restringida hacia ningún otro host, así que sólo puede migrar en vivo ' +
          'con CredSSP, que obliga a iniciar sesión en el host de origen para lanzar la migración.'
      })
    }

    for (const peer of h.migratesTo) {
      const other = hosts.find((x) => x.name === peer)
      if (!other) continue
      if (!other.enabled) {
        // Delegar hacia un host dado de baja no es una migración a medias: es basura
        // que quedó. Se informa en el host vivo, que es donde hay que limpiarla.
        issues.push({
          id: `${h.name}:deadpeer:${peer}`,
          severity: 'media',
          host: h.name,
          label: `Delega hacia ${peer}, que está fuera de servicio`,
          detail:
            `${h.name} tiene delegación de migración en vivo hacia ${peer}, cuya cuenta de equipo ` +
            `está deshabilitada. Esos SPN ya no sirven para nada: conviene sacar ${peer} de la ` +
            `lista de destinos de ${h.name}.`
        })
      } else if (!other.migratesTo.includes(h.name)) {
        issues.push({
          id: `${h.name}:oneway:${peer}`,
          severity: 'media',
          host: h.name,
          label: `Migración en un solo sentido con ${peer}`,
          detail:
            `${h.name} puede migrar hacia ${peer}, pero ${peer} no tiene delegación de vuelta hacia ` +
            `${h.name}. La migración en vivo con Kerberos tiene que estar configurada en los dos lados.`
        })
      }
    }

    if (h.foreignDelegation.length) {
      issues.push({
        id: `${h.name}:foreign`,
        severity: 'baja',
        host: h.name,
        label: 'Delegación hacia hosts que no existen',
        detail:
          'Quedaron destinos de delegación que no corresponden a ningún host de Hyper-V del dominio: ' +
          h.foreignDelegation.join(', ') +
          '. Suelen ser hosts dados de baja; conviene limpiarlos.'
      })
    }

    if (!h.services.winrm) {
      issues.push({
        id: `${h.name}:nowinrm`,
        severity: 'baja',
        host: h.name,
        label: 'Sin SPN de WinRM',
        detail:
          'El host no publica el SPN WSMAN. Administrarlo en remoto con Kerberos (PowerShell, WMI, ' +
          'o esta consola el día que hable WS-Man) requiere que WinRM esté habilitado y registrado.'
      })
    }

    if (!h.hasScp) {
      issues.push({
        id: `${h.name}:noscp`,
        severity: 'baja',
        host: h.name,
        label: 'Sin punto de conexión de servicio',
        detail:
          'Falta el objeto «CN=Microsoft Hyper-V» bajo el equipo: el servicio de administración de ' +
          'máquinas virtuales no lo publicó o no tiene permiso para escribirlo. No se puede saber en ' +
          'qué puerto escucha VMConnect.'
      })
    }
  }

  /* Los invitados se informan agregados: una fila por VM sería ruido. */
  const deshabilitadas = guests.filter((g) => !g.enabled)
  if (deshabilitadas.length) {
    issues.push({
      id: 'guests:deshabilitadas',
      severity: 'baja',
      host: '(máquinas virtuales)',
      label: `${deshabilitadas.length} VM con la cuenta de equipo deshabilitada`,
      detail:
        deshabilitadas.map((g) => g.name).join(', ') +
        '. Si están dadas de baja, el objeto de equipo y su registro DNS también deberían irse: ' +
        'los nombres que sobreviven a la máquina terminan resolviendo a la IP de otra cosa.'
    })
  }

  const CORTE = Date.now() - 90 * 24 * 3600 * 1000
  const dormidas = guests.filter(
    (g) => g.enabled && (!g.lastLogon || Date.parse(g.lastLogon) < CORTE)
  )
  if (dormidas.length) {
    issues.push({
      id: 'guests:dormidas',
      severity: 'baja',
      host: '(máquinas virtuales)',
      label: `${dormidas.length} VM sin iniciar sesión en más de 90 días`,
      detail:
        dormidas.map((g) => g.name).join(', ') +
        '. Una cuenta de equipo que no se usa mantiene su contraseña vieja y sigue siendo una ' +
        'identidad válida del dominio. Conviene confirmar si la máquina existe todavía.'
    })
  }

  const orden = { alta: 0, media: 1, baja: 2 }
  return issues.sort((a, b) => orden[a.severity] - orden[b.severity] || a.host.localeCompare(b.host))
}

/**
 * Habilita la migración en vivo con Kerberos desde `dn` hacia los hosts indicados.
 * Escribe la lista completa: lo que no esté en `targets` deja de estar delegado.
 *
 * Delegación restringida y no restringida se excluyen, así que si el host tenía
 * TRUSTED_FOR_DELEGATION hay que apagarlo o el DC ignora `msDS-AllowedToDelegateTo`.
 */
export async function setMigrationDelegation(
  conn: AdConnection,
  dn: string,
  targets: { name: string; dnsHostName?: string }[],
  includeReplica: boolean
): Promise<void> {
  const values = delegationSpns(targets, includeReplica)
  await conn.modify(dn, [
    values.length
      ? { op: 'replace', attribute: 'msDS-AllowedToDelegateTo', values }
      : { op: 'delete', attribute: 'msDS-AllowedToDelegateTo', values: [] }
  ])
  await setUnconstrained(conn, dn, false)
}

/** Limpia toda la delegación restringida del host. */
export async function clearDelegation(conn: AdConnection, dn: string): Promise<void> {
  await conn.modify(dn, [{ op: 'delete', attribute: 'msDS-AllowedToDelegateTo', values: [] }])
}

/** Prende o apaga TRUSTED_FOR_DELEGATION sin tocar el resto de userAccountControl. */
export async function setUnconstrained(
  conn: AdConnection,
  dn: string,
  enabled: boolean
): Promise<number> {
  const entry = await conn.searchOne(dn, ['userAccountControl'])
  if (!entry) throw new Error('No se encontró el equipo en el directorio.')
  const current = firstNumber(entry, 'userAccountControl') ?? 0
  const next = enabled
    ? current | UAC.TRUSTED_FOR_DELEGATION
    : current & ~UAC.TRUSTED_FOR_DELEGATION
  if (next === current) return current
  await conn.modify(dn, [{ op: 'replace', attribute: 'userAccountControl', values: [String(next)] }])
  return next
}
