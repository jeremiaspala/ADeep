import { useEffect, useMemo, useState, type JSX } from 'react'
import { Filter, PencilLine, Eraser } from 'lucide-react'
import type { AttributeValue, Modification } from '@shared/types'
import { Check2, Modal, Spinner, Text } from './ui'
import { report } from '../store'
import { copyText } from '../lib/objectActions'

export default function AttributeEditor({
  dn,
  onChanged
}: {
  dn: string
  onChanged: () => void
}): JSX.Element {
  const [attrs, setAttrs] = useState<AttributeValue[]>([])
  const [loading, setLoading] = useState(true)
  const [operational, setOperational] = useState(false)
  const [onlySet, setOnlySet] = useState(true)
  const [filter, setFilter] = useState('')
  const [editing, setEditing] = useState<AttributeValue | null>(null)

  const load = async (): Promise<void> => {
    setLoading(true)
    const res = await window.adeep.dir.attributes(dn, operational)
    setLoading(false)
    const data = report(res)
    if (data) setAttrs(data)
  }

  useEffect(() => { void load() }, [dn, operational])

  const rows = useMemo(() => {
    const q = filter.trim().toLowerCase()
    return attrs
      .filter((a) => (onlySet ? a.values.length > 0 : true))
      .filter((a) => (q ? a.name.toLowerCase().includes(q) || a.values.join(' ').toLowerCase().includes(q) : true))
      .sort((a, b) => a.name.localeCompare(b.name, 'es'))
  }, [attrs, filter, onlySet])

  const apply = async (attr: AttributeValue, values: string[]): Promise<void> => {
    const clean = values.map((v) => v.trim()).filter((v) => v.length > 0)
    const mod: Modification = clean.length
      ? { op: 'replace', attribute: attr.name, values: clean, base64: attr.isBinary }
      : { op: 'delete', attribute: attr.name, values: [] }
    const res = await window.adeep.obj.modify(dn, [mod])
    if (report(res, `${attr.name} actualizado`) !== undefined) {
      setEditing(null)
      await load()
      onChanged()
    }
  }

  return (
    <div className="col" style={{ gap: 10, padding: 16, minHeight: 0 }}>
      <div className="attr-toolbar">
        <div className="search" style={{ position: 'relative', flex: 1 }}>
          <Filter size={14} style={{ position: 'absolute', left: 9, top: 8, color: 'var(--text-faint)' }} />
          <input
            type="search"
            value={filter}
            placeholder="Filtrar atributos…"
            style={{ paddingLeft: 29 }}
            onChange={(e) => setFilter(e.target.value)}
          />
        </div>
        <Check2 label="Sólo con valor" checked={onlySet} onChange={setOnlySet} />
        <Check2 label="Operacionales" checked={operational} onChange={setOperational} />
      </div>

      <div className="mini-table-wrap" style={{ flex: 1, minHeight: 300, overflow: 'auto' }}>
        <table className="mini">
          <thead>
            <tr>
              <th style={{ width: '32%' }}>Atributo</th>
              <th>Valor</th>
              <th style={{ width: 76 }}></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((a) => (
              <tr key={a.name} onDoubleClick={() => !a.readOnly && setEditing(a)}>
                <td title={a.syntax}>{a.name}</td>
                <td
                  className={`attr-value ${a.values.length ? 'set' : ''}`}
                  title={a.values.join('\n')}
                  onClick={() => a.values.length && void copyText(a.values.join('\n'))}
                >
                  {a.values.length ? a.values.join(' ; ') : '<no establecido>'}
                </td>
                <td style={{ textAlign: 'right' }}>
                  <button
                    className="btn sm ghost icon"
                    title="Editar"
                    disabled={a.readOnly}
                    onClick={() => setEditing(a)}
                  >
                    <PencilLine size={13} />
                  </button>
                  <button
                    className="btn sm ghost icon"
                    title="Borrar valor"
                    disabled={a.readOnly || !a.values.length}
                    onClick={() => void apply(a, [])}
                  >
                    <Eraser size={13} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {loading && <div className="row" style={{ gap: 8, padding: 12 }}><Spinner /> Leyendo atributos…</div>}
      </div>

      <div className="hint">{rows.length} atributo(s). Doble clic para editar; clic en el valor para copiarlo.</div>

      {editing && (
        <ValueEditor
          attr={editing}
          onCancel={() => setEditing(null)}
          onSave={(values) => void apply(editing, values)}
        />
      )}
    </div>
  )
}

function ValueEditor({
  attr,
  onCancel,
  onSave
}: {
  attr: AttributeValue
  onCancel: () => void
  onSave: (values: string[]) => void
}): JSX.Element {
  const initial = attr.isBinary ? (attr.raw ?? []) : attr.values
  const [text, setText] = useState(initial.join('\n'))
  const single = attr.singleValued

  return (
    <Modal
      title={attr.name}
      subtitle={`${attr.syntax ?? 'Cadena'}${single ? ' · valor único' : ' · multivaluado'}${attr.isBinary ? ' · binario (base64)' : ''}`}
      onClose={onCancel}
      footer={
        <>
          <div className="spacer" style={{ flex: 1 }} />
          <button className="btn" onClick={onCancel}>Cancelar</button>
          <button
            className="btn primary"
            onClick={() => onSave(text.split('\n'))}
          >
            Guardar
          </button>
        </>
      }
    >
      {single ? (
        <Text label="Valor" value={text} onChange={setText} autoFocus />
      ) : (
        <>
          <div className="lbl" style={{ marginBottom: 6 }}>Valores (uno por línea)</div>
          <textarea rows={10} value={text} autoFocus onChange={(e) => setText(e.target.value)} />
        </>
      )}
      <div className="hint" style={{ marginTop: 8 }}>
        Dejar vacío elimina el atributo. Los cambios se aplican con una operación LDAP replace.
      </div>
    </Modal>
  )
}
