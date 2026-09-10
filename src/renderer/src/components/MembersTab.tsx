import { useEffect, useState, type JSX } from 'react'
import { Plus, Minus, Star } from 'lucide-react'
import type { AppResult, DirEntry, GroupMembership } from '@shared/types'
import { Spinner } from './ui'
import Picker, { type PickKind } from './Picker'
import { report } from '../store'
import { KindIcon } from '../lib/icons'
import { dnToCanonical } from '../lib/format'

const MEMBER_KINDS: PickKind[] = ['user', 'group', 'computer', 'contact', 'gmsa']
const GROUP_KINDS: PickKind[] = ['group']

export default function MembersTab({
  dn,
  mode,
  canSetPrimary
}: {
  dn: string
  mode: 'members' | 'memberOf'
  canSetPrimary: boolean
}): JSX.Element {
  const [rows, setRows] = useState<(DirEntry | GroupMembership)[]>([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<string[]>([])
  const [picker, setPicker] = useState(false)
  const [busy, setBusy] = useState(false)

  const load = async (): Promise<void> => {
    setLoading(true)
    const res: AppResult<(DirEntry | GroupMembership)[]> =
      mode === 'members'
        ? await window.adeep.group.members(dn)
        : await window.adeep.group.memberOf(dn)
    setLoading(false)
    const data = report(res)
    if (data) setRows(data)
    setSelected([])
  }

  useEffect(() => { void load() }, [dn, mode])

  const add = async (entries: DirEntry[]): Promise<void> => {
    setPicker(false)
    setBusy(true)
    const res = mode === 'members'
      ? await window.adeep.group.addMembers(dn, entries.map((e) => e.dn))
      : await window.adeep.group.addTo(dn, entries.map((e) => e.dn))
    setBusy(false)
    if (report(res, 'Agregado') !== undefined) await load()
  }

  const remove = async (): Promise<void> => {
    if (!selected.length) return
    setBusy(true)
    const res = mode === 'members'
      ? await window.adeep.group.removeMembers(dn, selected)
      : await window.adeep.group.removeFrom(dn, selected)
    setBusy(false)
    if (report(res, 'Quitado') !== undefined) await load()
  }

  const setPrimary = async (): Promise<void> => {
    if (selected.length !== 1) return
    setBusy(true)
    const res = await window.adeep.group.setPrimary(dn, selected[0])
    setBusy(false)
    if (report(res, 'Grupo principal actualizado') !== undefined) await load()
  }

  const isPrimary = (r: DirEntry | GroupMembership): boolean =>
    'primary' in r && r.primary === true

  return (
    <div className="col" style={{ gap: 10, padding: 16, minHeight: 0 }}>
      <div className="row" style={{ gap: 6 }}>
        <button className="btn sm" onClick={() => setPicker(true)} disabled={busy}>
          <Plus size={13} /> Agregar
        </button>
        <button className="btn sm" onClick={() => void remove()} disabled={busy || !selected.length}>
          <Minus size={13} /> Quitar
        </button>
        {mode === 'memberOf' && canSetPrimary && (
          <button
            className="btn sm"
            onClick={() => void setPrimary()}
            disabled={busy || selected.length !== 1}
            title="Establecer como grupo principal"
          >
            <Star size={13} /> Grupo principal
          </button>
        )}
        {busy && <Spinner size={14} />}
        <div className="spacer" style={{ flex: 1 }} />
        <span className="hint">{rows.length} elemento(s)</span>
      </div>

      <div className="mini-table-wrap" style={{ flex: 1, minHeight: 280, overflow: 'auto' }}>
        <table className="mini">
          <thead>
            <tr>
              <th style={{ width: '38%' }}>Nombre</th>
              <th>Ubicación</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr
                key={r.dn}
                className={selected.includes(r.dn) ? 'sel' : ''}
                onClick={(e) =>
                  setSelected((cur) =>
                    e.ctrlKey || e.metaKey
                      ? cur.includes(r.dn) ? cur.filter((d) => d !== r.dn) : [...cur, r.dn]
                      : [r.dn]
                  )
                }
              >
                <td>
                  <span className="row" style={{ gap: 6 }}>
                    <KindIcon kind={r.kind} size={14} />
                    {r.name}
                    {isPrimary(r) && <span className="badge accent">Principal</span>}
                  </span>
                </td>
                <td title={r.dn}>{dnToCanonical(r.dn)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {loading && <div className="row" style={{ gap: 8, padding: 12 }}><Spinner /> Cargando…</div>}
        {!loading && !rows.length && (
          <div className="empty-state" style={{ height: 180 }}>
            <div className="title">
              {mode === 'members' ? 'El grupo no tiene miembros' : 'No pertenece a ningún grupo'}
            </div>
          </div>
        )}
      </div>

      {mode === 'memberOf' && (
        <div className="hint">
          El grupo principal no aparece en <span className="mono">memberOf</span>; se muestra igual con la etiqueta Principal.
        </div>
      )}

      {picker && (
        <Picker
          title={mode === 'members' ? 'Agregar miembros' : 'Agregar a grupos'}
          kinds={mode === 'members' ? MEMBER_KINDS : GROUP_KINDS}
          onCancel={() => setPicker(false)}
          onConfirm={(entries) => void add(entries)}
        />
      )}
    </div>
  )
}
