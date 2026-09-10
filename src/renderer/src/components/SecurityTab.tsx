import { useEffect, useState, type JSX } from 'react'
import { Plus, Trash2, ShieldCheck, RefreshCw } from 'lucide-react'
import type { AceEntry, DirEntry, SecurityDescriptor } from '@shared/types'
import { PERMISSION_SETS, maskHas } from '@shared/rights'
import { Check2, Spinner } from './ui'
import Picker from './Picker'
import { report } from '../store'

const PICK_KINDS = ['user', 'group', 'computer'] as const

export default function SecurityTab({
  dn,
  onDirty
}: {
  dn: string
  onDirty: (dirty: boolean) => void
}): JSX.Element {
  const [sd, setSd] = useState<SecurityDescriptor>()
  const [loading, setLoading] = useState(true)
  const [trustee, setTrustee] = useState<string>('')
  const [picker, setPicker] = useState(false)
  const [busy, setBusy] = useState(false)

  const load = async (): Promise<void> => {
    setLoading(true)
    const res = await window.adeep.security.read(dn, false)
    setLoading(false)
    const data = report(res)
    if (!data) return
    setSd(data)
    onDirty(false)
    setTrustee(data.dacl[0]?.trusteeSID ?? '')
  }

  useEffect(() => { void load() }, [dn])

  if (loading) return <div className="row" style={{ gap: 8, padding: 16 }}><Spinner /> Leyendo permisos…</div>
  if (!sd) return <div className="hint" style={{ padding: 16 }}>No se pudo leer el descriptor de seguridad.</div>

  const trustees = dedupe(sd.dacl)
  const aces = sd.dacl.filter((a) => a.trusteeSID === trustee)

  const patch = (next: SecurityDescriptor): void => { setSd(next); onDirty(true) }

  const setPermission = (setId: string, kind: 'allow' | 'deny', on: boolean): void => {
    const preset = PERMISSION_SETS.find((p) => p.id === setId)
    if (!preset || !trustee) return
    const dacl = [...sd.dacl]
    const idx = dacl.findIndex(
      (a) => a.trusteeSID === trustee && a.type === kind && !a.inherited && !a.objectType
    )
    if (on) {
      if (idx >= 0) dacl[idx] = { ...dacl[idx], mask: dacl[idx].mask | preset.mask }
      else {
        dacl.push({
          type: kind,
          trusteeSID: trustee,
          trusteeName: trustees.find((t) => t.sid === trustee)?.name,
          mask: preset.mask,
          rights: [],
          inherited: false,
          inheritOnly: false,
          containerInherit: true,
          objectInherit: false,
          flags: 0x02
        })
      }
    } else if (idx >= 0) {
      const mask = dacl[idx].mask & ~preset.mask
      if (mask === 0) dacl.splice(idx, 1)
      else dacl[idx] = { ...dacl[idx], mask }
    }
    patch({ ...sd, dacl })
  }

  const removeTrustee = (): void => {
    if (!trustee) return
    const dacl = sd.dacl.filter((a) => a.trusteeSID !== trustee || a.inherited)
    patch({ ...sd, dacl })
    setTrustee(dedupe(dacl)[0]?.sid ?? '')
  }

  const addTrustees = (entries: DirEntry[]): void => {
    setPicker(false)
    const dacl = [...sd.dacl]
    for (const e of entries) {
      if (!e.objectSID) continue
      if (dacl.some((a) => a.trusteeSID === e.objectSID)) continue
      dacl.push({
        type: 'allow',
        trusteeSID: e.objectSID,
        trusteeName: e.name,
        mask: PERMISSION_SETS.find((p) => p.id === 'read')?.mask ?? 0x00020094,
        rights: [],
        inherited: false,
        inheritOnly: false,
        containerInherit: true,
        objectInherit: false,
        flags: 0x02
      })
    }
    patch({ ...sd, dacl })
    if (entries[0]?.objectSID) setTrustee(entries[0].objectSID)
  }

  const save = async (): Promise<void> => {
    setBusy(true)
    const res = await window.adeep.security.write(dn, sd, false)
    setBusy(false)
    if (report(res, 'Permisos guardados') !== undefined) {
      onDirty(false)
      await load()
    }
  }

  const allowMask = aces.filter((a) => a.type === 'allow' || a.type === 'allow-object')
    .reduce((m, a) => m | a.mask, 0)
  const denyMask = aces.filter((a) => a.type === 'deny' || a.type === 'deny-object')
    .reduce((m, a) => m | a.mask, 0)
  const inheritedOnly = aces.length > 0 && aces.every((a) => a.inherited)

  return (
    <div className="col" style={{ gap: 12, padding: 16, minHeight: 0 }}>
      <div className="kv" style={{ gridTemplateColumns: '120px 1fr' }}>
        <span className="k">Propietario</span>
        <span className="v">{sd.ownerName ?? sd.owner ?? '—'}</span>
      </div>

      <div>
        <div className="row" style={{ justifyContent: 'space-between', marginBottom: 6 }}>
          <span className="lbl">Entidades de seguridad</span>
          <span className="row" style={{ gap: 6 }}>
            <button className="btn sm" onClick={() => setPicker(true)}>
              <Plus size={13} /> Agregar
            </button>
            <button className="btn sm" disabled={!trustee} onClick={removeTrustee}>
              <Trash2 size={13} /> Quitar
            </button>
            <button className="btn sm" onClick={() => void load()} title="Volver a leer">
              <RefreshCw size={13} />
            </button>
          </span>
        </div>
        <div className="mini-table-wrap" style={{ height: 150, overflow: 'auto' }}>
          <table className="mini">
            <tbody>
              {trustees.map((t) => (
                <tr key={t.sid} className={t.sid === trustee ? 'sel' : ''} onClick={() => setTrustee(t.sid)}>
                  <td title={t.sid}>{t.name}</td>
                  <td style={{ width: 110 }}>{t.inherited ? 'Heredado' : 'Explícito'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div>
        <div className="lbl" style={{ marginBottom: 6 }}>
          Permisos de {trustees.find((t) => t.sid === trustee)?.name ?? '—'}
        </div>
        <div className="mini-table-wrap" style={{ maxHeight: 220, overflow: 'auto' }}>
          <div className="perm-grid">
            <div className="hdr l">Permiso</div>
            <div className="hdr">Permitir</div>
            <div className="hdr">Denegar</div>
            {PERMISSION_SETS.map((p) => (
              <PermRow
                key={p.id}
                label={p.label}
                allow={maskHas(allowMask, p.mask)}
                deny={maskHas(denyMask, p.mask)}
                disabled={!trustee || inheritedOnly}
                onAllow={(v) => setPermission(p.id, 'allow', v)}
                onDeny={(v) => setPermission(p.id, 'deny', v)}
              />
            ))}
          </div>
        </div>
        {inheritedOnly && (
          <div className="hint" style={{ marginTop: 6 }}>
            Todos los permisos de esta entidad son heredados del contenedor padre; editalos ahí.
          </div>
        )}
      </div>

      <Check2
        label="Bloquear la herencia de permisos del contenedor padre"
        checked={sd.daclProtected}
        onChange={(v) => patch({ ...sd, daclProtected: v })}
        hint="Equivale a desmarcar «Incluir permisos heredables» en ADUC."
      />

      <div className="row" style={{ gap: 8 }}>
        <div className="spacer" style={{ flex: 1 }} />
        <button className="btn primary" disabled={busy} onClick={() => void save()}>
          {busy ? <Spinner size={14} /> : <ShieldCheck size={15} />} Aplicar permisos
        </button>
      </div>

      <div className="hint">
        {sd.dacl.length} ACE en la DACL. ADeep escribe el descriptor completo: revisá los cambios antes de aplicar.
      </div>

      {picker && (
        <Picker
          title="Agregar entidad de seguridad"
          kinds={[...PICK_KINDS]}
          onCancel={() => setPicker(false)}
          onConfirm={addTrustees}
        />
      )}
    </div>
  )
}

function PermRow({
  label, allow, deny, disabled, onAllow, onDeny
}: {
  label: string
  allow: boolean
  deny: boolean
  disabled: boolean
  onAllow: (v: boolean) => void
  onDeny: (v: boolean) => void
}): JSX.Element {
  return (
    <>
      <div className="cell l" title={label}>{label}</div>
      <div className="cell">
        <input type="checkbox" checked={allow} disabled={disabled} onChange={(e) => onAllow(e.target.checked)} />
      </div>
      <div className="cell">
        <input type="checkbox" checked={deny} disabled={disabled} onChange={(e) => onDeny(e.target.checked)} />
      </div>
    </>
  )
}

function dedupe(dacl: AceEntry[]): { sid: string; name: string; inherited: boolean }[] {
  const map = new Map<string, { sid: string; name: string; inherited: boolean }>()
  for (const a of dacl) {
    const cur = map.get(a.trusteeSID)
    if (cur) cur.inherited = cur.inherited && a.inherited
    else map.set(a.trusteeSID, { sid: a.trusteeSID, name: a.trusteeName ?? a.trusteeSID, inherited: a.inherited })
  }
  return [...map.values()].sort((x, y) => x.name.localeCompare(y.name, 'es'))
}
