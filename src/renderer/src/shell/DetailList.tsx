import { useState, type JSX, type ReactNode } from 'react'
import { Inbox } from 'lucide-react'
import type { NodeKind } from '@shared/types'
import { KindIcon } from '../lib/icons'

export interface DetailColumn<T> {
  id: string
  label: string
  width?: number | string
  render: (row: T) => ReactNode
  /** Texto plano para ordenar; si falta, la columna no se ordena. */
  sortValue?: (row: T) => string | number
}

/**
 * Tabla del panel derecho, con el mismo aspecto que la lista de ADUC.
 * Los datos ya vienen cargados, así que ordena en memoria.
 */
export default function DetailList<T>({
  rows,
  columns,
  rowKey,
  rowKind,
  selectedKey,
  onSelect,
  onOpen,
  onContextMenu,
  empty,
  header
}: {
  rows: T[]
  columns: DetailColumn<T>[]
  rowKey: (row: T) => string
  rowKind?: (row: T) => NodeKind
  selectedKey?: string
  onSelect?: (row: T) => void
  onOpen?: (row: T) => void
  onContextMenu?: (row: T, x: number, y: number) => void
  empty?: string
  header?: ReactNode
}): JSX.Element {
  const [sortBy, setSortBy] = useState<string | null>(null)
  const [sortDir, setSortDir] = useState<1 | -1>(1)

  const sorted = (() => {
    const col = columns.find((c) => c.id === sortBy)
    if (!col?.sortValue) return rows
    return [...rows].sort((a, b) => {
      const av = col.sortValue!(a)
      const bv = col.sortValue!(b)
      const c = typeof av === 'number' && typeof bv === 'number'
        ? av - bv
        : String(av).localeCompare(String(bv), 'es', { numeric: true })
      return c * sortDir
    })
  })()

  return (
    <>
      {header && <div className="list-head">{header}</div>}
      <div className="grid">
        <table className="list">
          <colgroup>
            {columns.map((c) => (
              <col key={c.id} style={{ width: c.width }} />
            ))}
          </colgroup>
          <thead>
            <tr>
              {columns.map((c) => (
                <th
                  key={c.id}
                  onClick={() => {
                    if (!c.sortValue) return
                    if (sortBy === c.id) setSortDir((d) => (d === 1 ? -1 : 1))
                    else { setSortBy(c.id); setSortDir(1) }
                  }}
                  style={{ cursor: c.sortValue ? 'pointer' : 'default' }}
                >
                  {c.label}
                  {sortBy === c.id && <span className="sort">{sortDir === 1 ? ' ▲' : ' ▼'}</span>}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.map((row) => {
              const key = rowKey(row)
              return (
                <tr
                  key={key}
                  className={key === selectedKey ? 'sel' : ''}
                  onClick={() => onSelect?.(row)}
                  onDoubleClick={() => onOpen?.(row)}
                  onContextMenu={(e) => {
                    if (!onContextMenu) return
                    e.preventDefault()
                    onSelect?.(row)
                    onContextMenu(row, e.clientX, e.clientY)
                  }}
                >
                  {columns.map((c, i) =>
                    i === 0 && rowKind ? (
                      <td key={c.id} className="name">
                        <KindIcon kind={rowKind(row)} />
                        <span className="txt">{c.render(row)}</span>
                      </td>
                    ) : (
                      <td key={c.id}>{c.render(row)}</td>
                    )
                  )}
                </tr>
              )
            })}
          </tbody>
        </table>
        {!rows.length && (
          <div className="empty-state">
            <Inbox size={40} />
            <div className="title">{empty ?? 'No hay nada para mostrar'}</div>
          </div>
        )}
      </div>
    </>
  )
}
