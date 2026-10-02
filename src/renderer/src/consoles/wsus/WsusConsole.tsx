import { useCallback, useEffect, useRef, useState, type JSX } from 'react'
import { CloudDownload, Plus, Plug, RefreshCw, Trash2, FolderPlus, Lock, Unlock } from 'lucide-react'
import type {
  SessionInfo, WsusComputer, WsusGroup, WsusOverview, WsusServerConfig, WsusUpdate
} from '@shared/types'
import ConsoleShell from '../../shell/ConsoleShell'
import SimpleTree, { type TreeItem } from '../../shell/SimpleTree'
import { MenuPopup, PromptDialog, useConfirm, type MenuItemDef } from '../../components/ui'
import { report } from '../../store'
import UpdatesView, { type UpdatePreset } from './UpdatesView'
import ComputersView from './ComputersView'
import OptionsView from './OptionsView'
import { DownstreamView, OverviewView, ReportsView, ReviewView, SyncView, reviewFindings } from './ServerViews'
import { GROUP_ALL, GROUP_UNASSIGNED, ServerDialog, groupLabel } from './common'

interface ServerData {
  overview: WsusOverview | null
  updates: WsusUpdate[] | null
  computers: WsusComputer[] | null
  groups: WsusGroup[]
  error?: string
  loading: Set<'overview' | 'updates' | 'computers'>
}

const EMPTY: ServerData = { overview: null, updates: null, computers: null, groups: [], loading: new Set() }

/** Ids del árbol: `<servidor>|<vista>[|<detalle>]`. */
function parseVista(id: string): { sid: string; kind: string; arg?: string } {
  const [sid, kind = 'overview', arg] = id.split('|')
  return { sid, kind, arg }
}

export default function WsusConsole(): JSX.Element {
  const [servers, setServers] = useState<WsusServerConfig[]>([])
  const [loaded, setLoaded] = useState(false)
  const [vista, setVista] = useState<string>('')
  const [data, setData] = useState<Record<string, ServerData>>({})
  const [ctx, setCtx] = useState<{ items: MenuItemDef[]; x: number; y: number } | null>(null)
  const [dialog, setDialog] = useState<{ t: 'server'; server?: WsusServerConfig } | { t: 'group'; sid: string; parentId: string } | null>(null)
  const confirm = useConfirm()
  // Evita pedidos duplicados mientras otro del mismo tipo está en vuelo.
  const inflight = useRef(new Set<string>())

  const patch = useCallback((sid: string, fn: (d: ServerData) => Partial<ServerData>): void => {
    setData((cur) => {
      const d = cur[sid] ?? { ...EMPTY, loading: new Set() }
      return { ...cur, [sid]: { ...d, ...fn(d) } }
    })
  }, [])

  const load = useCallback(async (sid: string, what: 'overview' | 'updates' | 'computers'): Promise<void> => {
    const key = `${sid}:${what}`
    if (inflight.current.has(key)) return
    inflight.current.add(key)
    patch(sid, (d) => ({ loading: new Set([...d.loading, what]) }))
    const res = what === 'overview' ? await window.adeep.wsus.overview(sid)
      : what === 'updates' ? await window.adeep.wsus.updates(sid)
        : await window.adeep.wsus.computers(sid)
    inflight.current.delete(key)
    patch(sid, (d) => {
      const loading = new Set(d.loading)
      loading.delete(what)
      if (!res.ok) return { loading, error: res.error }
      if (what === 'overview') return { loading, overview: res.data as WsusOverview, error: undefined }
      if (what === 'updates') return { loading, updates: res.data as WsusUpdate[] }
      const c = res.data as { computers: WsusComputer[]; groups: WsusGroup[] }
      return { loading, computers: c.computers, groups: c.groups }
    })
    if (!res.ok) report(res as { ok: boolean; error?: string })
  }, [patch])

  const cargarServidores = useCallback(async (): Promise<void> => {
    const r = await window.adeep.wsus.servers()
    const list = report(r) ?? []
    setServers(list)
    setLoaded(true)
    setVista((v) => v || (list[0] ? `${list[0].id}|overview` : ''))
  }, [])

  const onSession = useCallback((_i: SessionInfo) => { void cargarServidores() }, [cargarServidores])

  const { sid, kind, arg } = parseVista(vista)
  const server = servers.find((s) => s.id === sid)
  const d = data[sid] ?? EMPTY

  /* Lo que necesita cada vista, pedido una sola vez por servidor. */
  useEffect(() => {
    if (!server) return
    const need: ('overview' | 'updates' | 'computers')[] = ['overview']
    if (['updates', 'overview', 'reports', 'review'].includes(kind)) need.push('updates', 'computers')
    if (['group', 'options'].includes(kind)) need.push('computers')
    for (const w of need) {
      const has = w === 'overview' ? d.overview : w === 'updates' ? d.updates : d.computers
      if (!has && !d.error) void load(server.id, w)
    }
  }, [server, kind, d.overview, d.updates, d.computers, d.error, load])

  // Mientras sincroniza, el estado se sigue solo; al terminar se recarga el catálogo.
  const sincronizando = !!(server && d.overview?.syncRunning)
  const estabaSincronizando = useRef(false)
  useEffect(() => {
    if (!server) return
    if (estabaSincronizando.current && !sincronizando && d.updates) void load(server.id, 'updates')
    estabaSincronizando.current = sincronizando
    if (!sincronizando) return
    const t = setInterval(() => void load(server.id, 'overview'), 5000)
    return () => clearInterval(t)
  }, [server, sincronizando, d.updates, load])

  const refrescar = useCallback((): void => {
    if (!server) { void cargarServidores(); return }
    patch(server.id, () => ({ error: undefined }))
    void load(server.id, 'overview')
    if (d.updates || ['updates', 'reports', 'review'].includes(kind)) void load(server.id, 'updates')
    if (d.computers || ['group', 'reports', 'review'].includes(kind)) void load(server.id, 'computers')
  }, [server, d.updates, d.computers, kind, load, patch, cargarServidores])

  const quitarServidor = async (s: WsusServerConfig): Promise<void> => {
    const ok = await confirm({ title: 'Quitar el servidor de la consola', message: s.name, detail: 'No toca nada en el servidor: sólo se olvida la conexión.', confirmLabel: 'Quitar' })
    if (!ok) return
    const list = report(await window.adeep.wsus.deleteServer(s.id))
    if (!list) return
    setServers(list)
    setData((cur) => { const n = { ...cur }; delete n[s.id]; return n })
    setVista(list[0] ? `${list[0].id}|overview` : '')
  }

  const sincronizar = async (s: WsusServerConfig): Promise<void> => {
    if (report(await window.adeep.wsus.startSync(s.id), `${s.name}: sincronización iniciada`) !== undefined) {
      setTimeout(() => void load(s.id, 'overview'), 1500)
    }
  }

  const borrarGrupo = async (s: WsusServerConfig, g: WsusGroup): Promise<void> => {
    const ok = await confirm({
      title: 'Borrar el grupo',
      message: groupLabel(g),
      detail: 'Se borran también sus subgrupos y todas sus aprobaciones. Los equipos que queden sin grupo pasan a «Equipos sin asignar».',
      confirmLabel: 'Borrar', danger: true
    })
    if (!ok) return
    if (report(await window.adeep.wsus.deleteGroup(s.id, g.id), `Grupo «${g.name}» borrado`) !== undefined) {
      setVista(`${s.id}|group|${GROUP_ALL}`)
      void load(s.id, 'computers')
    }
  }

  const menuServidor = (s: WsusServerConfig): MenuItemDef[] => [
    { id: 'conn', label: 'Conexión…', icon: <Plug size={15} />, onSelect: () => setDialog({ t: 'server', server: s }) },
    {
      id: 'sync', label: 'Sincronizar ahora', icon: <RefreshCw size={15} />,
      disabled: !s.allowWrites, title: s.allowWrites ? undefined : 'Servidor en sólo lectura', onSelect: () => void sincronizar(s)
    },
    { id: 's', separator: true },
    { id: 'del', label: 'Quitar de la consola', icon: <Trash2 size={15} />, onSelect: () => void quitarServidor(s) }
  ]

  const menuGrupo = (s: WsusServerConfig, g: WsusGroup): MenuItemDef[] => [
    {
      id: 'new', label: 'Nuevo grupo…', icon: <FolderPlus size={15} />, disabled: !s.allowWrites || g.id === GROUP_UNASSIGNED,
      onSelect: () => setDialog({ t: 'group', sid: s.id, parentId: g.id })
    },
    {
      id: 'del', label: 'Borrar el grupo', icon: <Trash2 size={15} />, danger: true,
      disabled: !s.allowWrites || g.builtin, onSelect: () => void borrarGrupo(s, g)
    }
  ]

  /* ------------------------------ Árbol ------------------------------ */

  const tree: TreeItem[] = servers.map((s) => {
    const sd = data[s.id] ?? EMPTY
    const grupo = (g: WsusGroup): TreeItem => ({
      id: `${s.id}|group|${g.id}`,
      label: groupLabel(g),
      kind: 'wsusGroup',
      badge: sd.computers ? String(g.computerCount) : undefined,
      data: { server: s, group: g },
      children: sd.groups
        .filter((x) => x.parentId === g.id)
        .sort((a, b) => (a.builtin ? 1 : b.builtin ? -1 : a.name.localeCompare(b.name, 'es')))
        .map(grupo)
    })
    const raiz = sd.groups.find((g) => g.id === GROUP_ALL)
    const revision = sd.overview && sd.updates && sd.computers
      ? reviewFindings(s, sd.overview, sd.updates, sd.computers, sd.groups, null).length
      : 0
    return {
      id: `${s.id}|overview`,
      label: s.name,
      kind: 'wsusServer',
      badge: s.allowWrites ? undefined : 'lectura',
      data: { server: s },
      children: [
        {
          id: `${s.id}|updates|all`, label: 'Actualizaciones', kind: 'wsusUpdates',
          badge: sd.updates ? String(sd.updates.filter((u) => !u.declined).length) : undefined,
          children: [
            { id: `${s.id}|updates|critical`, label: 'Actualizaciones críticas', kind: 'wsusUpdate' },
            { id: `${s.id}|updates|security`, label: 'Actualizaciones de seguridad', kind: 'wsusUpdate' },
            { id: `${s.id}|updates|definitions`, label: 'Actualizaciones de definiciones', kind: 'wsusUpdate' }
          ]
        },
        raiz
          ? { ...grupo(raiz), label: 'Equipos', kind: 'wsusComputers' }
          : { id: `${s.id}|group|${GROUP_ALL}`, label: 'Equipos', kind: 'wsusComputers' },
        { id: `${s.id}|downstream`, label: 'Servidores secundarios', kind: 'wsusDownstream' },
        { id: `${s.id}|sync`, label: 'Sincronizaciones', kind: 'wsusSync' },
        { id: `${s.id}|reports`, label: 'Informes', kind: 'wsusReports' },
        { id: `${s.id}|options`, label: 'Opciones', kind: 'wsusOptions' },
        { id: `${s.id}|review`, label: 'Revisión', kind: 'wsusCheck', badge: revision ? String(revision) : undefined }
      ]
    }
  })

  /* ------------------------------ Panel derecho ------------------------------ */

  const main = ((): JSX.Element => {
    if (!loaded) return <div />
    if (!servers.length || !server) {
      return (
        <div className="empty-state">
          <CloudDownload size={44} />
          <div className="title">No hay servidores WSUS configurados</div>
          <p className="hint" style={{ maxWidth: 440, textAlign: 'center', lineHeight: 1.5 }}>
            WSUS no publica nada en el directorio: hay que decirle a la consola dónde está. Se conecta por
            MS-WSUSAR, el mismo servicio que usa la consola de Windows, con la cuenta de la sesión.
          </p>
          <button className="btn primary" onClick={() => setDialog({ t: 'server' })}><Plus size={14} /> Agregar servidor WSUS…</button>
        </div>
      )
    }
    const reload = (w: 'updates' | 'computers' | 'overview'): void => { void load(server.id, w); if (w !== 'overview') void load(server.id, 'overview') }
    if (d.error && !d.overview) {
      return (
        <div className="empty-state">
          <CloudDownload size={44} />
          <div className="title">No se pudo conectar con {server.name}</div>
          <p className="hint" style={{ maxWidth: 480, textAlign: 'center' }}>{d.error}</p>
          <div className="row" style={{ gap: 8 }}>
            <button className="btn" onClick={() => setDialog({ t: 'server', server })}>Revisar la conexión…</button>
            <button className="btn primary" onClick={refrescar}>Reintentar</button>
          </div>
        </div>
      )
    }
    switch (kind) {
      case 'updates':
        return (
          <UpdatesView
            serverId={server.id} allowWrites={server.allowWrites} preset={(arg as UpdatePreset) ?? 'all'}
            updates={d.updates} groups={d.groups} computers={d.computers ?? []}
            loading={d.loading.has('updates')} onReload={() => reload('updates')}
          />
        )
      case 'group': {
        const g = d.groups.find((x) => x.id === arg) ?? d.groups.find((x) => x.id === GROUP_ALL)
        if (!g) return <div style={{ padding: 20 }} className="hint">Cargando los grupos…</div>
        return (
          <ComputersView
            serverId={server.id} allowWrites={server.allowWrites} group={g} groups={d.groups}
            computers={d.computers} loading={d.loading.has('computers')} onReload={() => reload('computers')}
          />
        )
      }
      case 'sync':
        return <SyncView serverId={server.id} allowWrites={server.allowWrites} overview={d.overview} onReload={() => reload('overview')} />
      case 'reports':
        return <ReportsView serverId={server.id} updates={d.updates} computers={d.computers} groups={d.groups} />
      case 'downstream':
        return <DownstreamView serverId={server.id} />
      case 'options':
        return (
          <OptionsView
            server={server} overview={d.overview} groups={d.groups}
            onReload={() => { reload('overview'); if (d.updates) void load(server.id, 'updates') }}
            onServers={setServers}
          />
        )
      case 'review':
        return <ReviewView server={server} overview={d.overview} updates={d.updates} computers={d.computers} groups={d.groups} />
      default:
        return (
          <OverviewView
            server={server} overview={d.overview} updates={d.updates} computers={d.computers}
            onReload={() => reload('overview')}
            onOpen={(v) => setVista(v === 'computers' ? `${server.id}|group|${GROUP_ALL}` : v === 'updates' ? `${server.id}|updates|all` : `${server.id}|${v}`)}
          />
        )
    }
  })()

  const cargando = d.loading.size > 0
  return (
    <ConsoleShell
      title="ADeep — WSUS"
      icon={<CloudDownload size={17} />}
      treeTitle="Windows Server Update Services"
      loading={cargando}
      onRefresh={refrescar}
      onSession={onSession}
      menus={{
        Acción: [
          { id: 'add', label: 'Agregar servidor WSUS…', icon: <Plus size={15} />, onSelect: () => setDialog({ t: 'server' }) },
          { id: 'conn', label: 'Conexión del servidor…', icon: <Plug size={15} />, disabled: !server, onSelect: () => server && setDialog({ t: 'server', server }) },
          { id: 's1', separator: true },
          {
            id: 'sync', label: 'Sincronizar ahora', icon: <RefreshCw size={15} />,
            disabled: !server?.allowWrites, onSelect: () => server && void sincronizar(server)
          },
          {
            id: 'group', label: 'Nuevo grupo de equipos…', icon: <FolderPlus size={15} />, disabled: !server?.allowWrites,
            onSelect: () => server && setDialog({ t: 'group', sid: server.id, parentId: kind === 'group' && arg ? arg : GROUP_ALL })
          }
        ]
      }}
      toolbar={
        server ? (
          <>
            <span className="hint" style={{ paddingLeft: 4 }}>
              {server.allowWrites ? <Unlock size={13} style={{ verticalAlign: -2 }} /> : <Lock size={13} style={{ verticalAlign: -2 }} />}{' '}
              {server.name} · {server.allowWrites ? 'cambios habilitados' : 'sólo lectura'}
            </span>
            <span className="vsep" />
            <button className="tool" title="Agregar servidor WSUS" onClick={() => setDialog({ t: 'server' })}><Plus size={16} /></button>
          </>
        ) : (
          <button className="tool" title="Agregar servidor WSUS" onClick={() => setDialog({ t: 'server' })}><Plus size={16} /></button>
        )
      }
      tree={
        <SimpleTree
          // Se monta de nuevo al cargar la lista: defaultExpanded sólo se lee al montar.
          key={servers.map((s) => s.id).join()}
          items={tree}
          selectedId={vista}
          defaultExpanded={servers.map((s) => `${s.id}|overview`)}
          onSelect={(item) => setVista(item.id)}
          onContextMenu={(item, x, y) => {
            const info = item.data as { server?: WsusServerConfig; group?: WsusGroup } | undefined
            if (info?.group && info.server) setCtx({ items: menuGrupo(info.server, info.group), x, y })
            else if (info?.server) setCtx({ items: menuServidor(info.server), x, y })
          }}
        />
      }
      main={
        <>
          {main}
          {ctx && <MenuPopup items={ctx.items} x={ctx.x} y={ctx.y} onClose={() => setCtx(null)} />}
          {dialog?.t === 'server' && (
            <ServerDialog
              initial={dialog.server}
              onClose={() => setDialog(null)}
              onSaved={(list, id) => {
                setServers(list)
                setDialog(null)
                setData((cur) => { const n = { ...cur }; delete n[id]; return n })
                setVista(`${id}|overview`)
              }}
            />
          )}
          {dialog?.t === 'group' && (
            <PromptDialog
              title="Nuevo grupo de equipos"
              label={`Dentro de «${groupLabel(d.groups.find((g) => g.id === dialog.parentId) ?? { id: GROUP_ALL, name: '' })}»`}
              confirmLabel="Crear"
              validate={(v) => (d.groups.some((g) => g.name.toLowerCase() === v.trim().toLowerCase()) ? 'Ya hay un grupo con ese nombre' : undefined)}
              onCancel={() => setDialog(null)}
              onConfirm={(name) => {
                const { sid: s, parentId } = dialog
                setDialog(null)
                void window.adeep.wsus.createGroup(s, name.trim(), parentId).then((r) => {
                  if (report(r, `Grupo «${name.trim()}» creado`)) void load(s, 'computers')
                })
              }}
            />
          )}
        </>
      }
      status={
        server ? (
          <span className={`seg ${d.error ? 'err' : ''}`}>
            {d.error
              ? d.error
              : d.overview
                ? `WSUS ${d.overview.version} · ${d.overview.computerCount} equipo(s) · ${d.overview.updateCount} actualización(es) · ${server.ssl ? 'HTTPS' : 'HTTP'}`
                : `Conectando con ${server.host}…`}
          </span>
        ) : undefined
      }
    />
  )
}
