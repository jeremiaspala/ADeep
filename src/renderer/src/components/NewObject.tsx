import { useEffect, useState, type JSX } from 'react'
import { Sparkles } from 'lucide-react'
import type {
  CreateComputerInput, CreateContactInput, CreateGroupInput, CreateOUInput, CreateUserInput
} from '@shared/types'
import { Check2, Field, Modal, Spinner, Text } from './ui'
import { useApp, report } from '../store'
import { dnToCanonical, dnToDomain, generatePassword } from '../lib/format'
import { copyText } from '../lib/objectActions'

export type NewObjectKind = 'user' | 'group' | 'ou' | 'computer' | 'contact'

const TITLES: Record<NewObjectKind, string> = {
  user: 'Nuevo usuario',
  group: 'Nuevo grupo',
  ou: 'Nueva unidad organizativa',
  computer: 'Nuevo equipo',
  contact: 'Nuevo contacto'
}

export default function NewObjectDialog({
  kind,
  parentDN,
  copyFrom,
  onClose,
  onCreated
}: {
  kind: NewObjectKind
  parentDN: string
  copyFrom?: string
  onClose: () => void
  onCreated: (dn: string) => void
}): JSX.Element {
  const session = useApp((s) => s.session)
  const domain = dnToDomain(session.rootDSE?.defaultNamingContext ?? '')

  const [step, setStep] = useState(1)
  const [busy, setBusy] = useState(false)
  const [sourceName, setSourceName] = useState('')

  // Usuario / contacto
  const [givenName, setGivenName] = useState('')
  const [initials, setInitials] = useState('')
  const [sn, setSn] = useState('')
  const [cn, setCn] = useState('')
  const [cnTouched, setCnTouched] = useState(false)
  const [sam, setSam] = useState('')
  const [samTouched, setSamTouched] = useState(false)
  const [upnSuffix, setUpnSuffix] = useState(domain)
  const [password, setPassword] = useState('')
  const [mustChange, setMustChange] = useState(true)
  const [cannotChange, setCannotChange] = useState(false)
  const [neverExpires, setNeverExpires] = useState(false)
  const [disabled, setDisabled] = useState(false)
  const [description, setDescription] = useState('')

  // Grupo
  const [groupScope, setGroupScope] = useState<2 | 4 | 8>(2)
  const [groupSecurity, setGroupSecurity] = useState(true)

  // OU / equipo
  const [name, setName] = useState('')
  const [protectOU, setProtectOU] = useState(true)
  const [preW2k, setPreW2k] = useState(false)

  useEffect(() => {
    if (!copyFrom) return
    void (async () => {
      const res = await window.adeep.dir.entry(copyFrom)
      if (res.ok && res.data) setSourceName(res.data.name)
    })()
  }, [copyFrom])

  useEffect(() => {
    if (kind !== 'user' && kind !== 'contact') return
    if (!cnTouched) setCn([givenName, initials, sn].filter(Boolean).join(' ').trim())
  }, [givenName, initials, sn, cnTouched, kind])

  useEffect(() => {
    if (kind !== 'user' || samTouched) return
    const base = (givenName ? `${givenName[0]}` : '') + sn
    setSam(base.toLowerCase().replace(/[^a-z0-9._-]/g, '').slice(0, 20))
  }, [givenName, sn, samTouched, kind])

  useEffect(() => {
    if ((kind !== 'computer' && kind !== 'group') || samTouched) return
    setSam(
      kind === 'computer'
        ? name.toUpperCase().replace(/[^A-Z0-9._-]/g, '').slice(0, 15)
        : name.slice(0, 64)
    )
  }, [name, kind, samTouched])

  const create = async (): Promise<void> => {
    if (busy) return
    setBusy(true)
    let dn: string | undefined

    if (kind === 'user') {
      const input: CreateUserInput = {
        parentDN,
        cn: cn.trim(),
        givenName: givenName.trim() || undefined,
        initials: initials.trim() || undefined,
        sn: sn.trim() || undefined,
        displayName: cn.trim() || undefined,
        sAMAccountName: sam.trim(),
        userPrincipalName: upnSuffix ? `${sam.trim()}@${upnSuffix}` : undefined,
        password: password || undefined,
        mustChangePassword: mustChange,
        cannotChangePassword: cannotChange,
        passwordNeverExpires: neverExpires,
        accountDisabled: disabled,
        description: description.trim() || undefined
      }
      const res = copyFrom
        ? await window.adeep.create.copyUser(copyFrom, input)
        : await window.adeep.create.user(input)
      dn = report(res, copyFrom ? 'Usuario copiado' : 'Usuario creado')
    } else if (kind === 'group') {
      const input: CreateGroupInput = {
        parentDN,
        name: name.trim(),
        sAMAccountName: sam.trim() || name.trim(),
        scope: groupScope,
        security: groupSecurity,
        description: description.trim() || undefined
      }
      dn = report(await window.adeep.create.group(input), 'Grupo creado')
    } else if (kind === 'ou') {
      const input: CreateOUInput = {
        parentDN,
        name: name.trim(),
        description: description.trim() || undefined,
        protectFromDeletion: protectOU
      }
      dn = report(await window.adeep.create.ou(input), 'Unidad organizativa creada')
    } else if (kind === 'computer') {
      const input: CreateComputerInput = {
        parentDN,
        name: name.trim(),
        sAMAccountName: (sam || name).trim().toUpperCase(),
        description: description.trim() || undefined,
        isPreWindows2000: preW2k
      }
      dn = report(await window.adeep.create.computer(input), 'Equipo creado')
    } else {
      const input: CreateContactInput = {
        parentDN,
        cn: cn.trim(),
        givenName: givenName.trim() || undefined,
        initials: initials.trim() || undefined,
        sn: sn.trim() || undefined,
        displayName: cn.trim() || undefined
      }
      dn = report(await window.adeep.create.contact(input), 'Contacto creado')
    }

    setBusy(false)
    if (dn) onCreated(dn)
  }

  const genPassword = (): void => {
    const p = generatePassword()
    setPassword(p)
    void copyText(p, 'Contraseña generada y copiada')
  }

  const validUser = cn.trim().length > 0 && sam.trim().length > 0
  const validSimple = name.trim().length > 0
  const canFinish =
    kind === 'user' ? validUser : kind === 'contact' ? cn.trim().length > 0 : validSimple

  const isWizard = kind === 'user'
  const lastStep = !isWizard || step === 2

  return (
    <Modal
      title={copyFrom ? `Copiar usuario${sourceName ? ` — ${sourceName}` : ''}` : TITLES[kind]}
      subtitle={dnToCanonical(parentDN)}
      icon={<Sparkles size={18} color="var(--accent)" />}
      size="wide"
      onClose={onClose}
      bodyFlush={isWizard}
      footer={
        <>
          <div className="spacer" style={{ flex: 1 }} />
          <button className="btn" onClick={onClose}>Cancelar</button>
          {isWizard && step === 2 && (
            <button className="btn" onClick={() => setStep(1)}>Atrás</button>
          )}
          {isWizard && step === 1 ? (
            <button className="btn primary" disabled={!validUser} onClick={() => setStep(2)}>
              Siguiente
            </button>
          ) : (
            <button className="btn primary" disabled={!canFinish || busy} onClick={() => void create()}>
              {busy && <Spinner size={14} />} {copyFrom ? 'Copiar' : 'Crear'}
            </button>
          )}
        </>
      }
    >
      {isWizard && (
        <div className="wizard-steps">
          <span className={`step ${step === 1 ? 'on' : 'done'}`}>
            <span className="n">1</span> Datos
          </span>
          <span className="line" />
          <span className={`step ${step === 2 ? 'on' : ''}`}>
            <span className="n">2</span> Contraseña y opciones
          </span>
        </div>
      )}

      <div style={{ padding: isWizard ? 16 : 0, display: 'flex', flexDirection: 'column', gap: 10 }}>
        {(kind === 'user' || kind === 'contact') && step === 1 && (
          <>
            <div className="grid-3">
              <Text label="Nombre" value={givenName} onChange={setGivenName} autoFocus />
              <Text label="Iniciales" value={initials} onChange={setInitials} maxLength={6} />
              <Text label="Apellido" value={sn} onChange={setSn} />
            </div>
            <Text
              label="Nombre completo (CN)"
              value={cn}
              onChange={(v) => { setCn(v); setCnTouched(true) }}
              error={!cn.trim() ? 'Obligatorio' : undefined}
            />
            {kind === 'user' && (
              <div className="grid-2">
                <Text
                  label="Nombre de inicio de sesión"
                  value={sam}
                  onChange={(v) => { setSam(v); setSamTouched(true) }}
                  maxLength={20}
                  error={!sam.trim() ? 'Obligatorio' : undefined}
                  hint="sAMAccountName (máx. 20 caracteres)"
                />
                <Field label="Sufijo UPN" hint={sam ? `${sam}@${upnSuffix}` : undefined}>
                  <input type="text" value={upnSuffix} onChange={(e) => setUpnSuffix(e.target.value)} />
                </Field>
              </div>
            )}
            {kind === 'user' && (
              <Text label="Descripción" value={description} onChange={setDescription} />
            )}
          </>
        )}

        {kind === 'user' && step === 2 && (
          <>
            <div className="row" style={{ gap: 8, alignItems: 'flex-end' }}>
              <Text
                label="Contraseña"
                type="text"
                value={password}
                onChange={setPassword}
                style={{ flex: 1 }}
                hint="Debe cumplir la complejidad del dominio."
                autoFocus
              />
              <button className="btn" onClick={genPassword}>Generar</button>
            </div>
            <Check2
              label="El usuario debe cambiar la contraseña en el próximo inicio de sesión"
              checked={mustChange}
              onChange={(v) => { setMustChange(v); if (v) { setCannotChange(false); setNeverExpires(false) } }}
            />
            <Check2
              label="El usuario no puede cambiar la contraseña"
              checked={cannotChange}
              disabled={mustChange}
              onChange={setCannotChange}
            />
            <Check2
              label="La contraseña nunca expira"
              checked={neverExpires}
              disabled={mustChange}
              onChange={setNeverExpires}
            />
            <Check2 label="Cuenta deshabilitada" checked={disabled} onChange={setDisabled} />
            {!password && (
              <div className="hint">
                Sin contraseña la cuenta se crea deshabilitada hasta que se le asigne una.
              </div>
            )}
            {copyFrom && (
              <div className="hint">
                Se copian pertenencias a grupos, departamento, empresa, oficina y dirección del usuario original.
              </div>
            )}
          </>
        )}

        {kind === 'group' && (
          <>
            <Text label="Nombre del grupo" value={name} onChange={setName} autoFocus error={!name.trim() ? 'Obligatorio' : undefined} />
            <Text
              label="Nombre anterior a Windows 2000"
              value={sam}
              onChange={(v) => { setSam(v); setSamTouched(true) }}
              maxLength={64}
            />
            <div className="grid-2">
              <Field label="Ámbito">
                <select value={groupScope} onChange={(e) => setGroupScope(Number(e.target.value) as 2 | 4 | 8)}>
                  <option value={2}>Global</option>
                  <option value={4}>Local de dominio</option>
                  <option value={8}>Universal</option>
                </select>
              </Field>
              <Field label="Tipo">
                <select value={groupSecurity ? 'sec' : 'dist'} onChange={(e) => setGroupSecurity(e.target.value === 'sec')}>
                  <option value="sec">Seguridad</option>
                  <option value="dist">Distribución</option>
                </select>
              </Field>
            </div>
            <Text label="Descripción" value={description} onChange={setDescription} />
          </>
        )}

        {kind === 'ou' && (
          <>
            <Text label="Nombre" value={name} onChange={setName} autoFocus error={!name.trim() ? 'Obligatorio' : undefined} />
            <Text label="Descripción" value={description} onChange={setDescription} />
            <Check2
              label="Proteger el contenedor contra eliminación accidental"
              checked={protectOU}
              onChange={setProtectOU}
              hint="Agrega una ACE de denegación de Delete/DeleteTree para Everyone."
            />
          </>
        )}

        {kind === 'computer' && (
          <>
            <Text label="Nombre del equipo" value={name} onChange={setName} autoFocus error={!name.trim() ? 'Obligatorio' : undefined} />
            <Text
              label="Nombre anterior a Windows 2000"
              value={sam}
              onChange={(v) => { setSam(v); setSamTouched(true) }}
              maxLength={15}
              hint="Se le agrega $ automáticamente."
            />
            <Text label="Descripción" value={description} onChange={setDescription} />
            <Check2
              label="Asignar esta cuenta como equipo anterior a Windows 2000"
              checked={preW2k}
              onChange={setPreW2k}
            />
          </>
        )}
      </div>

      {!parentDN && (
        <div className="error-text" style={{ padding: 16 }}>
          Elegí primero un contenedor en el árbol.
        </div>
      )}
      {busy && kind !== 'user' && <div className="hint" style={{ padding: '0 16px' }}>Creando…</div>}
    </Modal>
  )
}
