import { useState, type JSX } from 'react'
import { ArrowDown, ArrowUp, SlidersHorizontal } from 'lucide-react'
import { Modal } from './ui'
import { COLUMNS } from '../lib/columns'
import { useApp } from '../store'

export default function ColumnsDialog({ onClose }: { onClose: () => void }): JSX.Element {
  const prefs = useApp((s) => s.prefs)
  const set = useApp((s) => s.set)
  const [chosen, setChosen] = useState<string[]>(prefs.columns)

  const move = (i: number, d: -1 | 1): void => {
    const j = i + d
    if (j < 0 || j >= chosen.length) return
    const next = [...chosen]
    ;[next[i], next[j]] = [next[j], next[i]]
    setChosen(next)
  }

  const toggle = (id: string): void => {
    if (id === 'name') return
    setChosen((c) => (c.includes(id) ? c.filter((x) => x !== id) : [...c, id]))
  }

  const save = async (): Promise<void> => {
    const columns = chosen.includes('name') ? chosen : ['name', ...chosen]
    const res = await window.adeep.store.setPrefs({ columns })
    if (res.ok && res.data) set({ prefs: res.data })
    onClose()
  }

  return (
    <Modal
      title="Elegir columnas"
      icon={<SlidersHorizontal size={18} color="var(--accent)" />}
      size="wide"
      onClose={onClose}
      footer={
        <>
          <button
            className="btn ghost"
            style={{ marginRight: 'auto' }}
            onClick={() => setChosen(['name', 'kind', 'description'])}
          >
            Restablecer
          </button>
          <button className="btn" onClick={onClose}>Cancelar</button>
          <button className="btn primary" onClick={() => void save()}>Guardar</button>
        </>
      }
    >
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        <div>
          <div className="lbl" style={{ marginBottom: 6 }}>Disponibles</div>
          <div className="mini-table-wrap" style={{ height: 300, overflow: 'auto' }}>
            <table className="mini">
              <tbody>
                {COLUMNS.filter((c) => !chosen.includes(c.id)).map((c) => (
                  <tr key={c.id} onDoubleClick={() => toggle(c.id)} onClick={() => toggle(c.id)}>
                    <td>{c.label}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        <div>
          <div className="lbl" style={{ marginBottom: 6 }}>Mostradas (en orden)</div>
          <div className="mini-table-wrap" style={{ height: 300, overflow: 'auto' }}>
            <table className="mini">
              <tbody>
                {chosen.map((id, i) => {
                  const col = COLUMNS.find((c) => c.id === id)
                  return (
                    <tr key={id}>
                      <td>{col?.label ?? id}</td>
                      <td style={{ width: 92, textAlign: 'right' }}>
                        <button className="btn ghost icon sm" onClick={() => move(i, -1)} title="Subir">
                          <ArrowUp size={13} />
                        </button>
                        <button className="btn ghost icon sm" onClick={() => move(i, 1)} title="Bajar">
                          <ArrowDown size={13} />
                        </button>
                        <button
                          className="btn ghost icon sm"
                          disabled={id === 'name'}
                          onClick={() => toggle(id)}
                          title="Quitar"
                        >
                          ×
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </Modal>
  )
}
