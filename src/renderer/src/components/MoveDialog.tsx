import { useEffect, useState, type JSX } from 'react'
import { ChevronRight, MoveRight } from 'lucide-react'
import type { DirEntry } from '@shared/types'
import { Modal, Spinner } from './ui'
import { KindIcon } from '../lib/icons'
import { moveObjects } from '../lib/objectActions'
import { dnToCanonical, isDescendant } from '../lib/format'

interface Node {
  entry: DirEntry
  children?: Node[]
  expanded: boolean
  loading: boolean
}

export default function MoveDialog({
  dns,
  onClose,
  onMoved
}: {
  dns: string[]
  onClose: () => void
  onMoved: () => void
}): JSX.Element {
  const [nodes, setNodes] = useState<Node[]>([])
  const [target, setTarget] = useState<string>('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    void (async () => {
      const res = await window.adeep.dir.roots()
      const roots = (res.data ?? []).map((e) => ({ entry: e, expanded: false, loading: false }))
      setNodes(roots)
      if (roots[0]) await expand(roots[0].entry.dn, roots, setNodes)
    })()
  }, [])

  const toggle = async (dn: string): Promise<void> => {
    const found = find(nodes, dn)
    if (!found) return
    if (found.expanded) setNodes((ns) => patch(ns, dn, (n) => ({ ...n, expanded: false })))
    else await expand(dn, nodes, setNodes)
  }

  const move = async (): Promise<void> => {
    if (!target) return
    setBusy(true)
    const ok = await moveObjects(dns, target)
    setBusy(false)
    if (ok) onMoved()
  }

  const invalid = !target || dns.some((d) => isDescendant(target, d))

  return (
    <Modal
      title={dns.length === 1 ? 'Mover objeto' : `Mover ${dns.length} objetos`}
      subtitle="Elegí el contenedor de destino"
      icon={<MoveRight size={18} color="var(--accent)" />}
      onClose={onClose}
      footer={
        <>
          <span className="hint truncate" style={{ marginRight: 'auto', maxWidth: 320 }}>
            {target ? dnToCanonical(target) : 'Ningún destino seleccionado'}
          </span>
          <button className="btn" onClick={onClose}>Cancelar</button>
          <button className="btn primary" disabled={invalid || busy} onClick={() => void move()}>
            {busy && <Spinner size={14} />} Mover
          </button>
        </>
      }
    >
      <div className="mini-table-wrap" style={{ height: 340, overflow: 'auto', padding: '4px 0' }}>
        {!nodes.length && <div className="row" style={{ gap: 8, padding: 12 }}><Spinner /> Cargando…</div>}
        {flat(nodes).map(({ node, depth }) => (
          <div
            key={node.entry.dn}
            className={`tree-row ${target === node.entry.dn ? 'sel' : ''}`}
            style={{ paddingLeft: 6 + depth * 15 }}
            onClick={() => setTarget(node.entry.dn)}
            onDoubleClick={() => void toggle(node.entry.dn)}
          >
            <span
              className={`twisty ${node.expanded ? 'open' : ''} ${node.entry.isContainer ? '' : 'empty'}`}
              onClick={(e) => { e.stopPropagation(); void toggle(node.entry.dn) }}
            >
              {node.loading ? <Spinner size={12} /> : <ChevronRight size={14} />}
            </span>
            <KindIcon kind={node.entry.kind} />
            <span className="tree-label">{node.entry.name}</span>
          </div>
        ))}
      </div>
      {target && dns.some((d) => isDescendant(target, d)) && (
        <div className="error-text" style={{ marginTop: 8 }}>
          El destino está dentro de uno de los objetos a mover.
        </div>
      )}
    </Modal>
  )
}

async function expand(
  dn: string,
  nodes: Node[],
  setNodes: (fn: (n: Node[]) => Node[]) => void
): Promise<void> {
  const found = find(nodes, dn)
  if (found?.children) {
    setNodes((ns) => patch(ns, dn, (n) => ({ ...n, expanded: true })))
    return
  }
  setNodes((ns) => patch(ns, dn, (n) => ({ ...n, loading: true })))
  const res = await window.adeep.dir.children(dn, true)
  setNodes((ns) =>
    patch(ns, dn, (n) => ({
      ...n,
      loading: false,
      expanded: true,
      children: (res.data ?? []).map((e) => ({ entry: e, expanded: false, loading: false }))
    }))
  )
}

function find(nodes: Node[], dn: string): Node | undefined {
  for (const n of nodes) {
    if (n.entry.dn === dn) return n
    const f = n.children && find(n.children, dn)
    if (f) return f
  }
  return undefined
}

function patch(nodes: Node[], dn: string, fn: (n: Node) => Node): Node[] {
  return nodes.map((n) =>
    n.entry.dn === dn
      ? fn(n)
      : n.children
        ? { ...n, children: patch(n.children, dn, fn) }
        : n
  )
}

function flat(nodes: Node[], depth = 0): { node: Node; depth: number }[] {
  const out: { node: Node; depth: number }[] = []
  for (const n of nodes) {
    out.push({ node: n, depth })
    if (n.expanded && n.children) out.push(...flat(n.children, depth + 1))
  }
  return out
}
