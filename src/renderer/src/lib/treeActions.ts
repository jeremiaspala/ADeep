import type { DirEntry } from '@shared/types'
import { useApp } from '../store'
import { findNode, flatten, makeNode, patchNode, pathToDN } from './tree'

const api = (): typeof window.adeep => window.adeep

export async function loadRoots(): Promise<void> {
  const s = useApp.getState()
  s.set({ treeLoading: true })
  const res = await api().dir.roots()
  if (!res.ok) {
    s.set({ treeLoading: false })
    s.toast('error', res.error ?? 'No se pudo leer el directorio')
    return
  }
  const roots = (res.data ?? []).map(makeNode)
  s.set({ tree: roots, treeLoading: false })
  if (roots[0]) {
    await expandNode(roots[0].entry.dn)
    select(roots[0].entry.dn)
  }
}

/** Carga (o recarga) los hijos de `dn`. */
export async function loadChildren(dn: string, force = false): Promise<void> {
  const s = useApp.getState()
  const node = findNode(s.tree, dn)
  if (!node) return
  if (node.children && !force) return

  s.set({ tree: patchNode(s.tree, dn, (n) => ({ ...n, loading: true })) })
  const res = await api().dir.children(dn, useApp.getState().prefs.showAdvancedFeatures)
  const cur = useApp.getState()
  if (!res.ok) {
    cur.set({ tree: patchNode(cur.tree, dn, (n) => ({ ...n, loading: false, children: [] })) })
    cur.toast('error', res.error ?? 'No se pudieron leer los subcontenedores')
    return
  }
  const incoming = res.data ?? []
  cur.set({
    tree: patchNode(cur.tree, dn, (n) => {
      // Conserva el estado de expansión de los hijos que siguen existiendo.
      const prev = new Map((n.children ?? []).map((c) => [c.entry.dn.toLowerCase(), c]))
      const children = incoming.map((e) => {
        const old = prev.get(e.dn.toLowerCase())
        return old ? { ...old, entry: e } : makeNode(e)
      })
      return { ...n, loading: false, children }
    })
  })
}

export async function expandNode(dn: string): Promise<void> {
  await loadChildren(dn)
  const s = useApp.getState()
  s.set({ tree: patchNode(s.tree, dn, (n) => ({ ...n, expanded: true })) })
}

export function collapseNode(dn: string): void {
  const s = useApp.getState()
  s.set({ tree: patchNode(s.tree, dn, (n) => ({ ...n, expanded: false })) })
}

export async function toggleNode(dn: string): Promise<void> {
  const node = findNode(useApp.getState().tree, dn)
  if (!node) return
  if (node.expanded) collapseNode(dn)
  else await expandNode(dn)
}

/** Expande el árbol hasta `dn` y lo selecciona. */
export async function revealDN(dn: string): Promise<void> {
  const s = useApp.getState()
  const path = pathToDN(s.tree, dn)
  for (const step of path.slice(0, -1)) await expandNode(step)
  if (path.length) select(dn)
}

/** Navega al contenedor padre y deja el objeto seleccionado en la lista. */
export async function revealObject(dn: string): Promise<void> {
  const res = await api().dir.parent(dn)
  const parent = res.ok ? res.data : undefined
  if (!parent) return
  await revealDN(parent)
  useApp.getState().set({ selection: [dn], lastClickedDN: dn })
}

export function select(dn: string): void {
  const s = useApp.getState()
  s.set({ selectedDN: dn, view: { type: 'container', dn }, selection: [], lastClickedDN: null })
  void loadList(dn)
}

/** Carga el contenido del contenedor en el panel derecho. */
export async function loadList(dn: string, extraFilter?: string): Promise<void> {
  const s = useApp.getState()
  s.set({ itemsLoading: true, items: [] })
  const { showAdvancedFeatures, maxItems } = s.prefs
  const filter = (extraFilter ?? s.listFilter) || undefined
  const res = await api().dir.list(dn, showAdvancedFeatures, filter, maxItems)
  const cur = useApp.getState()
  // Otra navegación ganó la carrera.
  if (cur.view?.type !== 'container' || cur.view.dn !== dn) return
  if (!res.ok) {
    cur.set({ itemsLoading: false, statusText: '' })
    cur.toast('error', res.error ?? 'No se pudo listar el contenedor')
    return
  }
  const items = res.data ?? []
  cur.set({
    items,
    itemsLoading: false,
    statusText:
      items.length >= maxItems
        ? `${items.length} objetos (límite alcanzado)`
        : `${items.length} objeto${items.length === 1 ? '' : 's'}`
  })
}

/** Aplica (o quita) el filtro LDAP de la vista de lista. */
export function applyListFilter(filter: string): void {
  const s = useApp.getState()
  s.set({ listFilter: filter })
  if (s.selectedDN) void loadList(s.selectedDN, filter || undefined)
  else s.toast('warn', 'Elegí un contenedor en el árbol.')
}

export function showResults(title: string, entries: DirEntry[]): void {
  const s = useApp.getState()
  s.set({
    view: { type: 'results', title, entries },
    items: entries,
    selection: [],
    itemsLoading: false,
    statusText: `${entries.length} resultado${entries.length === 1 ? '' : 's'}`
  })
}

/** Refresca el nodo del árbol y, si corresponde, la lista. */
export async function refresh(dn?: string): Promise<void> {
  const s = useApp.getState()
  const target = dn ?? s.selectedDN
  if (!target) return
  if (findNode(s.tree, target)) await loadChildren(target, true)
  const v = useApp.getState().view
  if (v?.type === 'container' && v.dn === target) await loadList(target)
}

/** Refresca el padre de un DN (tras crear/mover/borrar). */
export async function refreshParent(dn: string): Promise<void> {
  const res = await api().dir.parent(dn)
  if (res.ok && res.data) await refresh(res.data)
}

/** Nodos visibles del árbol en orden, para navegación con teclado. */
export function visibleNodes(): { dn: string; depth: number; expanded: boolean; isContainer: boolean }[] {
  return flatten(useApp.getState().tree).map(({ node, depth }) => ({
    dn: node.entry.dn,
    depth,
    expanded: node.expanded,
    isContainer: node.entry.isContainer
  }))
}
