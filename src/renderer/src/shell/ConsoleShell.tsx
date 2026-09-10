import { useEffect, useState, type JSX, type ReactNode } from 'react'
import { Boxes, RefreshCw, Plug, PlugZap, Info, Settings2, LayoutGrid } from 'lucide-react'
import type { SessionInfo } from '@shared/types'
import { MenuPopup, Spinner, type MenuItemDef } from '../components/ui'
import ConnectDialog from '../components/ConnectDialog'
import PreferencesDialog from '../components/PreferencesDialog'
import AboutDialog from '../components/AboutDialog'
import { useApp } from '../store'
import { dnToDomain } from '../lib/format'
import { CONSOLE_LABELS, consolesMenu as buildConsolesMenu } from './consoles'

/** Las cuatro consolas comparten esta cáscara: menús, toolbar, cuerpo y barra de estado. */
export interface ShellProps {
  title: string
  icon?: ReactNode
  /** Menús propios de la consola, además de Archivo, Consolas y Ayuda. */
  menus?: Record<string, MenuItemDef[]>
  toolbar?: ReactNode
  tree: ReactNode
  treeTitle: string
  main: ReactNode
  status?: ReactNode
  loading?: boolean
  onRefresh: () => void
  /** Se llama al conectar y al recuperar una sesión ya abierta en otra consola. */
  onSession: (info: SessionInfo) => void
}

export default function ConsoleShell({
  title,
  icon,
  menus,
  toolbar,
  tree,
  treeTitle,
  main,
  status,
  loading,
  onRefresh,
  onSession
}: ShellProps): JSX.Element {
  const session = useApp((s) => s.session)
  const theme = useApp((s) => s.theme)
  const prefs = useApp((s) => s.prefs)
  const set = useApp((s) => s.set)

  const [ctx, setCtx] = useState<{ items: MenuItemDef[]; x: number; y: number } | null>(null)
  const [openMenu, setOpenMenu] = useState<string | null>(null)
  const [dialog, setDialog] = useState<'connect' | 'prefs' | 'about' | null>(null)
  const [treeWidth, setTreeWidth] = useState(300)

  const consoleId = window.adeep.app.consoleId

  /* Sesión, tema y preferencias son globales a todas las consolas. */
  useEffect(() => {
    void (async () => {
      // Cada llamada por separado: que falle el tema no puede dejar la consola en blanco.
      const p = await window.adeep.store.prefs().catch(() => null)
      if (p?.ok && p.data) set({ prefs: p.data })

      const t = await window.adeep.theme.get().catch(() => 'light' as const)
      set({ theme: t })

      const info = await window.adeep.session.info().catch(() => null)
      if (info?.ok && info.data?.connected) {
        set({ session: info.data })
        onSession(info.data)
      } else {
        setDialog('connect')
      }
    })()

    const offTheme = window.adeep.theme.onChange((t) => set({ theme: t }))
    const offSession = window.adeep.session.onChange((info) => {
      set({ session: info })
      if (info.connected) onSession(info)
    })
    return () => { offTheme(); offSession() }
    // Sólo al montar: onSession cambia de identidad en cada render de la consola.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
  }, [theme])

  useEffect(() => {
    document.documentElement.style.setProperty('--row-h', prefs.density === 'compact' ? '25px' : '30px')
    document.documentElement.style.setProperty('--tree-row-h', prefs.density === 'compact' ? '23px' : '27px')
  }, [prefs.density])

  useEffect(() => {
    document.title = title
  }, [title])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const el = e.target as HTMLElement
      if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') return
      if (e.key === 'F5') { e.preventDefault(); onRefresh() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onRefresh])

  const disconnect = async (): Promise<void> => {
    const res = await window.adeep.session.disconnect()
    if (res.ok) setDialog('connect')
  }

  const consolesMenu = buildConsolesMenu(consoleId)

  const allMenus: Record<string, MenuItemDef[]> = {
    Archivo: [
      { id: 'connect', label: 'Conectar…', icon: <Plug size={15} />, onSelect: () => setDialog('connect') },
      {
        id: 'disconnect', label: 'Desconectar', icon: <PlugZap size={15} />,
        disabled: !session.connected, onSelect: () => void disconnect()
      },
      { id: 's1', separator: true },
      { id: 'refresh', label: 'Actualizar', icon: <RefreshCw size={15} />, shortcut: 'F5', onSelect: onRefresh },
      { id: 's2', separator: true },
      { id: 'close', label: 'Cerrar esta consola', onSelect: () => window.close() }
    ],
    ...(menus ?? {}),
    Consolas: consolesMenu,
    Herramientas: [
      { id: 'prefs', label: 'Preferencias…', icon: <Settings2 size={15} />, onSelect: () => setDialog('prefs') }
    ],
    Ayuda: [
      { id: 'about', label: 'Acerca de ADeep', icon: <Info size={15} />, onSelect: () => setDialog('about') }
    ]
  }

  const startDrag = (e: React.MouseEvent): void => {
    e.preventDefault()
    const x0 = e.clientX
    const w0 = treeWidth
    const move = (ev: MouseEvent): void =>
      setTreeWidth(Math.min(560, Math.max(200, w0 + ev.clientX - x0)))
    const up = (): void => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }

  return (
    <div className="app" style={{ ['--tree-w' as string]: `${treeWidth}px` }}>
      <div className="menubar">
        <div className="brand">
          {icon ?? <Boxes size={17} />}
          {CONSOLE_LABELS[consoleId] ?? 'ADeep'}
        </div>
        {Object.keys(allMenus).map((label) => (
          <button
            key={label}
            className={`menu-btn ${openMenu === label ? 'open' : ''}`}
            onClick={(e) => {
              const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
              setOpenMenu(label)
              setCtx({ items: allMenus[label], x: r.left, y: r.bottom + 2 })
            }}
          >
            {label}
          </button>
        ))}
        <div className="spacer" style={{ flex: 1 }} />
        <div className="session">
          <span className={`dot ${session.connected ? '' : 'off'}`} />
          {session.connected
            ? `${session.profile?.bindDN ?? ''} — ${dnToDomain(session.rootDSE?.defaultNamingContext ?? '')}`
            : 'Sin conexión'}
        </div>
      </div>

      <div className="toolbar">
        <button className="tool" title="Actualizar (F5)" disabled={!session.connected} onClick={onRefresh}>
          {loading ? <Spinner size={16} /> : <RefreshCw size={16} />}
        </button>
        <span className="vsep" />
        {toolbar}
        <div className="spacer" style={{ flex: 1 }} />
        <button
          className="tool"
          title="Abrir otra consola"
          onClick={(e) => {
            const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
            setCtx({ items: consolesMenu, x: r.left - 120, y: r.bottom + 4 })
          }}
        >
          <LayoutGrid size={16} />
        </button>
      </div>

      <div className="body">
        <div className="tree-pane">
          <div className="pane-head">
            <span>{treeTitle}</span>
            {loading && <Spinner size={12} />}
          </div>
          <div className="tree">{tree}</div>
        </div>
        <div className="splitter" onMouseDown={startDrag} />
        <div className="list-pane">{main}</div>
      </div>

      <div className="statusbar">
        {status ?? <span className="seg">{session.connected ? 'Listo' : 'Sin conexión'}</span>}
        <div className="spacer" style={{ flex: 1 }} />
        {session.connected && (
          <span className="seg" title={session.rootDSE?.dnsHostName}>
            {session.rootDSE?.dnsHostName ?? ''}
          </span>
        )}
      </div>

      {ctx && (
        <MenuPopup
          items={ctx.items}
          x={ctx.x}
          y={ctx.y}
          onClose={() => { setCtx(null); setOpenMenu(null) }}
        />
      )}

      {dialog === 'connect' && (
        <ConnectDialog
          onClose={() => setDialog(null)}
          onConnected={(info) => {
            set({ session: info })
            setDialog(null)
            onSession(info)
          }}
        />
      )}
      {dialog === 'prefs' && <PreferencesDialog onClose={() => setDialog(null)} />}
      {dialog === 'about' && <AboutDialog onClose={() => setDialog(null)} />}
    </div>
  )
}
