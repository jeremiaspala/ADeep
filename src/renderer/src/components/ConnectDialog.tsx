import { useEffect, useState, type JSX } from 'react'
import { Plug, Plus, Trash2, ShieldAlert } from 'lucide-react'
import type { ConnectionProfile, Security, SessionInfo } from '@shared/types'
import { Check2, Field, Modal, Spinner, Text, useConfirm } from './ui'
import { useApp } from '../store'

const DEFAULT_PORTS: Record<Security, number> = { plain: 389, starttls: 389, ldaps: 636 }

function blank(id: string): ConnectionProfile {
  return {
    id,
    name: '',
    host: '',
    port: 389,
    security: 'starttls',
    insecureTLS: false,
    bindDN: '',
    baseDN: '',
    savePassword: false
  }
}

export default function ConnectDialog({
  onClose,
  onConnected
}: {
  onClose: () => void
  onConnected: (info: SessionInfo) => void
}): JSX.Element {
  const toast = useApp((s) => s.toast)
  const confirm = useConfirm()

  const [profiles, setProfiles] = useState<ConnectionProfile[]>([])
  const [profile, setProfile] = useState<ConnectionProfile>(blank(''))
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [encrypted, setEncrypted] = useState(true)
  const [error, setError] = useState<string>()

  const patch = (p: Partial<ConnectionProfile>): void => setProfile((cur) => ({ ...cur, ...p }))

  useEffect(() => {
    void (async () => {
      const [ps, enc, id] = await Promise.all([
        window.adeep.store.profiles(),
        window.adeep.store.encryptionAvailable(),
        window.adeep.store.newId()
      ])
      setEncrypted(enc.data ?? false)
      const list = ps.data ?? []
      setProfiles(list)
      const last = [...list].sort((a, b) => (b.lastUsed ?? 0) - (a.lastUsed ?? 0))[0]
      if (last) await pick(last)
      else setProfile(blank(id.data ?? String(Date.now())))
    })()
  }, [])

  const pick = async (p: ConnectionProfile): Promise<void> => {
    setProfile(p)
    setError(undefined)
    if (p.savePassword) {
      const s = await window.adeep.store.secret(p.id)
      setPassword(s.data ?? '')
    } else setPassword('')
  }

  const newProfile = async (): Promise<void> => {
    const id = await window.adeep.store.newId()
    setProfile(blank(id.data ?? String(Date.now())))
    setPassword('')
    setError(undefined)
  }

  const remove = async (p: ConnectionProfile): Promise<void> => {
    const ok = await confirm({
      title: 'Eliminar perfil',
      message: `¿Eliminar el perfil "${p.name || p.host}"?`,
      danger: true,
      confirmLabel: 'Eliminar'
    })
    if (!ok) return
    const res = await window.adeep.store.deleteProfile(p.id)
    if (res.ok) {
      setProfiles(res.data ?? [])
      if (res.data?.length) await pick(res.data[0])
      else await newProfile()
    }
  }

  const valid = profile.host.trim() && profile.bindDN.trim() && password

  const connect = async (): Promise<void> => {
    if (!valid || busy) return
    setBusy(true)
    setError(undefined)
    const p: ConnectionProfile = {
      ...profile,
      name: profile.name.trim() || profile.host.trim(),
      host: profile.host.trim(),
      bindDN: profile.bindDN.trim(),
      baseDN: profile.baseDN.trim(),
      lastUsed: Date.now()
    }
    const res = await window.adeep.session.connect(p, password)
    setBusy(false)
    if (!res.ok || !res.data) {
      setError(res.error ?? 'No se pudo conectar')
      return
    }
    const saved = await window.adeep.store.saveProfile({
      ...p,
      baseDN: res.data.rootDSE?.defaultNamingContext ?? p.baseDN,
      password: p.savePassword ? password : undefined
    })
    if (!saved.ok) toast('warn', 'Conectado, pero no se pudo guardar el perfil')
    onConnected(res.data)
  }

  return (
    <Modal
      title="Conectar con un dominio"
      subtitle="Active Directory / LDAP"
      icon={<Plug size={18} color="var(--accent)" />}
      size="wide"
      onClose={onClose}
      closeOnBackdrop={false}
      footer={
        <>
          {error && (
            <span className="error-text" style={{ marginRight: 'auto', maxWidth: 380 }}>
              {error}
            </span>
          )}
          {!error && <div className="spacer" />}
          <button className="btn" onClick={onClose}>
            Cancelar
          </button>
          <button className="btn primary" disabled={!valid || busy} onClick={() => void connect()}>
            {busy && <Spinner size={14} />}
            {busy ? 'Conectando…' : 'Conectar'}
          </button>
        </>
      }
    >
      <div style={{ display: 'grid', gridTemplateColumns: '200px 1fr', gap: 16 }}>
        <div style={{ borderRight: '1px solid var(--border)', paddingRight: 12, minWidth: 0 }}>
          <div className="row" style={{ justifyContent: 'space-between', marginBottom: 6 }}>
            <span className="lbl" style={{ fontSize: 11, color: 'var(--text-faint)' }}>
              PERFILES
            </span>
            <button className="btn ghost icon sm" title="Nuevo perfil" onClick={() => void newProfile()}>
              <Plus size={15} />
            </button>
          </div>
          <div style={{ maxHeight: 300, overflow: 'auto' }}>
            {profiles.map((p) => (
              <div
                key={p.id}
                className={`tree-row ${p.id === profile.id ? 'sel' : ''}`}
                style={{ paddingLeft: 8, borderRadius: 'var(--r-sm)', marginRight: 0 }}
                onClick={() => void pick(p)}
              >
                <span className="tree-label" style={{ flex: 1 }}>
                  {p.name || p.host}
                </span>
                <button
                  className="btn ghost icon sm"
                  title="Eliminar"
                  onClick={(e) => { e.stopPropagation(); void remove(p) }}
                >
                  <Trash2 size={13} />
                </button>
              </div>
            ))}
            {!profiles.length && <div className="hint">Todavía no hay perfiles guardados.</div>}
          </div>
        </div>

        <div className="col" style={{ gap: 10, minWidth: 0 }}>
          <div className="grid-2">
            <Text label="Nombre del perfil" value={profile.name} onChange={(v) => patch({ name: v })} placeholder="Dominio corporativo" />
            <Text
              label="Servidor (DC)"
              value={profile.host}
              onChange={(v) => patch({ host: v })}
              placeholder="dc01.corp.local"
              autoFocus
            />
          </div>

          <div className="grid-3">
            <Field label="Seguridad">
              <select
                value={profile.security}
                onChange={(e) => {
                  const security = e.target.value as Security
                  patch({ security, port: DEFAULT_PORTS[security] })
                }}
              >
                <option value="starttls">StartTLS (389)</option>
                <option value="ldaps">LDAPS (636)</option>
                <option value="plain">Sin cifrar (389)</option>
              </select>
            </Field>
            <Field label="Puerto">
              <input
                type="number"
                value={profile.port}
                onChange={(e) => patch({ port: Number(e.target.value) || 389 })}
              />
            </Field>
            <Field label="Base DN" hint="Vacío = el del dominio">
              <input
                type="text"
                value={profile.baseDN}
                placeholder="DC=corp,DC=local"
                onChange={(e) => patch({ baseDN: e.target.value })}
              />
            </Field>
          </div>

          <Text
            label="Usuario"
            value={profile.bindDN}
            onChange={(v) => patch({ bindDN: v })}
            placeholder="admin@corp.local o CORP\\admin"
          />
          <Text
            label="Contraseña"
            type="password"
            value={password}
            onChange={setPassword}
            onEnter={() => void connect()}
          />

          <Check2
            label="Guardar la contraseña"
            checked={profile.savePassword}
            onChange={(v) => patch({ savePassword: v })}
            hint={
              encrypted
                ? 'Se guarda cifrada con el llavero del sistema.'
                : 'El llavero no está disponible: se guardaría en texto plano.'
            }
          />
          <Check2
            label="No verificar el certificado del servidor"
            checked={profile.insecureTLS}
            onChange={(v) => patch({ insecureTLS: v })}
            disabled={profile.security === 'plain'}
            hint="Sólo para laboratorios o CA interna sin instalar."
          />

          {profile.security === 'plain' && (
            <div className="row" style={{ gap: 7, color: 'var(--warn)', fontSize: 12 }}>
              <ShieldAlert size={15} />
              <span>Sin cifrado la contraseña viaja en claro y AD rechaza cambios de contraseña.</span>
            </div>
          )}
        </div>
      </div>
    </Modal>
  )
}
