import { useEffect, useState, type JSX } from 'react'
import { KeyRound, RefreshCw, Copy, Eye, EyeOff } from 'lucide-react'
import type { PasswordPolicy } from '@shared/types'
import { Check2, Modal, Spinner, Text } from './ui'
import { useApp, report } from '../store'
import { generatePassword } from '../lib/format'
import { copyText } from '../lib/objectActions'
import { refresh } from '../lib/treeActions'

export default function ResetPasswordDialog({
  dn,
  name,
  onClose
}: {
  dn: string
  name: string
  onClose: () => void
}): JSX.Element {
  const insecure = useApp((s) => s.session.profile?.security) === 'plain'
  const [pwd, setPwd] = useState('')
  const [pwd2, setPwd2] = useState('')
  const [show, setShow] = useState(false)
  const [mustChange, setMustChange] = useState(true)
  const [unlock, setUnlock] = useState(true)
  const [busy, setBusy] = useState(false)
  const [policy, setPolicy] = useState<PasswordPolicy>()

  useEffect(() => {
    void (async () => {
      const res = await window.adeep.session.passwordPolicy()
      if (res.ok) setPolicy(res.data)
    })()
  }, [])

  const tooShort = !!policy && pwd.length > 0 && pwd.length < policy.minPwdLength
  const mismatch = pwd2.length > 0 && pwd !== pwd2
  const valid = pwd.length > 0 && !tooShort && !mismatch && pwd === pwd2

  const submit = async (): Promise<void> => {
    if (!valid || busy) return
    setBusy(true)
    const res = await window.adeep.obj.resetPassword(dn, pwd, mustChange, unlock)
    setBusy(false)
    if (report(res, 'Contraseña restablecida') !== undefined) {
      onClose()
      void refresh()
    }
  }

  const gen = (): void => {
    const p = generatePassword(Math.max(16, policy?.minPwdLength ?? 16))
    setPwd(p)
    setPwd2(p)
    setShow(true)
    void copyText(p, 'Contraseña generada y copiada')
  }

  return (
    <Modal
      title="Restablecer contraseña"
      subtitle={name}
      icon={<KeyRound size={18} color="var(--accent)" />}
      onClose={onClose}
      footer={
        <>
          <div className="spacer" style={{ flex: 1 }} />
          <button className="btn" onClick={onClose}>Cancelar</button>
          <button className="btn primary" disabled={!valid || busy} onClick={() => void submit()}>
            {busy && <Spinner size={14} />} Restablecer
          </button>
        </>
      }
    >
      <div className="col" style={{ gap: 10 }}>
        <div className="row" style={{ gap: 8, alignItems: 'flex-end' }}>
          <Text
            label="Nueva contraseña"
            type={show ? 'text' : 'password'}
            value={pwd}
            onChange={setPwd}
            style={{ flex: 1 }}
            error={tooShort ? `Mínimo ${policy?.minPwdLength} caracteres` : undefined}
            autoFocus
          />
          <button className="btn icon" title={show ? 'Ocultar' : 'Mostrar'} onClick={() => setShow(!show)}>
            {show ? <EyeOff size={15} /> : <Eye size={15} />}
          </button>
          <button className="btn icon" title="Generar" onClick={gen}>
            <RefreshCw size={15} />
          </button>
          <button className="btn icon" title="Copiar" disabled={!pwd} onClick={() => void copyText(pwd)}>
            <Copy size={15} />
          </button>
        </div>

        <Text
          label="Confirmar contraseña"
          type={show ? 'text' : 'password'}
          value={pwd2}
          onChange={setPwd2}
          error={mismatch ? 'Las contraseñas no coinciden' : undefined}
          onEnter={() => void submit()}
        />

        <Check2 label="El usuario debe cambiar la contraseña en el próximo inicio de sesión" checked={mustChange} onChange={setMustChange} />
        <Check2 label="Desbloquear la cuenta" checked={unlock} onChange={setUnlock} />

        {policy && (
          <div className="hint" style={{ marginTop: 4 }}>
            Política del dominio: mínimo {policy.minPwdLength} caracteres
            {policy.complexityEnabled ? ', complejidad activada' : ''}
            {policy.pwdHistoryLength ? `, historial de ${policy.pwdHistoryLength}` : ''}.
          </div>
        )}
        <div className={insecure ? 'error-text' : 'hint'}>
          El cambio requiere una conexión cifrada (LDAPS o StartTLS).
          {insecure ? ' La sesión actual no está cifrada.' : ''}
        </div>
      </div>
    </Modal>
  )
}
