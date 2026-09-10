import type { DirEntry } from '@shared/types'
import type { TreeNode } from '../store'

export function makeNode(entry: DirEntry): TreeNode {
  return { entry, expanded: false, loading: false }
}

/** Devuelve una copia del árbol con el nodo `dn` reemplazado por `patch`. */
export function patchNode(
  nodes: TreeNode[],
  dn: string,
  patch: (n: TreeNode) => TreeNode
): TreeNode[] {
  const key = dn.toLowerCase()
  let changed = false
  const out = nodes.map((n) => {
    if (n.entry.dn.toLowerCase() === key) {
      changed = true
      return patch(n)
    }
    if (n.children) {
      const kids = patchNode(n.children, dn, patch)
      if (kids !== n.children) {
        changed = true
        return { ...n, children: kids }
      }
    }
    return n
  })
  return changed ? out : nodes
}

export function findNode(nodes: TreeNode[], dn: string): TreeNode | undefined {
  const key = dn.toLowerCase()
  for (const n of nodes) {
    if (n.entry.dn.toLowerCase() === key) return n
    if (n.children) {
      const found = findNode(n.children, dn)
      if (found) return found
    }
  }
  return undefined
}

/** Lista de DNs desde la raíz hasta `dn` (incluido), según los DNs de los nodos raíz. */
export function pathToDN(roots: TreeNode[], dn: string): string[] {
  const rootDN = roots
    .map((r) => r.entry.dn)
    .filter((r) => dn.toLowerCase().endsWith(r.toLowerCase()))
    .sort((a, b) => b.length - a.length)[0]
  if (!rootDN) return []
  const rest = dn.slice(0, Math.max(0, dn.length - rootDN.length)).replace(/,\s*$/, '')
  const parts = rest ? splitTop(rest) : []
  const out: string[] = [rootDN]
  for (let i = parts.length - 1; i >= 0; i--) {
    out.push([...parts.slice(i), rootDN].join(','))
  }
  return out
}

function splitTop(dn: string): string[] {
  const parts: string[] = []
  let cur = ''
  let esc = false
  for (const ch of dn) {
    if (esc) { cur += ch; esc = false; continue }
    if (ch === '\\') { cur += ch; esc = true; continue }
    if (ch === ',') { parts.push(cur.trim()); cur = ''; continue }
    cur += ch
  }
  if (cur.trim()) parts.push(cur.trim())
  return parts
}

/** Aplana el árbol respetando los nodos expandidos, con su profundidad. */
export function flatten(nodes: TreeNode[], depth = 0): { node: TreeNode; depth: number }[] {
  const out: { node: TreeNode; depth: number }[] = []
  for (const n of nodes) {
    out.push({ node: n, depth })
    if (n.expanded && n.children) out.push(...flatten(n.children, depth + 1))
  }
  return out
}
