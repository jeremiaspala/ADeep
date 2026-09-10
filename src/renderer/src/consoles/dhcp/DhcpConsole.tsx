import { useCallback, useMemo, useState, type JSX } from 'react'
import { Router, ShieldCheck, Info, Server } from 'lucide-react'
import type { DhcpState, SessionInfo } from '@shared/types'
import ConsoleShell from '../../shell/ConsoleShell'
import SimpleTree, { type TreeItem } from '../../shell/SimpleTree'
import DetailList from '../../shell/DetailList'
import { report } from '../../store'

type Vista = 'autorizados' | 'candidatos' | 'alcance'

export default function DhcpConsole(): JSX.Element {
  const [state, setState] = useState<DhcpState | null>(null)
  const [loading, setLoading] = useState(false)
  const [vista, setVista] = useState<Vista>('autorizados')

  const cargar = useCallback(async (): Promise<void> => {
    setLoading(true)
    const res = await window.adeep.dhcp.state()
    setLoading(false)
    const data = report(res)
    if (data) setState(data)
  }, [])

  const onSession = useCallback((_i: SessionInfo) => { void cargar() }, [cargar])

  const tree = useMemo<TreeItem[]>(() => [
    {
      id: 'dhcp',
      label: 'DHCP',
      kind: 'dhcpRoot',
      children: [
        {
          id: 'autorizados',
          label: 'Servidores autorizados',
          kind: 'dhcpServer',
          badge: String(state?.servers.length ?? 0)
        },
        {
          id: 'candidatos',
          label: 'Equipos con el servicio',
          kind: 'computer',
          badge: String(state?.candidates.length ?? 0)
        },
        { id: 'alcance', label: 'Ámbitos y concesiones', kind: 'unknown' }
      ]
    }
  ], [state])

  const main = ((): JSX.Element => {
    if (vista === 'autorizados') {
      return (
        <>
          <div className="list-head">
            <div className="crumbs"><span className="crumb last">Servidores DHCP autorizados en el directorio</span></div>
          </div>
          <DetailList
            rows={state?.servers ?? []}
            rowKey={(s) => `${s.address}|${s.name ?? ''}`}
            rowKind={() => 'dhcpServer'}
            empty="No hay ningún servidor DHCP autorizado en este dominio"
            columns={[
              { id: 'name', label: 'Servidor', width: '40%', render: (s) => s.name ?? '—', sortValue: (s) => s.name ?? '' },
              { id: 'ip', label: 'Dirección IP', render: (s) => <span className="mono">{s.address || '—'}</span> }
            ]}
          />
          <div style={{ padding: 16, borderTop: '1px solid var(--border)' }}>
            <div className="row" style={{ gap: 8, alignItems: 'flex-start', fontSize: 12.5, color: 'var(--text-dim)' }}>
              <ShieldCheck size={16} />
              <span>
                La autorización es lo único de DHCP que vive en Active Directory
                (<span className="mono">{state?.rootDN ?? 'CN=DhcpRoot,CN=NetServices,CN=Services,…'}</span>).
                Un servidor DHCP de Windows que no esté en esta lista no entrega direcciones en un dominio.
              </span>
            </div>
          </div>
        </>
      )
    }

    if (vista === 'candidatos') {
      return (
        <>
          <div className="list-head">
            <div className="crumbs"><span className="crumb last">Equipos que publican el servicio DHCP</span></div>
          </div>
          <DetailList
            rows={state?.candidates ?? []}
            rowKey={(c) => c.dn}
            rowKind={() => 'computer'}
            empty="Ningún equipo del dominio publica el SPN DHCPServer"
            columns={[
              { id: 'name', label: 'Equipo', width: '30%', render: (c) => c.name, sortValue: (c) => c.name },
              { id: 'dns', label: 'Nombre DNS', width: '35%', render: (c) => c.dnsHostName ?? '—' },
              { id: 'dn', label: 'Ubicación', render: (c) => <span className="mono">{c.dn}</span> }
            ]}
          />
        </>
      )
    }

    return (
      <>
        <div className="list-head">
          <div className="crumbs"><span className="crumb last">Ámbitos y concesiones</span></div>
        </div>
        <div style={{ padding: 20, overflow: 'auto', maxWidth: 820 }}>
          <div className="row" style={{ gap: 10, alignItems: 'flex-start', marginBottom: 16 }}>
            <Info size={20} color="var(--accent)" />
            <div>
              <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 6 }}>
                Esta parte todavía no está conectada, y es a propósito.
              </div>
              <p style={{ margin: '0 0 12px', fontSize: 13, lineHeight: 1.55, color: 'var(--text-dim)' }}>
                Los ámbitos, las concesiones, las reservas y las opciones no están en Active
                Directory: viven en la base de datos del propio servidor DHCP. Para leerlas hace
                falta hablar otro protocolo, y cada opción tiene un costo distinto.
              </p>
            </div>
          </div>

          <div className="mini-table-wrap">
            <table className="mini">
              <thead>
                <tr>
                  <th style={{ width: '26%' }}>Vía</th>
                  <th>Qué implica</th>
                  <th style={{ width: 130 }}>Servidor</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>WinRM / PowerShell</td>
                  <td>Cliente WS-Man sobre HTTPS con autenticación NTLM o Kerberos. Es la vía razonable para DHCP de Windows, pero hay que habilitar WinRM en el servidor.</td>
                  <td>Windows</td>
                </tr>
                <tr>
                  <td>MS-DHCPM (RPC nativo)</td>
                  <td>Lo que usa la consola de Windows. Implica DCE/RPC, marshalling NDR y SPNEGO: semanas de trabajo y mucho riesgo de errores sutiles.</td>
                  <td>Windows</td>
                </tr>
                <tr>
                  <td>API REST de Kea</td>
                  <td>JSON sobre HTTP contra el agente de control. Es la más simple de todas.</td>
                  <td>Linux (ISC Kea)</td>
                </tr>
                <tr>
                  <td>SSH + <span className="mono">netsh dhcp</span></td>
                  <td>Requiere OpenSSH en el servidor y parsear texto, que es frágil.</td>
                  <td>Windows</td>
                </tr>
              </tbody>
            </table>
          </div>

          <p style={{ marginTop: 16, fontSize: 13, color: 'var(--text-dim)' }}>
            En este dominio hay <strong>{state?.servers.length ?? 0}</strong> servidor(es) autorizado(s)
            en el directorio y <strong>{state?.candidates.length ?? 0}</strong> equipo(s) publicando el
            servicio, así que probablemente el DHCP no sea de Windows o no esté integrado con el dominio.
            Decime cuál es el caso y conectamos la vía que corresponda.
          </p>
        </div>
      </>
    )
  })()

  return (
    <ConsoleShell
      title="ADeep — DHCP"
      icon={<Router size={17} />}
      treeTitle="DHCP"
      loading={loading}
      onRefresh={() => void cargar()}
      onSession={onSession}
      toolbar={
        <span className="hint" style={{ paddingLeft: 4 }}>
          <Server size={13} style={{ verticalAlign: -2 }} /> {state?.servers.length ?? 0} autorizado(s)
        </span>
      }
      tree={
        <SimpleTree
          items={tree}
          selectedId={vista}
          defaultExpanded={['dhcp']}
          onSelect={(item) => {
            if (item.id === 'autorizados' || item.id === 'candidatos' || item.id === 'alcance') {
              setVista(item.id)
            }
          }}
        />
      }
      main={main}
      status={
        <span className="seg">
          {state
            ? `${state.servers.length} servidor(es) autorizado(s) · ${state.candidates.length} con el servicio publicado`
            : 'Sin datos'}
        </span>
      }
    />
  )
}
