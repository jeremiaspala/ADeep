import { useCallback, useMemo, useState, type JSX } from 'react'
import {
  Layers, ServerCog, ShieldAlert, KeyRound, Info, MonitorPlay, Check, X, Boxes
} from 'lucide-react'
import type { HyperVHost, HyperVState, SessionInfo } from '@shared/types'
import ConsoleShell from '../../shell/ConsoleShell'
import SimpleTree, { type TreeItem } from '../../shell/SimpleTree'
import DetailList from '../../shell/DetailList'
import FindingList, { type Finding } from '../../shell/FindingList'
import { Check2, MenuPopup, Modal, useConfirm, type MenuItemDef } from '../../components/ui'
import { report } from '../../store'
import { fmtDate } from '../../lib/format'

type Vista = 'hosts' | 'invitados' | 'clusters' | 'delegacion' | 'revision' | 'vm'

const SEV_COLOR = { alta: 'var(--danger)', media: 'var(--warn)', baja: 'var(--text-dim)' } as const
const SEV_BG = { alta: 'var(--danger-soft)', media: 'var(--warn-soft)', baja: 'var(--bg-sunken)' } as const

function Si({ on }: { on: boolean }): JSX.Element {
  return on
    ? <Check size={14} color="var(--ok)" />
    : <X size={14} color="var(--text-dim)" />
}

/** Inicial del servicio: verde si el host publica el SPN, apagada si no. */
function Svc({ on, letra, que }: { on: boolean; letra: string; que: string }): JSX.Element {
  return (
    <span
      title={`${que}: ${on ? 'publicado' : 'no publicado'}`}
      className={`badge ${on ? 'ok' : 'neutral'}`}
      style={{ width: 18, textAlign: 'center', padding: '1px 0', fontWeight: 600 }}
    >
      {letra}
    </span>
  )
}

export default function HyperVConsole(): JSX.Element {
  const [state, setState] = useState<HyperVState | null>(null)
  const [loading, setLoading] = useState(false)
  const [vista, setVista] = useState<Vista>('hosts')
  const [editing, setEditing] = useState<HyperVHost | null>(null)
  const [detalle, setDetalle] = useState<HyperVHost | null>(null)
  const confirm = useConfirm()

  const cargar = useCallback(async (): Promise<void> => {
    setLoading(true)
    const res = await window.adeep.hyperv.state()
    setLoading(false)
    const data = report(res)
    if (data) setState(data)
  }, [])

  const onSession = useCallback((_i: SessionInfo) => { void cargar() }, [cargar])

  const hosts = state?.hosts ?? []
  const issues = state?.issues ?? []
  const graves = issues.filter((i) => i.severity === 'alta').length

  const quitarUnconstrained = useCallback(async (host: HyperVHost): Promise<void> => {
    const ok = await confirm({
      title: 'Quitar la delegación no restringida',
      message: `Se le va a apagar TRUSTED_FOR_DELEGATION a ${host.name}.`,
      detail:
        'Si el host usa delegación no restringida para algo más que la migración en vivo (acceso a ' +
        'recursos SMB con la identidad del usuario, por ejemplo), eso deja de funcionar hasta que se ' +
        'configure la delegación restringida equivalente.',
      confirmLabel: 'Quitar',
      danger: true
    })
    if (!ok) return
    const res = await window.adeep.hyperv.setUnconstrained(host.dn, false)
    if (report(res, `${host.name}: delegación no restringida apagada`) !== undefined) void cargar()
  }, [confirm, cargar])

  const tree = useMemo<TreeItem[]>(() => [
    {
      id: 'hyperv',
      label: 'Hyper-V',
      kind: 'hvRoot',
      children: [
        { id: 'hosts', label: 'Hosts', kind: 'hvHost', badge: String(hosts.length) },
        { id: 'invitados', label: 'Máquinas virtuales', kind: 'hvGuest', badge: String(state?.guests.length ?? 0) },
        { id: 'clusters', label: 'Clústeres', kind: 'hvCluster', badge: String(state?.clusters.length ?? 0) },
        { id: 'delegacion', label: 'Migración en vivo', kind: 'hvDelegation' },
        { id: 'revision', label: 'Revisión', kind: 'hvCheck', badge: issues.length ? String(issues.length) : undefined },
        { id: 'vm', label: 'Administración de VM', kind: 'unknown' }
      ]
    }
  ], [hosts.length, state, issues.length])

  const menuHost = (host: HyperVHost): MenuItemDef[] => [
    {
      id: 'props',
      label: 'Propiedades…',
      icon: <ServerCog size={15} />,
      onSelect: () => setDetalle(host)
    },
    { id: 's0', separator: true },
    {
      id: 'deleg',
      label: 'Configurar migración en vivo…',
      icon: <KeyRound size={15} />,
      onSelect: () => setEditing(host)
    },
    {
      id: 'unconstrained',
      label: 'Quitar delegación no restringida',
      icon: <ShieldAlert size={15} />,
      danger: true,
      disabled: !host.unconstrained,
      onSelect: () => void quitarUnconstrained(host)
    }
  ]

  const [ctx, setCtx] = useState<{ items: MenuItemDef[]; x: number; y: number } | null>(null)

  const main = ((): JSX.Element => {
    if (vista === 'hosts') {
      return (
        <>
          <div className="list-head">
            <div className="crumbs"><span className="crumb last">Hosts de Hyper-V del dominio</span></div>
          </div>
          <DetailList
            rows={hosts}
            rowKey={(h) => h.dn}
            rowKind={() => 'hvHost'}
            empty="Ningún equipo del dominio publica los servicios de Hyper-V"
            onOpen={(h) => setDetalle(h)}
            onContextMenu={(h, x, y) => setCtx({ items: menuHost(h), x, y })}
            columns={[
              { id: 'name', label: 'Host', width: '13%', render: (h) => h.name, sortValue: (h) => h.name },
              { id: 'dns', label: 'Nombre DNS', width: '22%', render: (h) => h.dnsHostName ?? '—' },
              {
                id: 'os', label: 'Sistema operativo', width: '18%',
                render: (h) => h.operatingSystem ?? '—', sortValue: (h) => h.operatingSystem ?? ''
              },
              {
                id: 'svc', label: 'Servicios', width: '14%',
                render: (h) => (
                  <span className="row" style={{ gap: 5 }}>
                    <Svc on={h.services.migration} letra="M" que="Migración en vivo (Microsoft Virtual System Migration Service)" />
                    <Svc on={h.services.console} letra="C" que="Consola (Microsoft Virtual Console Service)" />
                    <Svc on={h.services.replica} letra="R" que="Réplica (Hyper-V Replica Service)" />
                    <Svc on={h.services.winrm} letra="W" que="WinRM (SPN WSMAN)" />
                  </span>
                )
              },
              {
                id: 'console', label: 'Consola', width: 90,
                render: (h) => (h.consolePort ? <span className="mono">{h.consolePort}</span> : <span className="hint">—</span>)
              },
              {
                id: 'seg', label: 'Seguridad', width: 165,
                render: (h) => {
                  if (h.rbcd.length) {
                    return <span className="badge danger" title="Delegación restringida basada en recursos">RBCD</span>
                  }
                  // En un host deshabilitado el riesgo no desaparece: queda latente.
                  if (h.unconstrained) {
                    return h.enabled
                      ? <span className="badge danger">no restringida</span>
                      : <span className="badge neutral" title="Vuelve a ser explotable si se reactiva la cuenta">no restringida (inerte)</span>
                  }
                  if (h.enabled && h.anyProtocol) return <span className="badge warn">cualquier protocolo</span>
                  if (h.enabled && h.rc4Enabled) return <span className="badge warn">RC4</span>
                  return <span className="badge ok">sin observaciones</span>
                }
              },
              {
                id: 'estado', label: 'Estado', width: 130,
                render: (h) =>
                  !h.enabled ? <span className="badge neutral">fuera de servicio</span>
                    : h.migratesTo.length ? <span className="badge ok">{h.migratesTo.length} destino(s)</span>
                      : <span className="badge neutral">sin delegación</span>,
                sortValue: (h) => (h.enabled ? 1 : 0)
              }
            ]}
          />
        </>
      )
    }

    if (vista === 'invitados') {
      return (
        <>
          <div className="list-head">
            <div className="crumbs">
              <span className="crumb last">Máquinas virtuales</span>
            </div>
          </div>
          <DetailList
            rows={state?.guests ?? []}
            rowKey={(g) => g.dn}
            rowKind={() => 'hvGuest'}
            empty="Ningún equipo publica «CN=Windows Virtual Machine»"
            columns={[
              { id: 'name', label: 'Máquina', width: '18%', render: (g) => g.name, sortValue: (g) => g.name },
              { id: 'dns', label: 'Nombre DNS', width: '25%', render: (g) => g.dnsHostName ?? '—' },
              {
                id: 'os', label: 'Sistema operativo', width: '25%',
                render: (g) => g.operatingSystem ?? '—', sortValue: (g) => g.operatingSystem ?? ''
              },
              {
                id: 'logon', label: 'Último inicio de sesión',
                render: (g) => fmtDate(g.lastLogon), sortValue: (g) => g.lastLogon ?? ''
              },
              {
                id: 'estado', label: 'Estado',
                render: (g) => (g.enabled ? <span className="badge ok">habilitada</span> : <span className="badge danger">deshabilitada</span>)
              }
            ]}
            header={
              <span className="hint">
                Sale del punto de conexión que publican los servicios de integración: son las VM unidas
                al dominio, no el inventario del host. Una VM apagada, sin integración o fuera del
                dominio no aparece acá.
              </span>
            }
          />
        </>
      )
    }

    if (vista === 'clusters') {
      return (
        <>
          <div className="list-head">
            <div className="crumbs"><span className="crumb last">Clústeres de conmutación por error</span></div>
          </div>
          <DetailList
            rows={state?.clusters ?? []}
            rowKey={(c) => c.dn}
            rowKind={() => 'hvCluster'}
            empty="No hay ningún objeto de nombre de clúster (CNO) en el dominio"
            columns={[
              { id: 'name', label: 'Clúster', width: '25%', render: (c) => c.name, sortValue: (c) => c.name },
              { id: 'dns', label: 'Nombre DNS', width: '25%', render: (c) => c.dnsHostName ?? '—' },
              {
                id: 'vco', label: 'Nombres virtuales', width: '25%',
                render: (c) => (c.virtualNames.length ? c.virtualNames.join(', ') : <span className="hint">ninguno</span>)
              },
              { id: 'dn', label: 'Ubicación', render: (c) => <span className="mono">{c.dn}</span> }
            ]}
          />
        </>
      )
    }

    if (vista === 'delegacion') {
      return (
        <>
          <div className="list-head">
            <div className="crumbs"><span className="crumb last">Migración en vivo con Kerberos</span></div>
          </div>
          <div style={{ padding: 16, overflow: 'auto' }}>
            <p className="hint" style={{ margin: '0 0 14px', maxWidth: 780, lineHeight: 1.55 }}>
              La fila es el host que <strong>inicia</strong> la migración y la columna el que la recibe.
              Para que la migración en vivo funcione con Kerberos, la delegación tiene que estar en los
              dos sentidos: si sólo está de un lado, sólo se puede migrar desde ese lado y sólo iniciando
              sesión en él. Doble clic en una fila para editarla.
            </p>

            {hosts.length < 2 ? (
              <div className="hint">Hace falta más de un host para configurar migración en vivo.</div>
            ) : (
              <div className="mini-table-wrap" style={{ maxWidth: 900 }}>
                <table className="mini">
                  <thead>
                    <tr>
                      <th style={{ width: 160 }}>Origen ↓ / Destino →</th>
                      {hosts.map((h) => (
                        <th key={h.dn} style={{ textAlign: 'center', opacity: h.enabled ? 1 : 0.55 }}>
                          {h.name}
                        </th>
                      ))}
                      <th style={{ width: 90 }}>Réplica</th>
                    </tr>
                  </thead>
                  <tbody>
                    {hosts.map((origen) => (
                      <tr
                        key={origen.dn}
                        style={{ cursor: 'pointer' }}
                        onDoubleClick={() => setEditing(origen)}
                      >
                        <td style={{ opacity: origen.enabled ? 1 : 0.55 }}>
                          <strong>{origen.name}</strong>
                          {!origen.enabled && <div className="hint">fuera de servicio</div>}
                          {origen.enabled && origen.unconstrained && (
                            <div className="hint" style={{ color: 'var(--warn)' }}>no restringida</div>
                          )}
                        </td>
                        {hosts.map((destino) => {
                          const puesto = origen.migratesTo.includes(destino.name)
                          return (
                            <td key={destino.dn} style={{ textAlign: 'center' }}>
                              {origen.name === destino.name
                                ? <span className="hint">—</span>
                                : puesto && !destino.enabled
                                  // Delegación viva hacia un host dado de baja: no es un tilde bueno.
                                  ? <span title={`${destino.name} está fuera de servicio: esta delegación sobra`}>
                                      <Check size={14} color="var(--warn)" />
                                    </span>
                                  : <Si on={puesto} />}
                            </td>
                          )
                        })}
                        <td style={{ textAlign: 'center' }}>
                          {origen.replicatesTo.length
                            ? <span className="badge ok">{origen.replicatesTo.length}</span>
                            : <span className="hint">—</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )
    }

    if (vista === 'revision') {
      return (
        <>
          <div className="list-head">
            <div className="crumbs"><span className="crumb last">Revisión del fabric</span></div>
          </div>
          <div style={{ padding: 16, overflow: 'auto' }}>
            <FindingList
              vacio={
                hosts.length
                  ? 'No hay nada para observar: los hosts publican sus servicios y la delegación está pareja.'
                  : 'Todavía no se leyó el directorio, o no hay hosts de Hyper-V en el dominio.'
              }
              findings={issues.map((i): Finding => ({
                id: i.id,
                severity: i.severity,
                subject: i.host,
                label: i.label,
                detail: i.detail,
                action: hosts.some((h) => h.name === i.host)
                  ? {
                      label: `Propiedades de ${i.host}`,
                      run: () => {
                        const h = hosts.find((x) => x.name === i.host)
                        if (h) setDetalle(h)
                      }
                    }
                  : undefined
              }))}
            />
          </div>
        </>
      )
    }

    return (
      <>
        <div className="list-head">
          <div className="crumbs"><span className="crumb last">Administración de máquinas virtuales</span></div>
        </div>
        <div style={{ padding: 20, overflow: 'auto', maxWidth: 860 }}>
          <div className="row" style={{ gap: 10, alignItems: 'flex-start', marginBottom: 16 }}>
            <Info size={20} color="var(--accent)" />
            <div>
              <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 6 }}>
                Encender, apagar y migrar máquinas no es LDAP.
              </div>
              <p style={{ margin: '0 0 12px', fontSize: 13, lineHeight: 1.55, color: 'var(--text-dim)' }}>
                Active Directory guarda el fabric: qué equipos son hosts, en qué puerto escucha
                VMConnect, quién puede migrarle a quién y qué VM están unidas al dominio. El estado de
                las máquinas, su memoria, sus discos, sus conmutadores y sus puntos de control viven en
                el WMI del host, en <span className="mono">root\virtualization\v2</span>. Para llegar
                ahí hace falta otro transporte.
              </p>
            </div>
          </div>

          <div className="mini-table-wrap">
            <table className="mini">
              <thead>
                <tr>
                  <th style={{ width: '24%' }}>Vía</th>
                  <th>Qué implica</th>
                  <th style={{ width: 110 }}>Veredicto</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>WinRM / WS-Man</td>
                  <td>
                    Cliente WS-Man sobre HTTPS contra <span className="mono">root\virtualization\v2</span>,
                    con autenticación Kerberos o NTLM. Los {hosts.length || 'tres'} hosts ya publican el
                    SPN <span className="mono">WSMAN</span>, así que el servicio está prendido. Es la
                    misma pieza que necesita la consola de DHCP.
                  </td>
                  <td>Recomendada</td>
                </tr>
                <tr>
                  <td>PowerShell remoto</td>
                  <td>
                    Igual de transporte, pero serializando objetos de los cmdlets
                    (<span className="mono">Get-VM</span>, <span className="mono">Start-VM</span>). Más
                    simple de arrancar, más frágil de parsear.
                  </td>
                  <td>Plan B</td>
                </tr>
                <tr>
                  <td>MS-DCOM / WMI nativo</td>
                  <td>
                    Lo que usa el Administrador de Hyper-V. DCE/RPC, marshalling NDR y SPNEGO: semanas
                    de trabajo y mucho riesgo de errores sutiles.
                  </td>
                  <td>Descartada</td>
                </tr>
                <tr>
                  <td>libvirt / SSH</td>
                  <td>No aplica: Hyper-V no habla libvirt y los hosts no corren OpenSSH.</td>
                  <td>No aplica</td>
                </tr>
              </tbody>
            </table>
          </div>

          <p style={{ marginTop: 16, fontSize: 13, color: 'var(--text-dim)' }}>
            En este dominio hay <strong>{hosts.length}</strong> host(s) de Hyper-V y{' '}
            <strong>{state?.guests.length ?? 0}</strong> máquina(s) virtual(es) unida(s) al dominio.
            Decidir el transporte es lo único que falta para conectar esta pestaña.
          </p>
        </div>
      </>
    )
  })()

  return (
    <ConsoleShell
      title="ADeep — Hyper-V"
      icon={<Layers size={17} />}
      treeTitle="Hyper-V"
      loading={loading}
      onRefresh={() => void cargar()}
      onSession={onSession}
      menus={{
        Acción: [
          {
            id: 'deleg',
            label: 'Configurar migración en vivo…',
            icon: <KeyRound size={15} />,
            disabled: !hosts.length,
            onSelect: () => setEditing(hosts[0] ?? null)
          },
          { id: 's1', separator: true },
          {
            id: 'revision',
            label: 'Ver la revisión del fabric',
            icon: <ShieldAlert size={15} />,
            onSelect: () => setVista('revision')
          }
        ]
      }}
      toolbar={
        <>
          <span className="hint" style={{ paddingLeft: 4 }}>
            <ServerCog size={13} style={{ verticalAlign: -2 }} /> {hosts.length} host(s)
          </span>
          <span className="hint" style={{ paddingLeft: 12 }}>
            <MonitorPlay size={13} style={{ verticalAlign: -2 }} /> {state?.guests.length ?? 0} VM
          </span>
          {state?.clusters.length ? (
            <span className="hint" style={{ paddingLeft: 12 }}>
              <Boxes size={13} style={{ verticalAlign: -2 }} /> {state.clusters.length} clúster(es)
            </span>
          ) : null}
        </>
      }
      tree={
        <SimpleTree
          items={tree}
          selectedId={vista}
          defaultExpanded={['hyperv']}
          onSelect={(item) => {
            if (item.id !== 'hyperv') setVista(item.id as Vista)
          }}
        />
      }
      main={
        <>
          {main}
          {ctx && (
            <MenuPopup items={ctx.items} x={ctx.x} y={ctx.y} onClose={() => setCtx(null)} />
          )}
          {detalle && (
            <HostDialog
              host={detalle}
              onClose={() => setDetalle(null)}
              onDelegacion={() => { setEditing(detalle); setDetalle(null) }}
            />
          )}
          {editing && (
            <DelegationDialog
              host={editing}
              hosts={hosts}
              onClose={() => setEditing(null)}
              onSaved={() => { setEditing(null); void cargar() }}
            />
          )}
        </>
      }
      status={
        <span className={`seg ${graves ? 'err' : ''}`}>
          {state
            ? `${hosts.length} host(s) · ${state.guests.length} VM · ${issues.length} observación(es)${graves ? `, ${graves} grave(s)` : ''}`
            : 'Sin datos'}
        </span>
      }
    />
  )
}

/**
 * Propiedades del host. La pestaña de seguridad junta todo lo que el directorio
 * dice sobre en quién confía este host: es lo que hay que mirar antes de
 * decidir si una delegación tiene motivo de existir.
 */
function HostDialog({
  host, onClose, onDelegacion
}: {
  host: HyperVHost
  onClose: () => void
  onDelegacion: () => void
}): JSX.Element {
  const [tab, setTab] = useState<'general' | 'seguridad'>('general')

  const riesgos: { grave: boolean; label: string; detail: string }[] = []
  if (host.rbcd.length) {
    riesgos.push({
      grave: host.enabled,
      label: 'Delegación restringida basada en recursos (RBCD)',
      detail:
        `Pueden suplantar usuarios contra este host: ${host.rbcd.map((r) => r.name).join(', ')}. ` +
        'El atributo se escribe desde el propio host, así que no hace falta ser administrador del ' +
        'dominio para ponerlo.'
    })
  }
  if (host.unconstrained) {
    riesgos.push({
      grave: host.enabled,
      label: 'Delegación no restringida',
      detail:
        'Guarda el TGT de todo el que se autentica contra él y puede suplantarlo ante cualquier ' +
        'servicio del dominio.' + (host.enabled ? '' : ' Hoy inerte: la cuenta está deshabilitada.')
    })
  }
  if (host.anyProtocol) {
    riesgos.push({
      grave: false,
      label: 'Delegación con cualquier protocolo',
      detail: 'Transición de protocolo: puede fabricarse un ticket a nombre de cualquier usuario.'
    })
  }
  if (host.rc4Enabled) {
    riesgos.push({
      grave: false,
      label: 'Acepta RC4 para Kerberos',
      detail: `msDS-SupportedEncryptionTypes = ${host.encryptionTypes}. Sólo AES sería 24.`
    })
  }

  return (
    <Modal
      title={host.name}
      subtitle={`${host.operatingSystem ?? 'Host de Hyper-V'} · ${host.dnsHostName ?? host.dn}`}
      icon={<ServerCog size={18} color="var(--accent)" />}
      size="wide"
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onDelegacion}>Configurar migración en vivo…</button>
          <div className="spacer" style={{ flex: 1 }} />
          <button className="btn primary" onClick={onClose}>Cerrar</button>
        </>
      }
    >
      <div className="tabs" style={{ marginBottom: 14 }}>
        <button className={`tab ${tab === 'general' ? 'on' : ''}`} onClick={() => setTab('general')}>General</button>
        <button className={`tab ${tab === 'seguridad' ? 'on' : ''}`} onClick={() => setTab('seguridad')}>
          Seguridad{riesgos.length ? ` (${riesgos.length})` : ''}
        </button>
      </div>

      {tab === 'general' ? (
        <div className="kv">
          <span className="k">Nombre DNS</span>
          <span className="v">{host.dnsHostName ?? '—'}</span>
          <span className="k">Sistema operativo</span>
          <span className="v">{host.operatingSystem ?? '—'} {host.operatingSystemVersion ?? ''}</span>
          <span className="k">Estado de la cuenta</span>
          <span className="v">{host.enabled ? 'Habilitada' : 'Deshabilitada (fuera de servicio)'}</span>
          <span className="k">Puerto de VMConnect</span>
          <span className="v mono">{host.consolePort ?? 'sin punto de conexión'}</span>
          <span className="k">Migración en vivo</span>
          <span className="v">{host.services.migration ? 'SPN publicado' : 'sin SPN'}</span>
          <span className="k">Consola</span>
          <span className="v">{host.services.console ? 'SPN publicado' : 'sin SPN'}</span>
          <span className="k">Réplica</span>
          <span className="v">{host.services.replica ? 'SPN publicado' : 'sin SPN'}</span>
          <span className="k">WinRM</span>
          <span className="v">{host.services.winrm ? 'SPN WSMAN publicado' : 'sin SPN'}</span>
          <span className="k">Migra hacia</span>
          <span className="v">{host.migratesTo.join(', ') || '—'}</span>
          <span className="k">Replica hacia</span>
          <span className="v">{host.replicatesTo.join(', ') || '—'}</span>
          <span className="k">Descripción</span>
          <span className="v">{host.description ?? '—'}</span>
          <span className="k">Último inicio de sesión</span>
          <span className="v">{fmtDate(host.lastLogon)}</span>
          <span className="k">Creado</span>
          <span className="v">{fmtDate(host.created)}</span>
          <span className="k">DN</span>
          <span className="v mono">{host.dn}</span>
        </div>
      ) : (
        <>
          {riesgos.length ? (
            riesgos.map((r) => (
              <div
                key={r.label}
                className="row"
                style={{
                  gap: 10, alignItems: 'flex-start', padding: 12, marginBottom: 8,
                  borderRadius: 'var(--r-sm)',
                  background: r.grave ? 'var(--danger-soft)' : 'var(--warn-soft)'
                }}
              >
                <ShieldAlert size={17} color={r.grave ? 'var(--danger)' : 'var(--warn)'} />
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: 13 }}>{r.label}</div>
                  <div className="hint" style={{ marginTop: 3, lineHeight: 1.5 }}>{r.detail}</div>
                </div>
              </div>
            ))
          ) : (
            <div className="hint" style={{ marginBottom: 14 }}>
              Sin observaciones: delegación restringida o ninguna, sin RBCD y sin cifrados débiles.
            </div>
          )}

          <div className="kv" style={{ marginTop: 14 }}>
            <span className="k">Cifrados Kerberos</span>
            <span className="v">
              {host.encryptionLabels.length
                ? `${host.encryptionLabels.join(', ')} (${host.encryptionTypes})`
                : 'no fijado — usa el valor por defecto del dominio'}
            </span>
            <span className="k">Delegación no restringida</span>
            <span className="v">{host.unconstrained ? 'Sí' : 'No'}</span>
            <span className="k">Cualquier protocolo</span>
            <span className="v">{host.anyProtocol ? 'Sí' : 'No'}</span>
            <span className="k">Puede suplantar contra este host</span>
            <span className="v">{host.rbcd.map((r) => r.name).join(', ') || 'nadie (sin RBCD)'}</span>
            <span className="k">Delegación hacia hosts inexistentes</span>
            <span className="v mono">{host.foreignDelegation.join(', ') || '—'}</span>
          </div>
        </>
      )}
    </Modal>
  )
}

/**
 * Escribe `msDS-AllowedToDelegateTo` del host de origen. Es la misma casilla de
 * «Confiar en este equipo para delegación sólo a los servicios especificados» de
 * ADUC, pero armando la lista de SPN que pide la migración en vivo.
 */
function DelegationDialog({
  host,
  hosts,
  onClose,
  onSaved
}: {
  host: HyperVHost
  hosts: HyperVHost[]
  onClose: () => void
  onSaved: () => void
}): JSX.Element {
  const otros = hosts.filter((h) => h.dn !== host.dn)
  const [targets, setTargets] = useState<Set<string>>(new Set(host.migratesTo))
  const [replica, setReplica] = useState(host.replicatesTo.length > 0)
  const [saving, setSaving] = useState(false)
  const confirm = useConfirm()

  const guardar = async (): Promise<void> => {
    const elegidos = otros.filter((h) => targets.has(h.name))
    if (host.unconstrained) {
      const ok = await confirm({
        title: 'El host tiene delegación no restringida',
        message: `${host.name} está marcado como de confianza para delegación sin restricciones.`,
        detail:
          'Las dos formas de delegación se excluyen: al guardar la delegación restringida se apaga ' +
          'TRUSTED_FOR_DELEGATION, o el controlador de dominio ignora la lista.',
        confirmLabel: 'Guardar y apagarla',
        danger: true
      })
      if (!ok) return
    }
    setSaving(true)
    const res = await window.adeep.hyperv.setDelegation(
      host.dn,
      elegidos.map((h) => ({ name: h.name, dnsHostName: h.dnsHostName })),
      replica
    )
    setSaving(false)
    if (report(res, `Delegación de ${host.name} actualizada`)) onSaved()
  }

  const limpiar = async (): Promise<void> => {
    const ok = await confirm({
      title: 'Quitar toda la delegación',
      message: `${host.name} deja de poder migrar en vivo con Kerberos hacia cualquier host.`,
      confirmLabel: 'Quitar',
      danger: true
    })
    if (!ok) return
    setSaving(true)
    const res = await window.adeep.hyperv.clearDelegation(host.dn)
    setSaving(false)
    if (report(res, `Delegación de ${host.name} borrada`)) onSaved()
  }

  return (
    <Modal
      title={host.name}
      subtitle={`Migración en vivo con Kerberos · ${host.dnsHostName ?? host.dn}`}
      icon={<KeyRound size={18} color="var(--accent)" />}
      size="wide"
      onClose={onClose}
      footer={
        <>
          <button className="btn" disabled={saving} onClick={() => void limpiar()}>
            Quitar toda la delegación
          </button>
          <div className="spacer" style={{ flex: 1 }} />
          <button className="btn" onClick={onClose}>Cancelar</button>
          <button className="btn primary" disabled={saving} onClick={() => void guardar()}>
            Guardar
          </button>
        </>
      }
    >
      <p className="hint" style={{ margin: '0 0 12px', lineHeight: 1.55 }}>
        Destinos a los que <strong>{host.name}</strong> va a poder migrar máquinas en vivo. Se escriben
        los SPN <span className="mono">CIFS</span>, <span className="mono">HOST</span> y{' '}
        <span className="mono">Microsoft Virtual System Migration Service</span> de cada destino, con
        nombre corto y FQDN, igual que lo hace Windows.
      </p>

      {!otros.length ? (
        <div className="hint">No hay otros hosts de Hyper-V en el dominio.</div>
      ) : (
        otros.map((h) => (
          <Check2
            key={h.dn}
            label={h.enabled ? h.name : `${h.name} — fuera de servicio`}
            hint={h.enabled ? h.dnsHostName : `${h.dnsHostName ?? ''} · la cuenta de equipo está deshabilitada`}
            checked={targets.has(h.name)}
            onChange={(v) =>
              setTargets((cur) => {
                const next = new Set(cur)
                if (v) next.add(h.name)
                else next.delete(h.name)
                return next
              })
            }
          />
        ))
      )}

      <div style={{ marginTop: 14, paddingTop: 12, borderTop: '1px solid var(--border)' }}>
        <Check2
          label="Incluir también el servicio de réplica"
          hint="Agrega Hyper-V Replica Service a cada destino elegido."
          checked={replica}
          onChange={setReplica}
        />
      </div>

      {host.unconstrained && (
        <div
          className="row"
          style={{
            gap: 10, alignItems: 'flex-start', padding: 12, marginTop: 14,
            borderRadius: 'var(--r-sm)', background: 'var(--warn-soft)'
          }}
        >
          <ShieldAlert size={17} color="var(--warn)" />
          <div className="hint" style={{ lineHeight: 1.5 }}>
            Hoy el host tiene delegación <strong>no restringida</strong>. Al guardar se apaga, porque
            si no el controlador de dominio ignora esta lista.
          </div>
        </div>
      )}
    </Modal>
  )
}
