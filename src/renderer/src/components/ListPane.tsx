import { useEffect, useMemo, useRef, useState, type JSX } from 'react'
import { ChevronDown, ChevronUp, ChevronRight, Ban, Lock, CalendarX, Inbox } from 'lucide-react'
import type { DirEntry } from '@shared/types'
import { useApp } from '../store'
import { COLUMN_BY_ID, COLUMNS, columnValue } from '../lib/columns'
import { KindIcon } from '../lib/icons'
import { splitDN, rdnValue } from '../lib/format'
import { select } from '../lib/treeActions'
import { Spinner } from './ui'

export default function ListPane({
  onContextMenu,
  onOpen,
  onHeaderContextMenu
}: {
  onContextMenu: (entry: DirEntry | null, x: number, y: number) => void
  onOpen: (entry: DirEntry) => void
  onHeaderContextMenu: (x: number, y: number) => void
}): JSX.Element {
  const view = useApp((s) => s.view)
  const items = useApp((s) => s.items)
  const loading = useApp((s) => s.itemsLoading)
  const selection = useApp((s) => s.selection)
  const lastClickedDN = useApp((s) => s.lastClickedDN)
  const clipboard = useApp((s) => s.clipboard)
  const quickFilter = useApp((s) => s.quickFilter)
  const sortBy = useApp((s) => s.sortBy)
  const sortDir = useApp((s) => s.sortDir)
  const columns = useApp((s) => s.prefs.columns)
  const set = useApp((s) => s.set)

  const [widths, setWidths] = useState<Record<string, number>>({})
  const gridRef = useRef<HTMLDivElement>(null)

  const cols = useMemo(
    () => columns.map((id) => COLUMN_BY_ID.get(id) ?? COLUMNS[0]).filter(Boolean),
    [columns]
  )

  const rows = useMemo(() => {
    const q = quickFilter.trim().toLowerCase()
    const filtered = q
      ? items.filter(
          (e) =>
            e.name.toLowerCase().includes(q) ||
            (e.description ?? '').toLowerCase().includes(q) ||
            columnValue(e, 'sAMAccountName').toLowerCase().includes(q)
        )
      : items
    const dir = sortDir
    return [...filtered].sort((a, b) => {
      const av = columnValue(a, sortBy)
      const bv = columnValue(b, sortBy)
      const c = av.localeCompare(bv, 'es', { sensitivity: 'base', numeric: true })
      return (c || a.name.localeCompare(b.name, 'es')) * dir
    })
  }, [items, quickFilter, sortBy, sortDir])

  useEffect(() => {
    gridRef.current?.scrollTo({ top: 0 })
  }, [view])

  const selSet = useMemo(() => new Set(selection.map((d) => d.toLowerCase())), [selection])
  const cutSet = useMemo(
    () => new Set(clipboard?.op === 'cut' ? clipboard.dns.map((d) => d.toLowerCase()) : []),
    [clipboard]
  )

  const clickRow = (e: React.MouseEvent, entry: DirEntry): void => {
    const dn = entry.dn
    if (e.shiftKey && lastClickedDN) {
      const a = rows.findIndex((r) => r.dn === lastClickedDN)
      const b = rows.findIndex((r) => r.dn === dn)
      if (a >= 0 && b >= 0) {
        const [from, to] = a < b ? [a, b] : [b, a]
        set({ selection: rows.slice(from, to + 1).map((r) => r.dn) })
        return
      }
    }
    if (e.ctrlKey || e.metaKey) {
      const has = selSet.has(dn.toLowerCase())
      set({
        selection: has ? selection.filter((d) => d !== dn) : [...selection, dn],
        lastClickedDN: dn
      })
      return
    }
    set({ selection: [dn], lastClickedDN: dn })
  }

  const onKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === 'a' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault()
      set({ selection: rows.map((r) => r.dn) })
      return
    }
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp' && e.key !== 'Enter') return
    const i = rows.findIndex((r) => r.dn === lastClickedDN)
    if (e.key === 'Enter') {
      const cur = rows[i]
      if (cur) onOpen(cur)
      return
    }
    e.preventDefault()
    const next = e.key === 'ArrowDown' ? Math.min(rows.length - 1, i + 1) : Math.max(0, i - 1)
    const target = rows[i < 0 ? 0 : next]
    if (target) set({ selection: [target.dn], lastClickedDN: target.dn })
  }

  const startResize = (e: React.MouseEvent, id: string, current: number): void => {
    e.preventDefault()
    e.stopPropagation()
    const x0 = e.clientX
    const move = (ev: MouseEvent): void => {
      setWidths((w) => ({ ...w, [id]: Math.max(70, current + ev.clientX - x0) }))
    }
    const up = (): void => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }

  return (
    <div className="list-pane">
      <div className="list-head">
        <Crumbs />
      </div>
      <div
        className="grid"
        ref={gridRef}
        tabIndex={0}
        onKeyDown={onKeyDown}
        onContextMenu={(e) => {
          if ((e.target as HTMLElement).closest('tbody tr')) return
          e.preventDefault()
          set({ selection: [] })
          onContextMenu(null, e.clientX, e.clientY)
        }}
      >
        {loading && <div className="loading-bar" />}
        <table className="list">
          <colgroup>
            {cols.map((c) => (
              <col key={c.id} style={{ width: widths[c.id] ?? c.width }} />
            ))}
          </colgroup>
          <thead>
            <tr onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); onHeaderContextMenu(e.clientX, e.clientY) }}>
              {cols.map((c) => (
                <th
                  key={c.id}
                  style={{ position: 'sticky', top: 0 }}
                  onClick={() =>
                    set(sortBy === c.id ? { sortDir: (sortDir * -1) as 1 | -1 } : { sortBy: c.id, sortDir: 1 })
                  }
                >
                  {c.label}
                  {sortBy === c.id &&
                    (sortDir === 1 ? (
                      <ChevronUp size={12} className="sort" />
                    ) : (
                      <ChevronDown size={12} className="sort" />
                    ))}
                  <span
                    className="resizer"
                    onMouseDown={(e) => startResize(e, c.id, widths[c.id] ?? c.width)}
                  />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((e) => (
              <tr
                key={e.dn}
                className={`${selSet.has(e.dn.toLowerCase()) ? 'sel' : ''} ${
                  cutSet.has(e.dn.toLowerCase()) ? 'cut' : ''
                }`}
                onMouseDown={(ev) => {
                  if (ev.button === 2 && selSet.has(e.dn.toLowerCase())) return
                  clickRow(ev, e)
                }}
                onDoubleClick={() => onOpen(e)}
                onContextMenu={(ev) => {
                  ev.preventDefault()
                  onContextMenu(e, ev.clientX, ev.clientY)
                }}
              >
                {cols.map((c, ci) =>
                  ci === 0 ? (
                    <td key={c.id} className="name" title={e.dn}>
                      <KindIcon kind={e.kind} />
                      <span className="txt">{c.value(e)}</span>
                      <span className="flags">
                        {e.disabled && <Ban size={13} color="var(--danger)" aria-label="Deshabilitada" />}
                        {e.locked && <Lock size={13} color="var(--warn)" aria-label="Bloqueada" />}
                        {e.expired && <CalendarX size={13} color="var(--warn)" aria-label="Expirada" />}
                      </span>
                    </td>
                  ) : (
                    <td key={c.id} title={c.value(e)}>
                      {c.value(e)}
                    </td>
                  )
                )}
              </tr>
            ))}
          </tbody>
        </table>
        {!loading && !rows.length && (
          <div className="empty-state">
            <Inbox size={44} />
            <div className="title">
              {items.length ? 'Ningún objeto coincide con el filtro' : 'Este contenedor está vacío'}
            </div>
            {!!items.length && <div>Probá con otro texto en la búsqueda rápida.</div>}
          </div>
        )}
      </div>
    </div>
  )
}

function Crumbs(): JSX.Element {
  const view = useApp((s) => s.view)
  const tree = useApp((s) => s.tree)

  if (!view) return <span className="crumbs" />
  if (view.type !== 'container') {
    return (
      <div className="crumbs">
        <span className="crumb last">
          {view.type === 'query' ? view.query.name : view.title}
        </span>
      </div>
    )
  }

  const rootDN = tree[0]?.entry.dn ?? ''
  const rootName = tree[0]?.entry.name ?? ''
  const rest = view.dn.toLowerCase().endsWith(rootDN.toLowerCase())
    ? view.dn.slice(0, Math.max(0, view.dn.length - rootDN.length)).replace(/,\s*$/, '')
    : view.dn
  const parts = rest ? splitDN(rest).reverse() : []

  const crumbs = [{ label: rootName || rootDN, dn: rootDN }]
  parts.forEach((p, k) => {
    const dn = [...parts.slice(0, k + 1)].reverse().concat(rootDN).filter(Boolean).join(',')
    crumbs.push({ label: rdnValue(p), dn })
  })

  return (
    <div className="crumbs">
      {crumbs.map((c, i) => (
        <span key={`${i}-${c.dn}`} style={{ display: 'contents' }}>
          {i > 0 && <ChevronRight size={13} className="sepr" />}
          <span
            className={`crumb ${i === crumbs.length - 1 ? 'last' : ''}`}
            onClick={() => select(c.dn)}
            title={c.dn}
          >
            {c.label}
          </span>
        </span>
      ))}
    </div>
  )
}

export function ListSpinner(): JSX.Element {
  return <Spinner />
}
