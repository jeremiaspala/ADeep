import { useEffect, useState, type JSX, type ReactNode } from 'react'
import { ChevronRight } from 'lucide-react'
import type { NodeKind } from '@shared/types'
import { KindIcon } from '../lib/icons'

/** Árbol de datos ya cargados: las consolas nuevas leen todo de una y no paginan. */
export interface TreeItem {
  id: string
  label: string
  kind: NodeKind
  children?: TreeItem[]
  /** Etiqueta corta a la derecha (cantidad de hijos, estado, etc.). */
  badge?: string
  /** Payload para que la consola sepa qué mostrar en el panel derecho. */
  data?: unknown
}

export default function SimpleTree({
  items,
  selectedId,
  onSelect,
  onContextMenu,
  defaultExpanded
}: {
  items: TreeItem[]
  selectedId?: string
  onSelect: (item: TreeItem) => void
  onContextMenu?: (item: TreeItem, x: number, y: number) => void
  defaultExpanded?: string[]
}): JSX.Element {
  const [expanded, setExpanded] = useState<Set<string>>(new Set(defaultExpanded ?? []))

  // Si la selección viene de afuera (un enlace del panel derecho), hay que abrir
  // la rama para que la fila seleccionada sea visible.
  useEffect(() => {
    if (!selectedId) return
    const ruta = pathTo(items, selectedId)
    if (ruta.length < 2) return
    setExpanded((cur) => {
      const faltan = ruta.slice(0, -1).filter((id) => !cur.has(id))
      if (!faltan.length) return cur
      const next = new Set(cur)
      for (const id of faltan) next.add(id)
      return next
    })
  }, [selectedId, items])

  const toggle = (id: string): void =>
    setExpanded((cur) => {
      const next = new Set(cur)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const render = (list: TreeItem[], depth: number): ReactNode =>
    list.map((item) => {
      const hasChildren = !!item.children?.length
      const open = expanded.has(item.id)
      return (
        <div key={item.id}>
          <div
            className={`tree-row ${item.id === selectedId ? 'sel' : ''}`}
            style={{ paddingLeft: 6 + depth * 15 }}
            onClick={() => { onSelect(item); if (hasChildren && !open) toggle(item.id) }}
            onDoubleClick={() => hasChildren && toggle(item.id)}
            onContextMenu={(e) => {
              if (!onContextMenu) return
              e.preventDefault()
              onSelect(item)
              onContextMenu(item, e.clientX, e.clientY)
            }}
            title={item.label}
          >
            <span
              className={`twisty ${open ? 'open' : ''} ${hasChildren ? '' : 'empty'}`}
              onClick={(e) => { e.stopPropagation(); toggle(item.id) }}
            >
              <ChevronRight size={14} />
            </span>
            <KindIcon kind={item.kind} />
            <span className="tree-label">{item.label}</span>
            {item.badge && (
              <span className="hint" style={{ marginLeft: 'auto', paddingLeft: 8, fontSize: 11 }}>
                {item.badge}
              </span>
            )}
          </div>
          {open && hasChildren && render(item.children!, depth + 1)}
        </div>
      )
    })

  return <>{render(items, 0)}</>
}

/** Ids desde la raíz hasta `id`, incluido; vacío si no está. */
export function pathTo(items: TreeItem[], id: string): string[] {
  for (const item of items) {
    if (item.id === id) return [item.id]
    if (item.children?.length) {
      const sub = pathTo(item.children, id)
      if (sub.length) return [item.id, ...sub]
    }
  }
  return []
}

export function findItem(items: TreeItem[], id: string): TreeItem | undefined {
  for (const item of items) {
    if (item.id === id) return item
    const found = item.children && findItem(item.children, id)
    if (found) return found
  }
  return undefined
}
