import { useEffect, useRef, useState, type JSX } from 'react'
import { Search, UserSearch, X } from 'lucide-react'
import type { DirEntry } from '@shared/types'
import { Modal, Spinner } from './ui'
import { KindIcon } from '../lib/icons'
import { dnToCanonical } from '../lib/format'

export type PickKind = 'user' | 'group' | 'computer' | 'contact' | 'ou' | 'gmsa'

const KIND_TEXT: Record<PickKind, string> = {
  user: 'Usuarios',
  group: 'Grupos',
  computer: 'Equipos',
  contact: 'Contactos',
  ou: 'Unidades organizativas',
  gmsa: 'Cuentas de servicio'
}

export default function Picker({
  title = 'Seleccionar objetos',
  kinds,
  multiple = true,
  baseDN,
  onCancel,
  onConfirm
}: {
  title?: string
  kinds: PickKind[]
  multiple?: boolean
  baseDN?: string
  onCancel: () => void
  onConfirm: (entries: DirEntry[]) => void
}): JSX.Element {
  const [text, setText] = useState('')
  const [results, setResults] = useState<DirEntry[]>([])
  const [chosen, setChosen] = useState<DirEntry[]>([])
  const [busy, setBusy] = useState(false)
  const [searched, setSearched] = useState(false)
  const seq = useRef(0)
  const kindsKey = kinds.join(',')

  useEffect(() => {
    const q = text.trim()
    if (q.length < 2) { setResults([]); setSearched(false); return }
    const id = ++seq.current
    const t = setTimeout(async () => {
      setBusy(true)
      const res = await window.adeep.search.pick(q, kindsKey.split(','), baseDN)
      if (id !== seq.current) return
      setBusy(false)
      setSearched(true)
      setResults(res.ok ? (res.data ?? []) : [])
    }, 250)
    return () => clearTimeout(t)
  }, [text, baseDN, kindsKey])

  const toggle = (e: DirEntry): void => {
    if (!multiple) { setChosen([e]); return }
    setChosen((cur) =>
      cur.some((c) => c.dn === e.dn) ? cur.filter((c) => c.dn !== e.dn) : [...cur, e]
    )
  }

  return (
    <Modal
      title={title}
      subtitle={kinds.map((k) => KIND_TEXT[k]).join(', ')}
      icon={<UserSearch size={18} color="var(--accent)" />}
      size="wide"
      onClose={onCancel}
      footer={
        <>
          <span className="hint" style={{ marginRight: 'auto' }}>
            {chosen.length ? `${chosen.length} seleccionado${chosen.length === 1 ? '' : 's'}` : ''}
          </span>
          <button className="btn" onClick={onCancel}>Cancelar</button>
          <button className="btn primary" disabled={!chosen.length} onClick={() => onConfirm(chosen)}>
            Aceptar
          </button>
        </>
      }
    >
      <div className="toolbar" style={{ height: 'auto', padding: 0, background: 'none', border: 0, marginBottom: 10 }}>
        <div className="search" style={{ width: '100%', margin: 0 }}>
          <Search size={14} />
          <input
            type="search"
            value={text}
            autoFocus
            placeholder="Nombre, cuenta, UPN o correo…"
            onChange={(e) => setText(e.target.value)}
          />
        </div>
      </div>

      {!!chosen.length && (
        <div className="chips" style={{ marginBottom: 10 }}>
          {chosen.map((c) => (
            <span key={c.dn} className="picker-chip">
              <KindIcon kind={c.kind} size={13} />
              {c.name}
              <button onClick={() => toggle(c)} aria-label="Quitar">
                <X size={12} />
              </button>
            </span>
          ))}
        </div>
      )}

      <div className="mini-table-wrap picker-results">
        <table className="mini">
          <thead>
            <tr>
              <th style={{ width: '38%' }}>Nombre</th>
              <th style={{ width: '22%' }}>Cuenta</th>
              <th>Ubicación</th>
            </tr>
          </thead>
          <tbody>
            {results.map((r) => (
              <tr
                key={r.dn}
                className={chosen.some((c) => c.dn === r.dn) ? 'sel' : ''}
                onClick={() => toggle(r)}
                onDoubleClick={() => onConfirm([r])}
              >
                <td>
                  <span className="row" style={{ gap: 6 }}>
                    <KindIcon kind={r.kind} size={14} />
                    {r.name}
                  </span>
                </td>
                <td>{r.attrs?.sAMAccountName?.[0] ?? ''}</td>
                <td title={r.dn}>{dnToCanonical(r.dn)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {busy && <div className="row" style={{ padding: 12, gap: 8 }}><Spinner /> Buscando…</div>}
        {!busy && searched && !results.length && (
          <div className="empty-state" style={{ height: 160 }}>
            <div className="title">Sin resultados</div>
          </div>
        )}
        {!busy && !searched && (
          <div className="empty-state" style={{ height: 160 }}>
            <div>Escribí al menos 2 caracteres para buscar.</div>
          </div>
        )}
      </div>
    </Modal>
  )
}
