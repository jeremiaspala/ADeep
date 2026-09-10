import { useRef, useState, type JSX } from 'react'
import { CalendarClock } from 'lucide-react'
import { Modal } from '../components/ui'

const DAYS = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado']

/**
 * Editor del bitmap semanal de 7x24 que usan `schedule` (vínculos y conexiones) y
 * `msDFSR-Schedule`. El índice 0 es el domingo a las 00:00, en hora del DC.
 */
export default function ScheduleEditor({
  title,
  initial,
  onCancel,
  onSave
}: {
  title: string
  initial?: boolean[]
  onCancel: () => void
  onSave: (schedule: boolean[] | null) => void
}): JSX.Element {
  const [hours, setHours] = useState<boolean[]>(
    initial && initial.length === 168 ? [...initial] : Array.from({ length: 168 }, () => true)
  )
  const dragging = useRef<null | boolean>(null)

  const set = (index: number, value: boolean): void =>
    setHours((cur) => {
      if (cur[index] === value) return cur
      const next = [...cur]
      next[index] = value
      return next
    })

  const fill = (value: boolean): void => setHours(Array.from({ length: 168 }, () => value))

  const toggleDay = (day: number): void =>
    setHours((cur) => {
      const next = [...cur]
      const allOn = next.slice(day * 24, day * 24 + 24).every(Boolean)
      for (let h = 0; h < 24; h++) next[day * 24 + h] = !allOn
      return next
    })

  const toggleHour = (hour: number): void =>
    setHours((cur) => {
      const next = [...cur]
      const allOn = DAYS.every((_, d) => next[d * 24 + hour])
      for (let d = 0; d < 7; d++) next[d * 24 + hour] = !allOn
      return next
    })

  const active = hours.filter(Boolean).length

  return (
    <Modal
      title={title}
      subtitle={`${active} de 168 horas habilitadas`}
      icon={<CalendarClock size={18} color="var(--accent)" />}
      size="wide"
      onClose={onCancel}
      footer={
        <>
          <button className="btn ghost" onClick={() => fill(true)}>Todo</button>
          <button className="btn ghost" onClick={() => fill(false)}>Nada</button>
          <div className="spacer" style={{ flex: 1 }} />
          <button className="btn" onClick={onCancel}>Cancelar</button>
          <button className="btn" onClick={() => onSave(null)} title="Sin programación explícita">
            Quitar programación
          </button>
          <button className="btn primary" onClick={() => onSave(hours)}>Guardar</button>
        </>
      }
    >
      <div
        style={{ userSelect: 'none' }}
        onMouseLeave={() => { dragging.current = null }}
        onMouseUp={() => { dragging.current = null }}
      >
        <div style={{ display: 'grid', gridTemplateColumns: '90px repeat(24, 1fr)', gap: 1 }}>
          <div />
          {Array.from({ length: 24 }, (_, h) => (
            <div
              key={h}
              onClick={() => toggleHour(h)}
              style={{
                fontSize: 9.5, textAlign: 'center', color: 'var(--text-faint)', cursor: 'pointer'
              }}
              title={`Alternar las ${h}:00 de toda la semana`}
            >
              {h}
            </div>
          ))}

          {DAYS.map((day, d) => (
            <div key={day} style={{ display: 'contents' }}>
              <div
                onClick={() => toggleDay(d)}
                style={{ fontSize: 12, cursor: 'pointer', paddingRight: 6, textAlign: 'right' }}
                title={`Alternar todo el ${day.toLowerCase()}`}
              >
                {day}
              </div>
              {Array.from({ length: 24 }, (_, h) => {
                const i = d * 24 + h
                return (
                  <div
                    key={h}
                    onMouseDown={() => { dragging.current = !hours[i]; set(i, !hours[i]) }}
                    onMouseEnter={() => { if (dragging.current !== null) set(i, dragging.current) }}
                    style={{
                      height: 18,
                      borderRadius: 2,
                      cursor: 'pointer',
                      background: hours[i] ? 'var(--accent)' : 'var(--bg-sunken)',
                      border: '1px solid var(--border)'
                    }}
                    title={`${day} ${String(h).padStart(2, '0')}:00`}
                  />
                )
              })}
            </div>
          ))}
        </div>
        <div className="hint" style={{ marginTop: 10 }}>
          Arrastrá para pintar varias horas. Los encabezados alternan la fila o la columna entera.
          El horario es el del controlador de dominio.
        </div>
      </div>
    </Modal>
  )
}
