import type { DirEntry } from '@shared/types'
import { useApp, report } from '../store'
import { refresh, refreshParent } from './treeActions'
import { columnValue } from './columns'
import { isDescendant, rdnValue } from './format'

const api = (): typeof window.adeep => window.adeep

export function selectedEntries(): DirEntry[] {
  const { items, selection } = useApp.getState()
  const sel = new Set(selection.map((d) => d.toLowerCase()))
  return items.filter((i) => sel.has(i.dn.toLowerCase()))
}

export async function setEnabled(dns: string[], enabled: boolean): Promise<void> {
  if (!dns.length) return
  const res = await api().obj.setEnabled(dns, enabled)
  if (report(res, enabled ? 'Cuenta(s) habilitada(s)' : 'Cuenta(s) deshabilitada(s)') !== undefined) {
    await refresh()
  }
}

export async function unlock(dns: string[]): Promise<void> {
  if (!dns.length) return
  const res = await api().obj.unlock(dns)
  if (report(res, 'Cuenta(s) desbloqueada(s)') !== undefined) await refresh()
}

export async function deleteObjects(
  entries: DirEntry[],
  confirmFn: (o: { title: string; message: string; detail?: string; danger?: boolean; confirmLabel?: string }) => Promise<boolean>
): Promise<void> {
  if (!entries.length) return
  const { prefs, toast } = useApp.getState()
  const containers = entries.filter((e) => e.isContainer)

  if (prefs.confirmDelete) {
    const ok = await confirmFn({
      title: entries.length === 1 ? 'Eliminar objeto' : `Eliminar ${entries.length} objetos`,
      message:
        entries.length === 1
          ? `¿Eliminar "${entries[0].name}"? Esta acción no se puede deshacer.`
          : `¿Eliminar ${entries.length} objetos? Esta acción no se puede deshacer.`,
      detail: entries.slice(0, 12).map((e) => e.dn).join('\n') + (entries.length > 12 ? '\n…' : ''),
      danger: true,
      confirmLabel: 'Eliminar'
    })
    if (!ok) return
  }

  let tree = false
  if (containers.length) {
    tree = await confirmFn({
      title: 'Eliminar contenedores',
      message:
        containers.length === 1
          ? `"${containers[0].name}" puede contener objetos. ¿Eliminar también todo su contenido?`
          : `${containers.length} contenedores pueden tener objetos dentro. ¿Eliminar también su contenido?`,
      detail: 'Se usa el control LDAP Tree Delete.',
      danger: true,
      confirmLabel: 'Eliminar el árbol'
    })
  }

  const res = await api().obj.delete(entries.map((e) => e.dn), tree)
  const data = report(res)
  if (!data) return
  const failed = data.filter((r) => r.error)
  if (failed.length) {
    toast('error', `No se pudieron eliminar ${failed.length} objeto(s): ${failed[0].error}`)
  }
  const okCount = data.length - failed.length
  if (okCount) toast('ok', `${okCount} objeto(s) eliminado(s)`)
  await refresh()
}

export async function moveObjects(dns: string[], targetDN: string): Promise<boolean> {
  const { toast } = useApp.getState()
  const bad = dns.find((d) => isDescendant(targetDN, d))
  if (bad) {
    toast('error', 'No se puede mover un contenedor dentro de sí mismo.')
    return false
  }
  const res = await api().obj.move(dns, targetDN)
  const data = report(res)
  if (!data) return false
  const failed = data.filter((r) => r.error)
  if (failed.length) toast('error', `${failed.length} objeto(s) no se movieron: ${failed[0].error}`)
  const okCount = data.length - failed.length
  if (okCount) toast('ok', `${okCount} objeto(s) movido(s)`)
  await refreshParent(dns[0])
  await refresh(targetDN)
  return failed.length === 0
}

export async function renameObject(dn: string, newName: string): Promise<void> {
  const res = await api().obj.rename(dn, newName)
  if (report(res, 'Objeto renombrado') !== undefined) await refreshParent(dn)
}

export async function exportSelectionCsv(entries: DirEntry[]): Promise<void> {
  const { prefs, toast } = useApp.getState()
  if (!entries.length) return
  const cols = prefs.columns
  const rows = [cols, ...entries.map((e) => cols.map((c) => columnValue(e, c)))]
  const res = await api().app.exportCsv(rows, 'adeep-export.csv')
  const path = report(res)
  if (path) toast('ok', `Exportado a ${path}`)
}

export async function exportSelectionLdif(entries: DirEntry[]): Promise<void> {
  const { toast } = useApp.getState()
  if (!entries.length) return
  const full = await api().search.byDN(entries.map((e) => e.dn))
  const detailed = full.ok ? (full.data ?? []) : entries
  const payload = detailed.map((e) => ({ dn: e.dn, attrs: e.attrs ?? {} }))
  const res = await api().app.exportLdif(payload, 'adeep-export.ldif')
  const path = report(res)
  if (path) toast('ok', `Exportado a ${path}`)
}

export async function copyText(text: string, label = 'Copiado al portapapeles'): Promise<void> {
  const res = await api().app.copy(text)
  report(res, label)
}

/** Nombre corto para títulos de diálogo. */
export function shortName(entry: { name?: string; dn: string }): string {
  return entry.name ?? rdnValue(entry.dn)
}
