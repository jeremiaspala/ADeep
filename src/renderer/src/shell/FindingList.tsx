import { useCallback, useMemo, useState, type JSX } from 'react'
import { ShieldAlert, ShieldCheck, Undo2 } from 'lucide-react'
import { useApp } from '../store'

export interface Finding {
  id: string
  severity: 'alta' | 'media' | 'baja'
  /** Sobre qué objeto es: zona, host, lo que la consola use de encabezado. */
  subject: string
  label: string
  detail: string
  /** Acción propia de la consola, si el hallazgo se puede corregir desde acá. */
  action?: { label: string; run: () => void }
}

const SEV_COLOR = { alta: 'var(--danger)', media: 'var(--warn)', baja: 'var(--text-dim)' } as const
const SEV_BG = { alta: 'var(--danger-soft)', media: 'var(--warn-soft)', baja: 'var(--bg-sunken)' } as const

/**
 * Lista de hallazgos compartida por las revisiones de seguridad.
 *
 * Un hallazgo aceptado **no se oculta ni se deja de evaluar**: se separa. Una
 * revisión que esconde lo que ya se decidió deja de servir para auditar, y una
 * que repite todas las veces lo mismo que ya se miró se vuelve ruido y se deja
 * de leer. La lista de aceptados vive en las preferencias, por `id`.
 */
export default function FindingList({
  findings,
  vacio
}: {
  findings: Finding[]
  vacio: string
}): JSX.Element {
  const prefs = useApp((s) => s.prefs)
  const set = useApp((s) => s.set)
  const [verAceptados, setVerAceptados] = useState(false)

  const aceptados = useMemo(() => new Set(prefs.acceptedFindings ?? []), [prefs.acceptedFindings])

  const marcar = useCallback(async (id: string, aceptar: boolean): Promise<void> => {
    const actuales = new Set(prefs.acceptedFindings ?? [])
    if (aceptar) actuales.add(id)
    else actuales.delete(id)
    const lista = [...actuales]
    set({ prefs: { ...prefs, acceptedFindings: lista } })
    await window.adeep.store.setPrefs({ acceptedFindings: lista }).catch(() => undefined)
  }, [prefs, set])

  const pendientes = findings.filter((f) => !aceptados.has(f.id))
  const asumidos = findings.filter((f) => aceptados.has(f.id))

  const tarjeta = (f: Finding, aceptado: boolean): JSX.Element => (
    <div
      key={f.id}
      className="row"
      style={{
        gap: 10, alignItems: 'flex-start', padding: 12, marginBottom: 8,
        borderRadius: 'var(--r-sm)', maxWidth: 920,
        background: aceptado ? 'var(--bg-sunken)' : SEV_BG[f.severity],
        opacity: aceptado ? 0.75 : 1
      }}
    >
      {aceptado
        ? <ShieldCheck size={17} color="var(--text-dim)" />
        : <ShieldAlert size={17} color={SEV_COLOR[f.severity]} />}
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ fontWeight: 600, fontSize: 13 }}>
          {f.subject} — {f.label}
        </div>
        <div className="hint" style={{ marginTop: 3, lineHeight: 1.5 }}>{f.detail}</div>
        <div className="row" style={{ gap: 8, marginTop: 8 }}>
          {!aceptado && f.action && (
            <button className="btn" onClick={f.action.run}>{f.action.label}</button>
          )}
          {aceptado ? (
            <button className="btn" onClick={() => void marcar(f.id, false)}>
              <Undo2 size={14} style={{ verticalAlign: -2, marginRight: 4 }} />
              Volver a marcarlo
            </button>
          ) : (
            <button
              className="btn"
              title="Se sigue evaluando, pero pasa a la lista de lo ya decidido"
              onClick={() => void marcar(f.id, true)}
            >
              Es a propósito
            </button>
          )}
        </div>
      </div>
    </div>
  )

  if (!findings.length) return <div className="hint">{vacio}</div>

  return (
    <>
      {pendientes.length
        ? pendientes.map((f) => tarjeta(f, false))
        : <div className="hint" style={{ marginBottom: 12 }}>
            Nada pendiente: todo lo que se encontró está marcado como intencional.
          </div>}

      {asumidos.length > 0 && (
        <div style={{ marginTop: 18 }}>
          <button
            className="btn"
            onClick={() => setVerAceptados((v) => !v)}
            style={{ marginBottom: 10 }}
          >
            {verAceptados ? 'Ocultar' : 'Ver'} {asumidos.length} marcado(s) como intencional(es)
          </button>
          {verAceptados && asumidos.map((f) => tarjeta(f, true))}
        </div>
      )}
    </>
  )
}
