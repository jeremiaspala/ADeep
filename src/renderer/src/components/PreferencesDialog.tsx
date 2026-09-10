import { useState, type JSX } from 'react'
import { Settings2 } from 'lucide-react'
import { Check2, Field, Modal } from './ui'
import { useApp } from '../store'
import type { Preferences } from '@shared/types'
import { refresh } from '../lib/treeActions'

export default function PreferencesDialog({ onClose }: { onClose: () => void }): JSX.Element {
  const prefs = useApp((s) => s.prefs)
  const set = useApp((s) => s.set)
  const [draft, setDraft] = useState<Preferences>(prefs)

  const patch = (p: Partial<Preferences>): void => setDraft((d) => ({ ...d, ...p }))

  const save = async (): Promise<void> => {
    const res = await window.adeep.store.setPrefs(draft)
    if (res.ok && res.data) set({ prefs: res.data })
    const theme = await window.adeep.theme.set(draft.theme)
    set({ theme })
    onClose()
    if (draft.showAdvancedFeatures !== prefs.showAdvancedFeatures || draft.maxItems !== prefs.maxItems) {
      await refresh()
    }
  }

  return (
    <Modal
      title="Preferencias"
      icon={<Settings2 size={18} color="var(--accent)" />}
      onClose={onClose}
      footer={
        <>
          <div className="spacer" style={{ flex: 1 }} />
          <button className="btn" onClick={onClose}>Cancelar</button>
          <button className="btn primary" onClick={() => void save()}>Guardar</button>
        </>
      }
    >
      <div className="col" style={{ gap: 12 }}>
        <div className="grid-2">
          <Field label="Tema">
            <select value={draft.theme} onChange={(e) => patch({ theme: e.target.value as Preferences['theme'] })}>
              <option value="system">Seguir al sistema</option>
              <option value="light">Claro</option>
              <option value="dark">Oscuro</option>
            </select>
          </Field>
          <Field label="Densidad">
            <select value={draft.density} onChange={(e) => patch({ density: e.target.value as Preferences['density'] })}>
              <option value="comfortable">Normal</option>
              <option value="compact">Compacta</option>
            </select>
          </Field>
        </div>

        <Field label="Máximo de objetos por contenedor" hint="AD limita a 1000 por página; ADeep pagina automáticamente.">
          <input
            type="number"
            min={100}
            max={100000}
            step={100}
            value={draft.maxItems}
            onChange={(e) => patch({ maxItems: Math.max(100, Number(e.target.value) || 2000) })}
          />
        </Field>

        <Check2
          label="Características avanzadas"
          checked={draft.showAdvancedFeatures}
          onChange={(v) => patch({ showAdvancedFeatures: v })}
          hint="Muestra contenedores de sistema, la pestaña Seguridad y el editor de atributos completo."
        />
        <Check2
          label="Pedir confirmación antes de eliminar"
          checked={draft.confirmDelete}
          onChange={(v) => patch({ confirmDelete: v })}
        />
        <Check2
          label="Mostrar usuarios y grupos como contenedores"
          checked={draft.showUsersGroupsAsContainers}
          onChange={(v) => patch({ showUsersGroupsAsContainers: v })}
          hint="Equivalente a 'Users, Contacts, Groups, and Computers as containers' de ADUC."
        />
      </div>
    </Modal>
  )
}
