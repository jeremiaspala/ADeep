import { useCallback, useMemo, useState, type JSX } from 'react'
import {
  Network, Plus, Trash2, Server, Globe, Link2, CalendarClock, Zap, RefreshCw, Settings2
} from 'lucide-react'
import type {
  DsaServerInfo, SessionInfo, SiteInfo, SiteLinkInfo, SubnetInfo
} from '@shared/types'
import ConsoleShell from '../../shell/ConsoleShell'
import SimpleTree, { type TreeItem } from '../../shell/SimpleTree'
import DetailList from '../../shell/DetailList'
import ScheduleEditor from '../../shell/ScheduleEditor'
import { MenuPopup, Modal, Field, Text, Check2, PromptDialog, useConfirm, type MenuItemDef } from '../../components/ui'
import { useApp, report } from '../../store'
import { rdnValue } from '../../lib/format'

type Selection =
  | { kind: 'root' }
  | { kind: 'site'; site: SiteInfo }
  | { kind: 'servers'; site: SiteInfo }
  | { kind: 'server'; server: DsaServerInfo }
  | { kind: 'subnets' }
  | { kind: 'transports' }
  | { kind: 'transport'; transport: 'IP' | 'SMTP' }

interface Data {
  sites: SiteInfo[]
  subnets: SubnetInfo[]
  links: SiteLinkInfo[]
  servers: DsaServerInfo[]
}

const EMPTY: Data = { sites: [], subnets: [], links: [], servers: [] }

export default function SitesConsole(): JSX.Element {
  const toast = useApp((s) => s.toast)
  const confirm = useConfirm()

  const [data, setData] = useState<Data>(EMPTY)
  const [loading, setLoading] = useState(false)
  const [selection, setSelection] = useState<Selection>({ kind: 'root' })
  const [selectedId, setSelectedId] = useState('root')
  const [ctx, setCtx] = useState<{ items: MenuItemDef[]; x: number; y: number } | null>(null)
  const [dialog, setDialog] = useState<
    | null
    | { t: 'newSite' }
    | { t: 'newSubnet' }
    | { t: 'newLink' }
    | { t: 'link'; link: SiteLinkInfo }
    | { t: 'schedule'; title: string; initial?: boolean[]; save: (s: boolean[] | null) => void }
    | { t: 'moveServer'; server: DsaServerInfo }
    | { t: 'subnetSite'; subnet: SubnetInfo }
  >(null)

  const load = useCallback(async (): Promise<void> => {
    setLoading(true)
    const [sites, subnets, links, servers] = await Promise.all([
      window.adeep.sites.list(),
      window.adeep.sites.subnets(),
      window.adeep.sites.links(),
      window.adeep.sites.servers()
    ])
    setLoading(false)
    if (!sites.ok) { report(sites); return }
    setData({
      sites: sites.data ?? [],
      subnets: subnets.data ?? [],
      links: links.data ?? [],
      servers: servers.data ?? []
    })
  }, [])

  const onSession = useCallback((_info: SessionInfo) => { void load() }, [load])

  const tree = useMemo<TreeItem[]>(() => [
    {
      id: 'root',
      label: 'Sitios',
      kind: 'sitesRoot',
      badge: String(data.sites.length),
      children: [
        ...data.sites.map((site) => ({
          id: site.dn,
          label: site.name,
          kind: 'site' as const,
          badge: `${site.servers}`,
          children: [
            {
              id: `${site.dn}::servers`,
              label: 'Servers',
              kind: 'serversRoot' as const,
              badge: String(site.servers),
              children: data.servers
                .filter((s) => s.siteDN.toLowerCase() === site.dn.toLowerCase())
                .map((s) => ({
                  id: s.dn,
                  label: s.name,
                  kind: 'server' as const,
                  badge: [s.isGC ? 'GC' : '', s.isISTG ? 'ISTG' : ''].filter(Boolean).join(' ')
                }))
            }
          ]
        })),
        { id: 'subnets', label: 'Subnets', kind: 'subnetsRoot', badge: String(data.subnets.length) },
        {
          id: 'transports',
          label: 'Inter-Site Transports',
          kind: 'transportsRoot',
          children: [
            { id: 'transport:IP', label: 'IP', kind: 'transport', badge: String(data.links.filter((l) => l.transport === 'IP').length) },
            { id: 'transport:SMTP', label: 'SMTP', kind: 'transport', badge: String(data.links.filter((l) => l.transport === 'SMTP').length) }
          ]
        }
      ]
    }
  ], [data])

  const onSelect = (item: TreeItem): void => {
    setSelectedId(item.id)
    if (item.id === 'root') return setSelection({ kind: 'root' })
    if (item.id === 'subnets') return setSelection({ kind: 'subnets' })
    if (item.id === 'transports') return setSelection({ kind: 'transports' })
    if (item.id.startsWith('transport:')) {
      return setSelection({ kind: 'transport', transport: item.id.endsWith('SMTP') ? 'SMTP' : 'IP' })
    }
    if (item.id.endsWith('::servers')) {
      const site = data.sites.find((s) => s.dn === item.id.replace('::servers', ''))
      if (site) return setSelection({ kind: 'servers', site })
    }
    const site = data.sites.find((s) => s.dn === item.id)
    if (site) return setSelection({ kind: 'site', site })
    const server = data.servers.find((s) => s.dn === item.id)
    if (server) return setSelection({ kind: 'server', server })
  }

  /* ---------------- Acciones ---------------- */

  const setGC = async (server: DsaServerInfo, enabled: boolean): Promise<void> => {
    if (!server.ntdsDN) { toast('warn', 'El servidor no tiene NTDS Settings.'); return }
    const res = await window.adeep.sites.setGlobalCatalog(server.ntdsDN, enabled)
    if (report(res, enabled ? 'Catálogo global activado' : 'Catálogo global desactivado') !== undefined) {
      await load()
    }
  }

  const deleteSite = async (site: SiteInfo): Promise<void> => {
    const ok = await confirm({
      title: 'Eliminar sitio',
      message: `¿Eliminar el sitio "${site.name}"?`,
      detail: site.servers
        ? `Tiene ${site.servers} servidor(es) dentro. Se borra el subárbol completo.`
        : 'Se borra el subárbol completo (NTDS Site Settings y Servers).',
      danger: true,
      confirmLabel: 'Eliminar'
    })
    if (!ok) return
    if (report(await window.adeep.sites.delete(site.dn), 'Sitio eliminado') !== undefined) await load()
  }

  const replicateNow = async (server: DsaServerInfo): Promise<void> => {
    const ok = await confirm({
      title: 'Forzar replicación',
      message: `Pedir a ${server.name} que replique el contexto del dominio.`,
      detail:
        'ADeep escribe replicateSingleObject en el rootDSE. Es una sincronización puntual, ' +
        'no equivale al "Replicar ahora" completo de la consola de Windows, que usa DRSUAPI.',
      confirmLabel: 'Replicar'
    })
    if (!ok) return
    const res = await window.adeep.sites.rootDseOperation('doGarbageCollection', '1')
    report(res, 'Solicitud enviada al controlador de dominio')
  }

  /* ---------------- Menús contextuales ---------------- */

  const siteMenu = (site: SiteInfo): MenuItemDef[] => [
    { id: 'newsubnet', label: 'Nueva subred…', icon: <Globe size={15} />, onSelect: () => setDialog({ t: 'newSubnet' }) },
    { id: 's1', separator: true },
    {
      id: 'kcc-intra',
      label: 'Generación automática de topología intra-sitio',
      checked: (site.settingsOptions & 0x1) === 0,
      onSelect: () => void (async () => {
        const res = await window.adeep.sites.setKcc(
          site.dn, (site.settingsOptions & 0x1) === 0, (site.settingsOptions & 0x10) !== 0
        )
        if (report(res, 'KCC actualizado') !== undefined) await load()
      })()
    },
    {
      id: 'kcc-inter',
      label: 'Generación automática de topología inter-sitios',
      checked: (site.settingsOptions & 0x10) === 0,
      onSelect: () => void (async () => {
        const res = await window.adeep.sites.setKcc(
          site.dn, (site.settingsOptions & 0x1) !== 0, (site.settingsOptions & 0x10) === 0
        )
        if (report(res, 'KCC actualizado') !== undefined) await load()
      })()
    },
    { id: 's2', separator: true },
    { id: 'del', label: 'Eliminar', icon: <Trash2 size={15} />, danger: true, onSelect: () => void deleteSite(site) }
  ]

  const serverMenu = (server: DsaServerInfo): MenuItemDef[] => [
    {
      id: 'gc', label: 'Catálogo global', checked: server.isGC,
      onSelect: () => void setGC(server, !server.isGC)
    },
    { id: 'move', label: 'Mover a otro sitio…', onSelect: () => setDialog({ t: 'moveServer', server }) },
    { id: 's1', separator: true },
    { id: 'repl', label: 'Forzar replicación…', icon: <Zap size={15} />, onSelect: () => void replicateNow(server) }
  ]

  /* ---------------- Panel derecho ---------------- */

  const main = ((): JSX.Element => {
    switch (selection.kind) {
      case 'root':
        return (
          <DetailList
            rows={data.sites}
            rowKey={(s) => s.dn}
            rowKind={() => 'site'}
            onOpen={(s) => { setSelection({ kind: 'site', site: s }); setSelectedId(s.dn) }}
            onContextMenu={(s, x, y) => setCtx({ items: siteMenu(s), x, y })}
            empty="No hay sitios"
            columns={[
              { id: 'name', label: 'Sitio', width: '30%', render: (s) => s.name, sortValue: (s) => s.name },
              { id: 'servers', label: 'Servidores', width: 110, render: (s) => s.servers, sortValue: (s) => s.servers },
              { id: 'subnets', label: 'Subredes', width: '25%', render: (s) => s.subnets.join(', ') || '—' },
              { id: 'istg', label: 'ISTG', width: 140, render: (s) => (s.istg ? rdnValue(s.istg.split(',').slice(1).join(',')) : '—') },
              { id: 'desc', label: 'Descripción', render: (s) => s.description ?? '' }
            ]}
          />
        )

      case 'site':
      case 'servers': {
        const site = selection.site
        const servers = data.servers.filter((s) => s.siteDN.toLowerCase() === site.dn.toLowerCase())
        return (
          <DetailList
            rows={servers}
            rowKey={(s) => s.dn}
            rowKind={() => 'server'}
            onOpen={(s) => { setSelection({ kind: 'server', server: s }); setSelectedId(s.dn) }}
            onContextMenu={(s, x, y) => setCtx({ items: serverMenu(s), x, y })}
            empty="El sitio no tiene servidores"
            columns={[
              { id: 'name', label: 'Servidor', width: '22%', render: (s) => s.name, sortValue: (s) => s.name },
              { id: 'dns', label: 'Nombre DNS', width: '28%', render: (s) => s.dnsHostName ?? '—' },
              {
                id: 'gc', label: 'Catálogo global', width: 130,
                render: (s) => (s.isGC ? <span className="badge ok">Sí</span> : 'No'),
                sortValue: (s) => (s.isGC ? 1 : 0)
              },
              { id: 'istg', label: 'ISTG', width: 90, render: (s) => (s.isISTG ? <span className="badge accent">Sí</span> : '') },
              { id: 'conn', label: 'Conexiones', width: 110, render: (s) => s.connections.length, sortValue: (s) => s.connections.length }
            ]}
          />
        )
      }

      case 'server': {
        const server = selection.server
        return (
          <>
            <div className="list-head">
              <div className="crumbs">
                <span className="crumb">{server.siteName}</span>
                <span className="sepr">›</span>
                <span className="crumb last">{server.name}</span>
              </div>
            </div>
            <div style={{ padding: 16, overflow: 'auto' }}>
              <div className="kv" style={{ marginBottom: 16 }}>
                <span className="k">Nombre DNS</span>
                <span className="v">{server.dnsHostName ?? '—'}</span>
                <span className="k">Sitio</span>
                <span className="v">{server.siteName}</span>
                <span className="k">Catálogo global</span>
                <span className="v">{server.isGC ? 'Sí' : 'No'}</span>
                <span className="k">Generador de topología (ISTG)</span>
                <span className="v">{server.isISTG ? 'Sí' : 'No'}</span>
                <span className="k">Cuenta de equipo</span>
                <span className="v mono">{server.serverReference ?? '—'}</span>
                <span className="k">NTDS Settings</span>
                <span className="v mono">{server.ntdsDN ?? '—'}</span>
              </div>

              <div className="lbl" style={{ marginBottom: 6 }}>Conexiones entrantes</div>
              <div className="mini-table-wrap">
                <table className="mini">
                  <thead>
                    <tr>
                      <th style={{ width: '30%' }}>Replica desde</th>
                      <th style={{ width: 120 }}>Origen</th>
                      <th style={{ width: 110 }}>Estado</th>
                      <th style={{ width: 130 }}>Programación</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {server.connections.map((c) => (
                      <tr key={c.dn}>
                        <td>{c.fromServerName}</td>
                        <td>{c.generatedByKcc ? 'KCC' : 'Manual'}</td>
                        <td>
                          {c.enabled
                            ? <span className="badge ok">Habilitada</span>
                            : <span className="badge warn">Deshabilitada</span>}
                        </td>
                        <td>{c.schedule ? `${c.schedule.filter(Boolean).length} h/semana` : 'Siempre'}</td>
                        <td style={{ textAlign: 'right' }}>
                          <button
                            className="btn sm ghost"
                            onClick={() => setDialog({
                              t: 'schedule',
                              title: `Programación — ${c.fromServerName} → ${server.name}`,
                              initial: c.schedule,
                              save: async (s) => {
                                setDialog(null)
                                toast('info', 'La programación de conexiones se edita desde el vínculo del sitio.')
                                void s
                              }
                            })}
                          >
                            <CalendarClock size={13} />
                          </button>
                          <button
                            className="btn sm ghost"
                            onClick={() => void (async () => {
                              const res = await window.adeep.sites.setConnectionEnabled(c.dn, !c.enabled)
                              if (report(res, 'Conexión actualizada') !== undefined) await load()
                            })()}
                          >
                            {c.enabled ? 'Deshabilitar' : 'Habilitar'}
                          </button>
                        </td>
                      </tr>
                    ))}
                    {!server.connections.length && (
                      <tr><td colSpan={5} className="hint">Sin conexiones entrantes.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )
      }

      case 'subnets':
        return (
          <DetailList
            rows={data.subnets}
            rowKey={(s) => s.dn}
            rowKind={() => 'subnet'}
            onContextMenu={(s, x, y) => setCtx({
              items: [
                { id: 'site', label: 'Cambiar de sitio…', onSelect: () => setDialog({ t: 'subnetSite', subnet: s }) }
              ], x, y
            })}
            empty="No hay subredes definidas"
            columns={[
              { id: 'name', label: 'Subred', width: '25%', render: (s) => s.name, sortValue: (s) => s.name },
              { id: 'site', label: 'Sitio', width: '25%', render: (s) => s.siteName ?? <span className="badge warn">Sin sitio</span>, sortValue: (s) => s.siteName ?? '' },
              { id: 'loc', label: 'Ubicación', width: '20%', render: (s) => s.location ?? '' },
              { id: 'desc', label: 'Descripción', render: (s) => s.description ?? '' }
            ]}
          />
        )

      case 'transports':
      case 'transport': {
        const links = selection.kind === 'transport'
          ? data.links.filter((l) => l.transport === selection.transport)
          : data.links
        return (
          <DetailList
            rows={links}
            rowKey={(l) => l.dn}
            rowKind={() => 'siteLink'}
            onOpen={(l) => setDialog({ t: 'link', link: l })}
            onContextMenu={(l, x, y) => setCtx({
              items: [
                { id: 'props', label: 'Propiedades…', icon: <Settings2 size={15} />, onSelect: () => setDialog({ t: 'link', link: l }) },
                {
                  id: 'sched', label: 'Programación…', icon: <CalendarClock size={15} />,
                  onSelect: () => setDialog({
                    t: 'schedule',
                    title: `Programación — ${l.name}`,
                    initial: l.schedule,
                    save: async (s) => {
                      const res = await window.adeep.sites.updateLink(l.dn, { schedule: s })
                      setDialog(null)
                      if (report(res, 'Programación guardada') !== undefined) await load()
                    }
                  })
                }
              ], x, y
            })}
            empty="No hay vínculos de sitio"
            columns={[
              { id: 'name', label: 'Vínculo', width: '25%', render: (l) => l.name, sortValue: (l) => l.name },
              { id: 'transport', label: 'Transporte', width: 110, render: (l) => l.transport },
              { id: 'cost', label: 'Coste', width: 90, render: (l) => l.cost, sortValue: (l) => l.cost },
              { id: 'interval', label: 'Intervalo', width: 120, render: (l) => `${l.replInterval} min`, sortValue: (l) => l.replInterval },
              { id: 'sites', label: 'Sitios', render: (l) => l.siteNames.join(', ') },
              { id: 'notify', label: 'Notificación', width: 120, render: (l) => (l.notify ? 'Sí' : 'No') }
            ]}
          />
        )
      }
    }
  })()

  const statusText = ((): string => {
    switch (selection.kind) {
      case 'root': return `${data.sites.length} sitio(s), ${data.servers.length} servidor(es)`
      case 'subnets': return `${data.subnets.length} subred(es)`
      case 'transport': return `${data.links.filter((l) => l.transport === selection.transport).length} vínculo(s)`
      case 'server': return `${selection.server.connections.length} conexión(es) entrantes`
      default: return 'Listo'
    }
  })()

  return (
    <>
      <ConsoleShell
        title="ADeep — Sitios y servicios de Active Directory"
        icon={<Network size={17} />}
        treeTitle="Sitios y servicios"
        loading={loading}
        onRefresh={() => void load()}
        onSession={onSession}
        menus={{
          Acción: [
            { id: 'newsite', label: 'Nuevo sitio…', icon: <Plus size={15} />, onSelect: () => setDialog({ t: 'newSite' }) },
            { id: 'newsubnet', label: 'Nueva subred…', icon: <Globe size={15} />, onSelect: () => setDialog({ t: 'newSubnet' }) },
            { id: 'newlink', label: 'Nuevo vínculo de sitios…', icon: <Link2 size={15} />, onSelect: () => setDialog({ t: 'newLink' }) },
            { id: 's1', separator: true },
            {
              id: 'kccnow', label: 'Comprobar la topología ahora (KCC)', icon: <RefreshCw size={15} />,
              onSelect: () => void (async () => {
                const res = await window.adeep.sites.rootDseOperation('recalcHierarchy', '1')
                report(res, 'Solicitud enviada')
              })()
            },
            {
              id: 'gc', label: 'Recolección de basura del DC', icon: <Zap size={15} />,
              onSelect: () => void (async () => {
                const res = await window.adeep.sites.rootDseOperation('doGarbageCollection', '1')
                report(res, 'Solicitud enviada')
              })()
            }
          ]
        }}
        toolbar={
          <>
            <button className="tool" title="Nuevo sitio" onClick={() => setDialog({ t: 'newSite' })}>
              <Plus size={16} />
            </button>
            <button className="tool" title="Nueva subred" onClick={() => setDialog({ t: 'newSubnet' })}>
              <Globe size={16} />
            </button>
            <button className="tool" title="Nuevo vínculo" onClick={() => setDialog({ t: 'newLink' })}>
              <Link2 size={16} />
            </button>
            <span className="vsep" />
            <span className="hint" style={{ paddingLeft: 4 }}>
              <Server size={13} style={{ verticalAlign: -2 }} /> {data.servers.length} DC
            </span>
          </>
        }
        tree={
          <SimpleTree
            items={tree}
            selectedId={selectedId}
            onSelect={onSelect}
            defaultExpanded={['root', ...data.sites.map((s) => s.dn), 'transports']}
            onContextMenu={(item, x, y) => {
              const site = data.sites.find((s) => s.dn === item.id)
              if (site) return setCtx({ items: siteMenu(site), x, y })
              const server = data.servers.find((s) => s.dn === item.id)
              if (server) return setCtx({ items: serverMenu(server), x, y })
            }}
          />
        }
        main={main}
        status={<span className="seg">{statusText}</span>}
      />

      {ctx && <MenuPopup items={ctx.items} x={ctx.x} y={ctx.y} onClose={() => setCtx(null)} />}

      {dialog?.t === 'newSite' && (
        <PromptDialog
          title="Nuevo sitio"
          label="Nombre del sitio"
          placeholder="Sucursal-Rosario"
          validate={(v) => (/[,\\/+<>;"=\s]/.test(v) ? 'Sin espacios ni , \\ / + < > ; " =' : undefined)}
          onCancel={() => setDialog(null)}
          onConfirm={(name) => void (async () => {
            setDialog(null)
            const res = await window.adeep.sites.create(name)
            if (report(res, 'Sitio creado') !== undefined) await load()
          })()}
        />
      )}

      {dialog?.t === 'newSubnet' && (
        <NewSubnetDialog
          sites={data.sites}
          onClose={() => setDialog(null)}
          onCreated={() => { setDialog(null); void load() }}
        />
      )}

      {dialog?.t === 'newLink' && (
        <NewLinkDialog
          sites={data.sites}
          onClose={() => setDialog(null)}
          onCreated={() => { setDialog(null); void load() }}
        />
      )}

      {dialog?.t === 'link' && (
        <LinkDialog
          link={dialog.link}
          sites={data.sites}
          onClose={() => setDialog(null)}
          onSaved={() => { setDialog(null); void load() }}
          onSchedule={() => setDialog({
            t: 'schedule',
            title: `Programación — ${dialog.link.name}`,
            initial: dialog.link.schedule,
            save: async (s) => {
              const res = await window.adeep.sites.updateLink(dialog.link.dn, { schedule: s })
              setDialog(null)
              if (report(res, 'Programación guardada') !== undefined) await load()
            }
          })}
        />
      )}

      {dialog?.t === 'schedule' && (
        <ScheduleEditor
          title={dialog.title}
          initial={dialog.initial}
          onCancel={() => setDialog(null)}
          onSave={dialog.save}
        />
      )}

      {dialog?.t === 'moveServer' && (
        <MoveServerDialog
          server={dialog.server}
          sites={data.sites}
          onClose={() => setDialog(null)}
          onMoved={() => { setDialog(null); void load() }}
        />
      )}

      {dialog?.t === 'subnetSite' && (
        <SubnetSiteDialog
          subnet={dialog.subnet}
          sites={data.sites}
          onClose={() => setDialog(null)}
          onSaved={() => { setDialog(null); void load() }}
        />
      )}
    </>
  )
}

/* ---------------- Diálogos ---------------- */

function NewSubnetDialog({
  sites, onClose, onCreated
}: {
  sites: SiteInfo[]
  onClose: () => void
  onCreated: () => void
}): JSX.Element {
  const [cidr, setCidr] = useState('')
  const [siteDN, setSiteDN] = useState(sites[0]?.dn ?? '')
  const [location, setLocation] = useState('')
  const [description, setDescription] = useState('')
  const [error, setError] = useState<string>()
  const [busy, setBusy] = useState(false)

  const check = async (value: string): Promise<void> => {
    setCidr(value)
    if (!value.trim()) { setError(undefined); return }
    const res = await window.adeep.sites.validateSubnet(value)
    setError(res.ok ? (res.data ?? undefined) : undefined)
  }

  const create = async (): Promise<void> => {
    setBusy(true)
    const res = await window.adeep.sites.createSubnet(cidr.trim(), siteDN, location.trim() || undefined, description.trim() || undefined)
    setBusy(false)
    if (report(res, 'Subred creada') !== undefined) onCreated()
  }

  return (
    <Modal
      title="Nueva subred"
      icon={<Globe size={18} color="var(--accent)" />}
      onClose={onClose}
      footer={
        <>
          <div className="spacer" style={{ flex: 1 }} />
          <button className="btn" onClick={onClose}>Cancelar</button>
          <button className="btn primary" disabled={!cidr.trim() || !!error || busy} onClick={() => void create()}>
            Crear
          </button>
        </>
      }
    >
      <div className="col" style={{ gap: 10 }}>
        <Text
          label="Prefijo"
          value={cidr}
          onChange={(v) => void check(v)}
          placeholder="10.20.0.0/24"
          error={error}
          hint="IPv4 o IPv6 en notación CIDR. Debe ser la dirección de red."
          autoFocus
        />
        <Field label="Sitio">
          <select value={siteDN} onChange={(e) => setSiteDN(e.target.value)}>
            {sites.map((s) => <option key={s.dn} value={s.dn}>{s.name}</option>)}
          </select>
        </Field>
        <Text label="Ubicación" value={location} onChange={setLocation} />
        <Text label="Descripción" value={description} onChange={setDescription} />
      </div>
    </Modal>
  )
}

function NewLinkDialog({
  sites, onClose, onCreated
}: {
  sites: SiteInfo[]
  onClose: () => void
  onCreated: () => void
}): JSX.Element {
  const [name, setName] = useState('')
  const [selected, setSelected] = useState<string[]>(sites.slice(0, 2).map((s) => s.dn))
  const [cost, setCost] = useState(100)
  const [interval, setInterval] = useState(180)
  const [transport, setTransport] = useState<'IP' | 'SMTP'>('IP')
  const [busy, setBusy] = useState(false)

  const toggle = (dn: string): void =>
    setSelected((cur) => (cur.includes(dn) ? cur.filter((d) => d !== dn) : [...cur, dn]))

  const create = async (): Promise<void> => {
    setBusy(true)
    const res = await window.adeep.sites.createLink(name.trim(), selected, cost, interval, transport)
    setBusy(false)
    if (report(res, 'Vínculo creado') !== undefined) onCreated()
  }

  return (
    <Modal
      title="Nuevo vínculo de sitios"
      icon={<Link2 size={18} color="var(--accent)" />}
      onClose={onClose}
      footer={
        <>
          <span className="hint" style={{ marginRight: 'auto' }}>
            {selected.length < 2 ? 'Elegí al menos dos sitios' : `${selected.length} sitios`}
          </span>
          <button className="btn" onClick={onClose}>Cancelar</button>
          <button className="btn primary" disabled={!name.trim() || selected.length < 2 || busy} onClick={() => void create()}>
            Crear
          </button>
        </>
      }
    >
      <div className="col" style={{ gap: 10 }}>
        <Text label="Nombre" value={name} onChange={setName} autoFocus />
        <div className="grid-3">
          <Field label="Transporte">
            <select value={transport} onChange={(e) => setTransport(e.target.value as 'IP' | 'SMTP')}>
              <option value="IP">IP</option>
              <option value="SMTP">SMTP</option>
            </select>
          </Field>
          <Field label="Coste">
            <input type="number" min={1} max={32767} value={cost} onChange={(e) => setCost(Number(e.target.value) || 100)} />
          </Field>
          <Field label="Intervalo (min)" hint="Múltiplo de 15">
            <input type="number" min={15} max={10080} step={15} value={interval} onChange={(e) => setInterval(Number(e.target.value) || 180)} />
          </Field>
        </div>
        <div className="lbl">Sitios del vínculo</div>
        <div className="mini-table-wrap" style={{ maxHeight: 200, overflow: 'auto' }}>
          <table className="mini">
            <tbody>
              {sites.map((s) => (
                <tr key={s.dn} className={selected.includes(s.dn) ? 'sel' : ''} onClick={() => toggle(s.dn)}>
                  <td>{s.name}</td>
                  <td style={{ width: 80, textAlign: 'right' }}>{selected.includes(s.dn) ? '✓' : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </Modal>
  )
}

function LinkDialog({
  link, sites, onClose, onSaved, onSchedule
}: {
  link: SiteLinkInfo
  sites: SiteInfo[]
  onClose: () => void
  onSaved: () => void
  onSchedule: () => void
}): JSX.Element {
  const [cost, setCost] = useState(link.cost)
  const [interval, setInterval] = useState(link.replInterval)
  const [notify, setNotify] = useState(link.notify)
  const [noCompression, setNoCompression] = useState(link.noCompression)
  const [selected, setSelected] = useState<string[]>(link.sites)
  const [description, setDescription] = useState(link.description ?? '')
  const [busy, setBusy] = useState(false)

  const save = async (): Promise<void> => {
    setBusy(true)
    const res = await window.adeep.sites.updateLink(link.dn, {
      cost, replInterval: interval, notify, noCompression, siteDNs: selected, description
    })
    setBusy(false)
    if (report(res, 'Vínculo actualizado') !== undefined) onSaved()
  }

  const toggle = (dn: string): void =>
    setSelected((cur) => (cur.includes(dn) ? cur.filter((d) => d !== dn) : [...cur, dn]))

  return (
    <Modal
      title={link.name}
      subtitle={`Vínculo de sitios (${link.transport})`}
      icon={<Link2 size={18} color="var(--accent)" />}
      onClose={onClose}
      footer={
        <>
          <button className="btn ghost" onClick={onSchedule}>
            <CalendarClock size={15} /> Programación
          </button>
          <div className="spacer" style={{ flex: 1 }} />
          <button className="btn" onClick={onClose}>Cancelar</button>
          <button className="btn primary" disabled={busy || selected.length < 2} onClick={() => void save()}>
            Guardar
          </button>
        </>
      }
    >
      <div className="col" style={{ gap: 10 }}>
        <div className="grid-2">
          <Field label="Coste">
            <input type="number" min={1} max={32767} value={cost} onChange={(e) => setCost(Number(e.target.value) || 1)} />
          </Field>
          <Field label="Replicar cada (min)">
            <input type="number" min={15} max={10080} step={15} value={interval} onChange={(e) => setInterval(Number(e.target.value) || 15)} />
          </Field>
        </div>
        <Text label="Descripción" value={description} onChange={setDescription} />
        <Check2
          label="Replicar con notificación de cambios"
          checked={notify}
          onChange={setNotify}
          hint="Reduce la latencia entre sitios bien conectados."
        />
        <Check2 label="Deshabilitar la compresión" checked={noCompression} onChange={setNoCompression} />
        <div className="lbl">Sitios del vínculo</div>
        <div className="mini-table-wrap" style={{ maxHeight: 180, overflow: 'auto' }}>
          <table className="mini">
            <tbody>
              {sites.map((s) => (
                <tr key={s.dn} className={selected.includes(s.dn) ? 'sel' : ''} onClick={() => toggle(s.dn)}>
                  <td>{s.name}</td>
                  <td style={{ width: 60, textAlign: 'right' }}>{selected.includes(s.dn) ? '✓' : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </Modal>
  )
}

function MoveServerDialog({
  server, sites, onClose, onMoved
}: {
  server: DsaServerInfo
  sites: SiteInfo[]
  onClose: () => void
  onMoved: () => void
}): JSX.Element {
  const [siteDN, setSiteDN] = useState(sites.find((s) => s.dn !== server.siteDN)?.dn ?? '')
  const [busy, setBusy] = useState(false)

  const move = async (): Promise<void> => {
    setBusy(true)
    const res = await window.adeep.sites.moveServer(server.dn, siteDN)
    setBusy(false)
    if (report(res, 'Servidor movido') !== undefined) onMoved()
  }

  return (
    <Modal
      title={`Mover ${server.name}`}
      subtitle={`Sitio actual: ${server.siteName}`}
      icon={<Server size={18} color="var(--accent)" />}
      onClose={onClose}
      footer={
        <>
          <div className="spacer" style={{ flex: 1 }} />
          <button className="btn" onClick={onClose}>Cancelar</button>
          <button className="btn primary" disabled={!siteDN || busy} onClick={() => void move()}>Mover</button>
        </>
      }
    >
      <Field label="Sitio de destino">
        <select value={siteDN} onChange={(e) => setSiteDN(e.target.value)}>
          {sites.filter((s) => s.dn !== server.siteDN).map((s) => (
            <option key={s.dn} value={s.dn}>{s.name}</option>
          ))}
        </select>
      </Field>
      <div className="hint" style={{ marginTop: 10 }}>
        El KCC recalculará la topología de replicación después del movimiento.
      </div>
    </Modal>
  )
}

function SubnetSiteDialog({
  subnet, sites, onClose, onSaved
}: {
  subnet: SubnetInfo
  sites: SiteInfo[]
  onClose: () => void
  onSaved: () => void
}): JSX.Element {
  const [siteDN, setSiteDN] = useState(subnet.siteDN ?? sites[0]?.dn ?? '')
  const [busy, setBusy] = useState(false)

  const save = async (): Promise<void> => {
    setBusy(true)
    const res = await window.adeep.sites.setSubnetSite(subnet.dn, siteDN || null)
    setBusy(false)
    if (report(res, 'Subred actualizada') !== undefined) onSaved()
  }

  return (
    <Modal
      title={subnet.name}
      subtitle="Sitio asociado"
      icon={<Globe size={18} color="var(--accent)" />}
      onClose={onClose}
      footer={
        <>
          <div className="spacer" style={{ flex: 1 }} />
          <button className="btn" onClick={onClose}>Cancelar</button>
          <button className="btn primary" disabled={busy} onClick={() => void save()}>Guardar</button>
        </>
      }
    >
      <Field label="Sitio">
        <select value={siteDN} onChange={(e) => setSiteDN(e.target.value)}>
          <option value="">(sin sitio)</option>
          {sites.map((s) => <option key={s.dn} value={s.dn}>{s.name}</option>)}
        </select>
      </Field>
    </Modal>
  )
}
