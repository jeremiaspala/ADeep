import { create } from 'zustand'
import type { DirEntry, Preferences, SavedQuery, SessionInfo } from '@shared/types'

export type ToastKind = 'info' | 'ok' | 'warn' | 'error'

export interface Toast {
  id: number
  kind: ToastKind
  message: string
}

export interface TreeNode {
  entry: DirEntry
  children?: TreeNode[]
  expanded: boolean
  loading: boolean
}

/** Vista activa del panel derecho. */
export type ViewMode = { type: 'container'; dn: string } | { type: 'query'; query: SavedQuery } | { type: 'results'; title: string; entries: DirEntry[] }

interface AppState {
  session: SessionInfo
  prefs: Preferences
  theme: 'light' | 'dark'

  tree: TreeNode[]
  treeLoading: boolean
  selectedDN: string | null

  view: ViewMode | null
  items: DirEntry[]
  itemsLoading: boolean
  selection: string[]
  lastClickedDN: string | null
  listFilter: string
  quickFilter: string
  sortBy: string
  sortDir: 1 | -1

  clipboard: { dns: string[]; op: 'cut' | 'copy' } | null
  queries: SavedQuery[]
  toasts: Toast[]
  statusText: string

  set: (patch: Partial<AppState>) => void
  toast: (kind: ToastKind, message: string) => void
  dismissToast: (id: number) => void
}

export const useApp = create<AppState>((set) => ({
  session: { connected: false },
  prefs: {
    theme: 'system',
    showAdvancedFeatures: false,
    showUsersGroupsAsContainers: false,
    maxItems: 2000,
    columns: ['name', 'kind', 'description'],
    language: 'es',
    confirmDelete: true,
    density: 'comfortable',
    hardwareAcceleration: false
  },
  theme: 'light',

  tree: [],
  treeLoading: false,
  selectedDN: null,

  view: null,
  items: [],
  itemsLoading: false,
  selection: [],
  lastClickedDN: null,
  listFilter: '',
  quickFilter: '',
  sortBy: 'name',
  sortDir: 1,

  clipboard: null,
  queries: [],
  toasts: [],
  statusText: '',

  set: (patch) => set(patch),
  toast: (kind, message) =>
    set((s) => ({ toasts: [...s.toasts, { id: Date.now() + Math.random(), kind, message }] })),
  dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }))
}))

/** Atajo: notifica un error de AppResult y devuelve si fue exitoso. */
export function report<T>(res: { ok: boolean; data?: T; error?: string }, okMessage?: string): T | undefined {
  const { toast } = useApp.getState()
  if (!res.ok) {
    toast('error', res.error ?? 'Error desconocido')
    return undefined
  }
  if (okMessage) toast('ok', okMessage)
  return res.data
}
