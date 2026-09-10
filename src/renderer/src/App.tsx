import { useCallback, useEffect, useRef, useState, type JSX } from 'react'
import {
  Search, RefreshCw, ArrowUp, Trash2, Pencil, Settings2, UserPlus, Users, FolderPlus,
  Sparkles, Plug, PlugZap, Info, ListFilter, Building2, Copy, Scissors, ClipboardPaste,
  KeyRound, Ban, CircleCheck, Unlock, FileDown, SlidersHorizontal, Boxes, Monitor,
  Contact as ContactIcon, ScrollText, MoveRight, ShieldCheck, PanelsTopLeft, LayoutGrid
} from 'lucide-react'
import type { DirEntry, SessionInfo } from '@shared/types'
import { useApp } from './store'
import { MenuPopup, PromptDialog, useConfirm, type MenuItemDef } from './components/ui'
import TreePane from './components/TreePane'
import ListPane from './components/ListPane'
import ConnectDialog from './components/ConnectDialog'
import NewObjectDialog, { type NewObjectKind } from './components/NewObject'
import PropertiesDialog, { RenameUserDialog } from './components/Properties'
import FindDialog from './components/FindDialog'
import PreferencesDialog from './components/PreferencesDialog'
import ColumnsDialog from './components/ColumnsDialog'
import DomainInfoDialog from './components/DomainInfoDialog'
import MoveDialog from './components/MoveDialog'
import ResetPasswordDialog from './components/ResetPasswordDialog'
import AddToGroupDialog from './components/AddToGroupDialog'
import AboutDialog from './components/AboutDialog'
import { applyListFilter, loadRoots, refresh, revealDN } from './lib/treeActions'
import {
  copyText, deleteObjects, exportSelectionCsv, exportSelectionLdif, moveObjects,
  renameObject, selectedEntries, setEnabled, unlock
} from './lib/objectActions'
import { dnToDomain } from './lib/format'
import { consolesMenu } from './shell/consoles'

type Dialog =
  | { t: 'connect' }
  | { t: 'new'; kind: NewObjectKind; parentDN: string; copyFrom?: string }
  | { t: 'props'; dn: string; tab?: string }
  | { t: 'find' }
  | { t: 'prefs' }
  | { t: 'columns' }
  | { t: 'domain' }
  | { t: 'move'; dns: string[] }
  | { t: 'password'; dn: string; name: string }
  | { t: 'addToGroup'; dns: string[] }
  | { t: 'rename'; dn: string; name: string }
  | { t: 'renameUser'; dn: string }
  | { t: 'about' }

interface Ctx { items: MenuItemDef[]; x: number; y: number }

/**
 * Para usuarios se abre el diálogo completo: cambiar sólo el RDN deja el resto
 * de los nombres viejos, que es justo lo que confunde después.
 */
function renameDialogFor(entry: DirEntry): Dialog {
  return entry.kind === 'user' || entry.kind === 'inetOrgPerson'
    ? { t: 'renameUser', dn: entry.dn }
    : { t: 'rename', dn: entry.dn, name: entry.name }
}

export default function App(): JSX.Element {
  const session = useApp((s) => s.session)
  const prefs = useApp((s) => s.prefs)
  const theme = useApp((s) => s.theme)
  const selection = useApp((s) => s.selection)
  const selectedDN = useApp((s) => s.selectedDN)
  const items = useApp((s) => s.items)
  const statusText = useApp((s) => s.statusText)
  const clipboard = useApp((s) => s.clipboard)
  const quickFilter = useApp((s) => s.quickFilter)
  const listFilter = useApp((s) => s.listFilter)
  const set = useApp((s) => s.set)
  const confirm = useConfirm()

  const [dialog, setDialog] = useState<Dialog | null>({ t: 'connect' })
  const [ctx, setCtx] = useState<Ctx | null>(null)
  const [openMenu, setOpenMenu] = useState<string | null>(null)
  const [treeWidth, setTreeWidth] = useState(300)
  const appRef = useRef<HTMLDivElement>(null)

  /* ---------------- Arranque: preferencias y tema ---------------- */

  useEffect(() => {
    void (async () => {
      const p = await window.adeep.store.prefs().catch(() => null)
      if (p?.ok && p.data) set({ prefs: p.data })
      const t = await window.adeep.theme.get().catch(() => 'light' as const)
      set({ theme: t })

      // Otra consola puede haber abierto ya la sesión: todas comparten la conexión.
      const info = await window.adeep.session.info().catch(() => null)
      if (info?.ok && info.data?.connected) onConnected(info.data)
    })()

    const offTheme = window.adeep.theme.onChange((t) => set({ theme: t }))
    const offSession = window.adeep.session.onChange((info) => {
      if (info.connected) onConnected(info)
      else {
        set({
          session: { connected: false }, tree: [], items: [], selection: [],
          selectedDN: null, view: null, statusText: ''
        })
        setDialog({ t: 'connect' })
      }
    })
    return () => { offTheme(); offSession() }
    // Sólo al montar.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
  }, [theme])

  useEffect(() => {
    document.documentElement.style.setProperty('--row-h', prefs.density === 'compact' ? '25px' : '30px')
    document.documentElement.style.setProperty('--tree-row-h', prefs.density === 'compact' ? '23px' : '27px')
  }, [prefs.density])

  /* ---------------- Sesión ---------------- */

  const onConnected = (info: SessionInfo): void => {
    set({ session: info })
    setDialog(null)
    void loadRoots()
    void (async () => {
      const q = await window.adeep.store.queries()
      if (q.ok) set({ queries: q.data ?? [] })
    })()
  }

  const disconnect = async (): Promise<void> => {
    const res = await window.adeep.session.disconnect()
    if (res.ok) {
      set({
        session: { connected: false }, tree: [], items: [], selection: [],
        selectedDN: null, view: null, statusText: ''
      })
      setDialog({ t: 'connect' })
    }
  }

  /* ---------------- Acciones ---------------- */

  const sel = selectedEntries()
  const one = sel.length === 1 ? sel[0] : null
  const targetDN = selectedDN ?? ''

  const openProps = useCallback((dn: string, tab?: string) => setDialog({ t: 'props', dn, tab }), [])

  const openEntry = (e: DirEntry): void => {
    if (e.isContainer) void revealDN(e.dn)
    else openProps(e.dn)
  }

  const doDelete = useCallback(() => void deleteObjects(sel, confirm), [sel, confirm])

  const paste = useCallback(async () => {
    if (!clipboard || !targetDN) return
    if (clipboard.op === 'cut') {
      const ok = await moveObjects(clipboard.dns, targetDN)
      if (ok) set({ clipboard: null })
      return
    }
    setDialog({ t: 'new', kind: 'user', parentDN: targetDN, copyFrom: clipboard.dns[0] })
  }, [clipboard, targetDN, set])

  const goUp = useCallback(async () => {
    if (!selectedDN) return
    const res = await window.adeep.dir.parent(selectedDN)
    if (res.ok && res.data) await revealDN(res.data)
  }, [selectedDN])

  const toggleAdvanced = useCallback(async () => {
    const next = !prefs.showAdvancedFeatures
    const res = await window.adeep.store.setPrefs({ showAdvancedFeatures: next })
    if (res.ok && res.data) set({ prefs: res.data })
    await refresh()
  }, [prefs.showAdvancedFeatures, set])

  /* ---------------- Atajos de teclado ---------------- */

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const el = e.target as HTMLElement
      if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT') {
        if (e.key === 'Escape') (el as HTMLInputElement).blur()
        return
      }
      if (!session.connected) return
      const ctrl = e.ctrlKey || e.metaKey

      if (e.key === 'F5') { e.preventDefault(); void refresh() }
      else if (e.key === 'Delete' && sel.length) { e.preventDefault(); doDelete() }
      else if (e.key === 'F2' && one) { e.preventDefault(); setDialog(renameDialogFor(one)) }
      else if (e.key === 'Enter' && e.altKey && one) { e.preventDefault(); openProps(one.dn) }
      else if (ctrl && e.key.toLowerCase() === 'f') { e.preventDefault(); setDialog({ t: 'find' }) }
      else if (ctrl && e.key.toLowerCase() === 'x' && sel.length) {
        e.preventDefault(); set({ clipboard: { dns: sel.map((s) => s.dn), op: 'cut' } })
      } else if (ctrl && e.key.toLowerCase() === 'c' && sel.length) {
        e.preventDefault(); set({ clipboard: { dns: sel.map((s) => s.dn), op: 'copy' } })
      } else if (ctrl && e.key.toLowerCase() === 'v' && clipboard) {
        e.preventDefault(); void paste()
      } else if (e.key === 'Backspace') { e.preventDefault(); void goUp() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [session.connected, sel, one, clipboard, doDelete, openProps, paste, goUp, set])

  /* ---------------- Menús ---------------- */

  const newSubmenu = (parentDN: string): MenuItemDef[] => [
    { id: 'n-user', label: 'Usuario', icon: <UserPlus size={15} />, onSelect: () => setDialog({ t: 'new', kind: 'user', parentDN }) },
    { id: 'n-group', label: 'Grupo', icon: <Users size={15} />, onSelect: () => setDialog({ t: 'new', kind: 'group', parentDN }) },
    { id: 'n-ou', label: 'Unidad organizativa', icon: <FolderPlus size={15} />, onSelect: () => setDialog({ t: 'new', kind: 'ou', parentDN }) },
    { id: 'n-computer', label: 'Equipo', icon: <Monitor size={15} />, onSelect: () => setDialog({ t: 'new', kind: 'computer', parentDN }) },
    { id: 'n-contact', label: 'Contacto', icon: <ContactIcon size={15} />, onSelect: () => setDialog({ t: 'new', kind: 'contact', parentDN }) }
  ]

  const objectMenu = (entries: DirEntry[], parentDN: string): MenuItemDef[] => {
    const accounts = entries.filter((e) => e.kind === 'user' || e.kind === 'computer' || e.kind === 'inetOrgPerson')
    const anyDisabled = accounts.some((e) => e.disabled)
    const single = entries.length === 1 ? entries[0] : null
    const dns = entries.map((e) => e.dn)

    if (!entries.length) {
      return [
        { id: 'new', label: 'Nuevo', icon: <Sparkles size={15} />, submenu: newSubmenu(parentDN) },
        { id: 's1', separator: true },
        { id: 'paste', label: 'Pegar', icon: <ClipboardPaste size={15} />, shortcut: 'Ctrl+V', disabled: !clipboard, onSelect: () => void paste() },
        { id: 'refresh', label: 'Actualizar', icon: <RefreshCw size={15} />, shortcut: 'F5', onSelect: () => void refresh() },
        { id: 's2', separator: true },
        { id: 'props-c', label: 'Propiedades', icon: <Settings2 size={15} />, disabled: !parentDN, onSelect: () => openProps(parentDN) }
      ]
    }

    return [
      ...(single?.isContainer
        ? [
            { id: 'new', label: 'Nuevo', icon: <Sparkles size={15} />, submenu: newSubmenu(single.dn) } as MenuItemDef,
            { id: 'open', label: 'Abrir', onSelect: () => void revealDN(single.dn) } as MenuItemDef,
            { id: 's0', separator: true } as MenuItemDef
          ]
        : []),
      ...(accounts.length
        ? [
            {
              id: 'enable',
              label: anyDisabled ? 'Habilitar cuenta' : 'Deshabilitar cuenta',
              icon: anyDisabled ? <CircleCheck size={15} /> : <Ban size={15} />,
              onSelect: () => void setEnabled(accounts.map((a) => a.dn), anyDisabled)
            } as MenuItemDef,
            {
              id: 'unlock',
              label: 'Desbloquear cuenta',
              icon: <Unlock size={15} />,
              disabled: !accounts.some((a) => a.locked),
              onSelect: () => void unlock(accounts.map((a) => a.dn))
            } as MenuItemDef,
            ...(single && (single.kind === 'user' || single.kind === 'inetOrgPerson')
              ? [{
                  id: 'pwd',
                  label: 'Restablecer contraseña…',
                  icon: <KeyRound size={15} />,
                  onSelect: () => setDialog({ t: 'password', dn: single.dn, name: single.name })
                } as MenuItemDef]
              : []),
            { id: 's3', separator: true } as MenuItemDef
          ]
        : []),
      {
        id: 'addgroup',
        label: 'Agregar a un grupo…',
        icon: <Users size={15} />,
        onSelect: () => setDialog({ t: 'addToGroup', dns })
      },
      { id: 's4', separator: true },
      { id: 'cut', label: 'Cortar', icon: <Scissors size={15} />, shortcut: 'Ctrl+X', onSelect: () => set({ clipboard: { dns, op: 'cut' } }) },
      {
        id: 'copy',
        label: 'Copiar…',
        icon: <Copy size={15} />,
        disabled: !single || (single.kind !== 'user' && single.kind !== 'inetOrgPerson'),
        onSelect: () => single && setDialog({ t: 'new', kind: 'user', parentDN, copyFrom: single.dn })
      },
      { id: 'move', label: 'Mover…', icon: <MoveRight size={15} />, onSelect: () => setDialog({ t: 'move', dns }) },
      { id: 'delete', label: 'Eliminar', icon: <Trash2 size={15} />, shortcut: 'Supr', danger: true, onSelect: doDelete },
      {
        id: 'rename', label: 'Cambiar nombre', icon: <Pencil size={15} />, shortcut: 'F2', disabled: !single,
        onSelect: () => single && setDialog(renameDialogFor(single))
      },
      { id: 's5', separator: true },
      { id: 'copydn', label: 'Copiar DN', disabled: !single, onSelect: () => single && void copyText(single.dn, 'DN copiado') },
      { id: 'exp-csv', label: 'Exportar selección a CSV…', icon: <FileDown size={15} />, onSelect: () => void exportSelectionCsv(entries) },
      { id: 'exp-ldif', label: 'Exportar selección a LDIF…', icon: <ScrollText size={15} />, onSelect: () => void exportSelectionLdif(entries) },
      { id: 's6', separator: true },
      {
        id: 'sec', label: 'Seguridad…', icon: <ShieldCheck size={15} />, disabled: !single,
        onSelect: () => single && openProps(single.dn, 'security')
      },
      {
        id: 'props', label: 'Propiedades', icon: <Settings2 size={15} />, shortcut: 'Alt+Entrar', disabled: !single,
        onSelect: () => single && openProps(single.dn)
      }
    ]
  }

  const listContext = (entry: DirEntry | null, x: number, y: number): void => {
    const entries = entry
      ? selection.some((d) => d.toLowerCase() === entry.dn.toLowerCase())
        ? selectedEntries()
        : [entry]
      : []
    if (entry && !selection.some((d) => d.toLowerCase() === entry.dn.toLowerCase())) {
      set({ selection: [entry.dn], lastClickedDN: entry.dn })
    }
    setCtx({ items: objectMenu(entries, targetDN), x, y })
  }

  const treeContext = (entry: DirEntry, x: number, y: number): void => {
    setCtx({
      items: [
        { id: 'new', label: 'Nuevo', icon: <Sparkles size={15} />, submenu: newSubmenu(entry.dn) },
        { id: 's1', separator: true },
        { id: 'refresh', label: 'Actualizar', icon: <RefreshCw size={15} />, shortcut: 'F5', onSelect: () => void refresh(entry.dn) },
        { id: 'paste', label: 'Pegar', icon: <ClipboardPaste size={15} />, disabled: !clipboard, onSelect: () => void paste() },
        { id: 's2', separator: true },
        { id: 'move', label: 'Mover…', icon: <MoveRight size={15} />, disabled: entry.kind === 'domain', onSelect: () => setDialog({ t: 'move', dns: [entry.dn] }) },
        { id: 'del', label: 'Eliminar', icon: <Trash2 size={15} />, danger: true, disabled: entry.kind === 'domain', onSelect: () => void deleteObjects([entry], confirm) },
        { id: 'rename', label: 'Cambiar nombre', icon: <Pencil size={15} />, shortcut: 'F2', disabled: entry.kind === 'domain', onSelect: () => setDialog(renameDialogFor(entry)) },
        { id: 's3', separator: true },
        { id: 'copydn', label: 'Copiar DN', onSelect: () => void copyText(entry.dn, 'DN copiado') },
        { id: 'sec', label: 'Seguridad…', icon: <ShieldCheck size={15} />, onSelect: () => openProps(entry.dn, 'security') },
        { id: 'props', label: 'Propiedades', icon: <Settings2 size={15} />, onSelect: () => openProps(entry.dn) }
      ],
      x,
      y
    })
  }

  const menuBarItems: Record<string, MenuItemDef[]> = {
    Archivo: [
      { id: 'connect', label: 'Conectar…', icon: <Plug size={15} />, onSelect: () => setDialog({ t: 'connect' }) },
      { id: 'disconnect', label: 'Desconectar', icon: <PlugZap size={15} />, disabled: !session.connected, onSelect: () => void disconnect() },
      { id: 's1', separator: true },
      { id: 'csv', label: 'Exportar lista a CSV…', icon: <FileDown size={15} />, disabled: !items.length, onSelect: () => void exportSelectionCsv(items) },
      { id: 'ldif', label: 'Exportar lista a LDIF…', icon: <ScrollText size={15} />, disabled: !items.length, onSelect: () => void exportSelectionLdif(items) },
      { id: 's2', separator: true },
      { id: 'quit', label: 'Salir', onSelect: () => window.close() }
    ],
    Acción: [
      { id: 'new', label: 'Nuevo', icon: <Sparkles size={15} />, disabled: !targetDN, submenu: newSubmenu(targetDN) },
      { id: 's1', separator: true },
      { id: 'find', label: 'Buscar…', icon: <Search size={15} />, shortcut: 'Ctrl+F', disabled: !session.connected, onSelect: () => setDialog({ t: 'find' }) },
      { id: 'up', label: 'Subir un nivel', icon: <ArrowUp size={15} />, disabled: !selectedDN, onSelect: () => void goUp() },
      { id: 'refresh', label: 'Actualizar', icon: <RefreshCw size={15} />, shortcut: 'F5', disabled: !session.connected, onSelect: () => void refresh() },
      { id: 's2', separator: true },
      { id: 'del', label: 'Eliminar', icon: <Trash2 size={15} />, danger: true, disabled: !sel.length, onSelect: doDelete },
      { id: 'props', label: 'Propiedades', icon: <Settings2 size={15} />, disabled: !one, onSelect: () => one && openProps(one.dn) }
    ],
    Ver: [
      {
        id: 'adv', label: 'Características avanzadas', checked: prefs.showAdvancedFeatures,
        onSelect: () => void toggleAdvanced()
      },
      {
        id: 'density', label: 'Filas compactas', checked: prefs.density === 'compact',
        onSelect: () => void (async () => {
          const res = await window.adeep.store.setPrefs({
            density: prefs.density === 'compact' ? 'comfortable' : 'compact'
          })
          if (res.ok && res.data) set({ prefs: res.data })
        })()
      },
      { id: 's1', separator: true },
      { id: 'cols', label: 'Elegir columnas…', icon: <SlidersHorizontal size={15} />, onSelect: () => setDialog({ t: 'columns' }) },
      {
        id: 'filter', label: listFilter ? 'Quitar filtro LDAP' : 'Filtrar la lista…', icon: <ListFilter size={15} />,
        disabled: !session.connected,
        onSelect: () => {
          if (listFilter) applyListFilter('')
          else setDialog({ t: 'find' })
        }
      }
    ],
    Consolas: consolesMenu('aduc'),
    Herramientas: [
      { id: 'domain', label: 'Información del dominio…', icon: <Building2 size={15} />, disabled: !session.connected, onSelect: () => setDialog({ t: 'domain' }) },
      { id: 'attrs', label: 'Editor de atributos…', icon: <PanelsTopLeft size={15} />, disabled: !one, onSelect: () => one && openProps(one.dn, 'attributes') },
      { id: 's1', separator: true },
      { id: 'prefs', label: 'Preferencias…', icon: <Settings2 size={15} />, onSelect: () => setDialog({ t: 'prefs' }) }
    ],
    Ayuda: [
      { id: 'about', label: 'Acerca de ADeep', icon: <Info size={15} />, onSelect: () => setDialog({ t: 'about' }) }
    ]
  }

  /* ---------------- Divisor ---------------- */

  const startDrag = (e: React.MouseEvent): void => {
    e.preventDefault()
    const x0 = e.clientX
    const w0 = treeWidth
    const move = (ev: MouseEvent): void => setTreeWidth(Math.min(560, Math.max(200, w0 + ev.clientX - x0)))
    const up = (): void => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
      document.body.classList.remove('dragging')
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }

  /* ---------------- Render ---------------- */

  return (
    <div className="app" ref={appRef} style={{ ['--tree-w' as string]: `${treeWidth}px` }}>
      <div className="menubar">
        <div className="brand">
          <Boxes size={17} />
          ADeep
        </div>
        {Object.keys(menuBarItems).map((label) => (
          <button
            key={label}
            className={`menu-btn ${openMenu === label ? 'open' : ''}`}
            onClick={(e) => {
              const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
              setOpenMenu(label)
              setCtx({ items: menuBarItems[label], x: r.left, y: r.bottom + 2 })
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
        <button className="tool" title="Subir un nivel (Retroceso)" disabled={!selectedDN} onClick={() => void goUp()}>
          <ArrowUp size={16} />
        </button>
        <button className="tool" title="Actualizar (F5)" disabled={!session.connected} onClick={() => void refresh()}>
          <RefreshCw size={16} />
        </button>
        <span className="vsep" />
        <button className="tool" title="Nuevo usuario" disabled={!targetDN} onClick={() => setDialog({ t: 'new', kind: 'user', parentDN: targetDN })}>
          <UserPlus size={16} />
        </button>
        <button className="tool" title="Nuevo grupo" disabled={!targetDN} onClick={() => setDialog({ t: 'new', kind: 'group', parentDN: targetDN })}>
          <Users size={16} />
        </button>
        <button className="tool" title="Nueva unidad organizativa" disabled={!targetDN} onClick={() => setDialog({ t: 'new', kind: 'ou', parentDN: targetDN })}>
          <FolderPlus size={16} />
        </button>
        <span className="vsep" />
        <button className="tool" title="Buscar (Ctrl+F)" disabled={!session.connected} onClick={() => setDialog({ t: 'find' })}>
          <Search size={16} />
        </button>
        <button className="tool" title="Propiedades (Alt+Entrar)" disabled={!one} onClick={() => one && openProps(one.dn)}>
          <Settings2 size={16} />
        </button>
        <button className="tool" title="Eliminar (Supr)" disabled={!sel.length} onClick={doDelete}>
          <Trash2 size={16} />
        </button>
        <span className="vsep" />
        <button
          className={`tool ${prefs.showAdvancedFeatures ? 'on' : ''}`}
          title="Características avanzadas"
          disabled={!session.connected}
          onClick={() => void toggleAdvanced()}
        >
          <Sparkles size={16} />
        </button>
        <div className="search">
          <Search size={14} />
          <input
            type="search"
            placeholder="Filtrar la lista…"
            value={quickFilter}
            onChange={(e) => set({ quickFilter: e.target.value })}
          />
        </div>
        <span className="vsep" />
        <button
          className="tool"
          title="Abrir otra consola"
          onClick={(e) => {
            const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
            setCtx({ items: consolesMenu('aduc'), x: r.left - 140, y: r.bottom + 4 })
          }}
        >
          <LayoutGrid size={16} />
        </button>
      </div>

      <div className="body">
        <TreePane onContextMenu={treeContext} />
        <div className="splitter" onMouseDown={startDrag} />
        <ListPane
          onContextMenu={listContext}
          onOpen={openEntry}
          onHeaderContextMenu={(x, y) =>
            setCtx({
              items: [
                { id: 'cols', label: 'Elegir columnas…', icon: <SlidersHorizontal size={15} />, onSelect: () => setDialog({ t: 'columns' }) }
              ],
              x,
              y
            })
          }
        />
      </div>

      <div className="statusbar">
        <span className="seg">{statusText || (session.connected ? 'Listo' : 'Sin conexión')}</span>
        {!!selection.length && <span className="seg">{selection.length} seleccionado(s)</span>}
        {listFilter && <span className="seg"><ListFilter size={12} /> {listFilter}</span>}
        <div className="spacer" style={{ flex: 1 }} />
        {clipboard && (
          <span className="seg">
            {clipboard.op === 'cut' ? <Scissors size={12} /> : <Copy size={12} />} {clipboard.dns.length}
          </span>
        )}
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

      {dialog?.t === 'connect' && (
        <ConnectDialog
          onClose={() => setDialog(null)}
          onConnected={onConnected}
        />
      )}
      {dialog?.t === 'new' && (
        <NewObjectDialog
          kind={dialog.kind}
          parentDN={dialog.parentDN}
          copyFrom={dialog.copyFrom}
          onClose={() => setDialog(null)}
          onCreated={(dn) => {
            setDialog(null)
            set({ clipboard: null })
            void refresh(dialog.parentDN).then(() => set({ selection: [dn], lastClickedDN: dn }))
          }}
        />
      )}
      {dialog?.t === 'props' && (
        <PropertiesDialog dn={dialog.dn} initialTab={dialog.tab} onClose={() => setDialog(null)} onChanged={() => void refresh()} />
      )}
      {dialog?.t === 'find' && (
        <FindDialog
          onClose={() => setDialog(null)}
          onOpenProps={(dn) => openProps(dn)}
        />
      )}
      {dialog?.t === 'prefs' && <PreferencesDialog onClose={() => setDialog(null)} />}
      {dialog?.t === 'columns' && <ColumnsDialog onClose={() => setDialog(null)} />}
      {dialog?.t === 'domain' && <DomainInfoDialog onClose={() => setDialog(null)} />}
      {dialog?.t === 'move' && (
        <MoveDialog
          dns={dialog.dns}
          onClose={() => setDialog(null)}
          onMoved={() => { setDialog(null); set({ clipboard: null }) }}
        />
      )}
      {dialog?.t === 'password' && (
        <ResetPasswordDialog dn={dialog.dn} name={dialog.name} onClose={() => setDialog(null)} />
      )}
      {dialog?.t === 'addToGroup' && (
        <AddToGroupDialog dns={dialog.dns} onClose={() => setDialog(null)} />
      )}
      {dialog?.t === 'rename' && (
        <PromptDialog
          title="Cambiar nombre"
          label="Nuevo nombre"
          initial={dialog.name}
          confirmLabel="Cambiar"
          validate={(v) => (/[,\\/+<>;"=]/.test(v) ? 'El nombre no puede contener , \\ / + < > ; " =' : undefined)}
          onCancel={() => setDialog(null)}
          onConfirm={(v) => {
            setDialog(null)
            if (v !== dialog.name) void renameObject(dialog.dn, v)
          }}
        />
      )}
      {dialog?.t === 'renameUser' && (
        <RenameUserDialog
          dn={dialog.dn}
          onClose={() => setDialog(null)}
          onRenamed={() => { setDialog(null); void refresh() }}
        />
      )}

      {dialog?.t === 'about' && <AboutDialog onClose={() => setDialog(null)} />}
    </div>
  )
}

