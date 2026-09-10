import { useEffect, useRef, type JSX } from 'react'
import { ChevronRight, Network } from 'lucide-react'
import type { DirEntry } from '@shared/types'
import { useApp } from '../store'
import { flatten } from '../lib/tree'
import { collapseNode, expandNode, select, toggleNode, visibleNodes } from '../lib/treeActions'
import { KindIcon } from '../lib/icons'
import { Spinner } from './ui'

export default function TreePane({
  onContextMenu
}: {
  onContextMenu: (entry: DirEntry, x: number, y: number) => void
}): JSX.Element {
  const tree = useApp((s) => s.tree)
  const loading = useApp((s) => s.treeLoading)
  const selectedDN = useApp((s) => s.selectedDN)
  const ref = useRef<HTMLDivElement>(null)

  const rows = flatten(tree)

  // Mantiene visible el nodo seleccionado cuando se navega desde la lista.
  useEffect(() => {
    if (!selectedDN) return
    const el = ref.current?.querySelector<HTMLElement>('[data-sel="1"]')
    el?.scrollIntoView({ block: 'nearest' })
  }, [selectedDN, rows.length])

  const onKeyDown = (e: React.KeyboardEvent): void => {
    if (!selectedDN) return
    const list = visibleNodes()
    const i = list.findIndex((n) => n.dn === selectedDN)
    if (i < 0) return
    const cur = list[i]
    if (e.key === 'ArrowDown' && list[i + 1]) { e.preventDefault(); select(list[i + 1].dn) }
    else if (e.key === 'ArrowUp' && list[i - 1]) { e.preventDefault(); select(list[i - 1].dn) }
    else if (e.key === 'ArrowRight') {
      e.preventDefault()
      if (!cur.expanded) void expandNode(cur.dn)
      else if (list[i + 1]?.depth > cur.depth) select(list[i + 1].dn)
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault()
      if (cur.expanded) collapseNode(cur.dn)
      else {
        for (let j = i - 1; j >= 0; j--) {
          if (list[j].depth < cur.depth) { select(list[j].dn); break }
        }
      }
    }
  }

  return (
    <div className="tree-pane">
      <div className="pane-head">
        <Network size={13} />
        <span>Directorio</span>
        {loading && <Spinner size={12} />}
      </div>
      <div className="tree" ref={ref} tabIndex={0} onKeyDown={onKeyDown}>
        {rows.map(({ node, depth }) => {
          const sel = node.entry.dn === selectedDN
          return (
            <div
              key={node.entry.dn}
              data-sel={sel ? '1' : undefined}
              className={`tree-row ${sel ? 'sel' : ''}`}
              style={{ paddingLeft: 6 + depth * 15 }}
              onClick={() => select(node.entry.dn)}
              onDoubleClick={() => void toggleNode(node.entry.dn)}
              onContextMenu={(e) => {
                e.preventDefault()
                select(node.entry.dn)
                onContextMenu(node.entry, e.clientX, e.clientY)
              }}
              title={node.entry.dn}
            >
              <span
                className={`twisty ${node.expanded ? 'open' : ''} ${
                  node.entry.isContainer ? '' : 'empty'
                }`}
                onClick={(e) => { e.stopPropagation(); void toggleNode(node.entry.dn) }}
              >
                {node.loading ? <Spinner size={12} /> : <ChevronRight size={14} />}
              </span>
              <KindIcon kind={node.entry.kind} />
              <span className="tree-label">{node.entry.name}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
