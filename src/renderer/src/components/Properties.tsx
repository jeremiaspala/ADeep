import { useEffect, useMemo, useState, type JSX } from 'react'
import { Settings2, Unlock } from 'lucide-react'
import type { DirEntry, Modification } from '@shared/types'
import { UAC, decodeUAC, setFlag } from '@shared/uac'
import { Check2, Field, Modal, Spinner, Tabs, Text, useConfirm } from './ui'
import { useApp, report } from '../store'
import { KindIcon, KIND_LABEL } from '../lib/icons'
import {
  dnToCanonical, filetimeToDate, fmtDate, generalizedTimeToDate, rdnValue
} from '../lib/format'
import MembersTab from './MembersTab'
import AttributeEditor from './AttributeEditor'
import SecurityTab from './SecurityTab'
import Picker from './Picker'
import { unlock as unlockAccounts } from '../lib/objectActions'

/** Campos de texto editables por pestaña. */
const GENERAL_FIELDS: Record<string, { attr: string; label: string }[]> = {
  person: [
    { attr: 'displayName', label: 'Nombre para mostrar' },
    { attr: 'description', label: 'Descripción' },
    { attr: 'physicalDeliveryOfficeName', label: 'Oficina' },
    { attr: 'telephoneNumber', label: 'Teléfono' },
    { attr: 'mail', label: 'Correo electrónico' },
    { attr: 'wWWHomePage', label: 'Página web' }
  ],
  group: [
    { attr: 'description', label: 'Descripción' },
    { attr: 'mail', label: 'Correo electrónico' },
    { attr: 'info', label: 'Notas' }
  ],
  container: [{ attr: 'description', label: 'Descripción' }],
  computer: [
    { attr: 'description', label: 'Descripción' },
    { attr: 'location', label: 'Ubicación' }
  ]
}

const ADDRESS_FIELDS = [
  { attr: 'streetAddress', label: 'Calle' },
  { attr: 'postOfficeBox', label: 'Apartado postal' },
  { attr: 'l', label: 'Ciudad' },
  { attr: 'st', label: 'Provincia' },
  { attr: 'postalCode', label: 'Código postal' },
  { attr: 'co', label: 'País' }
]

const ORG_FIELDS = [
  { attr: 'title', label: 'Cargo' },
  { attr: 'department', label: 'Departamento' },
  { attr: 'company', label: 'Empresa' },
  { attr: 'employeeID', label: 'Legajo' }
]

const UAC_TOGGLES: { flag: number; label: string }[] = [
  { flag: UAC.SMARTCARD_REQUIRED, label: 'Requiere tarjeta inteligente para el inicio de sesión interactivo' },
  { flag: UAC.TRUSTED_FOR_DELEGATION, label: 'La cuenta es de confianza para la delegación' },
  { flag: UAC.NOT_DELEGATED, label: 'La cuenta es importante y no se puede delegar' },
  { flag: UAC.USE_DES_KEY_ONLY, label: 'Usar sólo tipos de cifrado DES de Kerberos' },
  { flag: UAC.DONT_REQ_PREAUTH, label: 'No requerir autenticación previa de Kerberos' },
  { flag: UAC.ENCRYPTED_TEXT_PWD_ALLOWED, label: 'Guardar la contraseña con cifrado reversible' }
]

const PICK_MANAGER = ['user', 'contact'] as const

export default function PropertiesDialog({
  dn,
  initialTab,
  onClose,
  onChanged
}: {
  dn: string
  initialTab?: string
  onClose: () => void
  onChanged: () => void
}): JSX.Element {
  const advanced = useApp((s) => s.prefs.showAdvancedFeatures)
  const confirm = useConfirm()

  const [entry, setEntry] = useState<DirEntry>()
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState(initialTab ?? 'general')
  const [edits, setEdits] = useState<Record<string, string>>({})
  const [uac, setUac] = useState<number>()
  const [uac0, setUac0] = useState<number>()
  const [cannotChange, setCannotChange] = useState<boolean>()
  const [cannotChange0, setCannotChange0] = useState<boolean>()
  const [mustChange, setMustChange] = useState(false)
  const [mustChange0, setMustChange0] = useState(false)
  const [expires, setExpires] = useState('')
  const [expires0, setExpires0] = useState('')
  const [protect, setProtect] = useState<boolean>()
  const [protect0, setProtect0] = useState<boolean>()
  const [secDirty, setSecDirty] = useState(false)
  const [managerPicker, setManagerPicker] = useState(false)
  const [busy, setBusy] = useState(false)

  const attr = (name: string): string => {
    if (name in edits) return edits[name]
    const a = entry?.attrs
    if (!a) return ''
    const key = a[name] ? name : Object.keys(a).find((k) => k.toLowerCase() === name.toLowerCase())
    return key ? (a[key] ?? []).join('; ') : ''
  }
  const original = (name: string): string => {
    const a = entry?.attrs
    if (!a) return ''
    const key = a[name] ? name : Object.keys(a).find((k) => k.toLowerCase() === name.toLowerCase())
    return key ? (a[key] ?? []).join('; ') : ''
  }
  const setAttr = (name: string, value: string): void => setEdits((e) => ({ ...e, [name]: value }))

  const load = async (): Promise<void> => {
    setLoading(true)
    const res = await window.adeep.dir.entry(dn)
    setLoading(false)
    const data = report(res)
    if (!data) { onClose(); return }
    setEntry(data)
    setEdits({})

    const raw = data.attrs ?? {}
    const uacNow = Number(raw.userAccountControl?.[0] ?? NaN)
    if (Number.isFinite(uacNow)) { setUac(uacNow); setUac0(uacNow) }
    const pwdLastSet = raw.pwdLastSet?.[0] ?? ''
    setMustChange(pwdLastSet === '0')
    setMustChange0(pwdLastSet === '0')
    const exp = raw.accountExpires?.[0] ?? '0'
    const expDate = exp && exp !== '0' ? filetimeToDate(exp) : null
    const iso = expDate ? expDate.toISOString().slice(0, 10) : ''
    setExpires(iso)
    setExpires0(iso)

    const isAccount = data.kind === 'user' || data.kind === 'inetOrgPerson' || data.kind === 'computer'
    if (isAccount) {
      const cc = await window.adeep.obj.getCannotChangePassword(dn)
      if (cc.ok) { setCannotChange(cc.data); setCannotChange0(cc.data) }
    }
    const pr = await window.adeep.obj.getProtect(dn)
    if (pr.ok) { setProtect(pr.data); setProtect0(pr.data) }
  }

  useEffect(() => { void load() }, [dn])

  const kind = entry?.kind ?? 'unknown'
  const isPerson = kind === 'user' || kind === 'inetOrgPerson' || kind === 'contact'
  const isAccount = kind === 'user' || kind === 'inetOrgPerson' || kind === 'computer'

  const dirty = useMemo(() => {
    const textDirty = Object.keys(edits).some((k) => edits[k] !== original(k))
    return (
      textDirty ||
      (uac !== undefined && uac !== uac0) ||
      cannotChange !== cannotChange0 ||
      mustChange !== mustChange0 ||
      expires !== expires0 ||
      protect !== protect0
    )
  }, [edits, uac, uac0, cannotChange, cannotChange0, mustChange, mustChange0, expires, expires0, protect, protect0, entry])

  const save = async (): Promise<void> => {
    if (!entry || busy) return
    setBusy(true)
    const mods: Modification[] = []
    for (const [name, value] of Object.entries(edits)) {
      if (value === original(name)) continue
      const values = value.split(';').map((v) => v.trim()).filter(Boolean)
      mods.push(values.length ? { op: 'replace', attribute: name, values } : { op: 'delete', attribute: name, values: [] })
    }
    if (mustChange !== mustChange0) {
      mods.push({ op: 'replace', attribute: 'pwdLastSet', values: [mustChange ? '0' : '-1'] })
    }

    let ok = true
    if (mods.length) {
      const res = await window.adeep.obj.modify(dn, mods)
      ok = report(res) !== undefined
    }
    if (ok && uac !== undefined && uac !== uac0) {
      ok = report(await window.adeep.obj.setUAC(dn, uac)) !== undefined
    }
    if (ok && cannotChange !== undefined && cannotChange !== cannotChange0) {
      ok = report(await window.adeep.obj.setCannotChangePassword(dn, cannotChange)) !== undefined
    }
    if (ok && expires !== expires0) {
      ok = report(await window.adeep.obj.setAccountExpires(dn, expires ? new Date(`${expires}T00:00:00`).toISOString() : null)) !== undefined
    }
    if (ok && protect !== undefined && protect !== protect0) {
      ok = report(await window.adeep.obj.setProtect(dn, protect)) !== undefined
    }
    setBusy(false)
    if (ok) {
      useApp.getState().toast('ok', 'Cambios guardados')
      onChanged()
      await load()
    }
  }

  const close = async (): Promise<void> => {
    if (dirty || secDirty) {
      const ok = await confirm({
        title: 'Descartar cambios',
        message: 'Hay cambios sin guardar. ¿Cerrar de todos modos?',
        confirmLabel: 'Descartar',
        danger: true
      })
      if (!ok) return
    }
    onClose()
  }

  const tabs = [
    { id: 'general', label: 'General' },
    ...(isAccount ? [{ id: 'account', label: 'Cuenta' }] : []),
    ...(isPerson ? [{ id: 'address', label: 'Dirección' }] : []),
    ...(isPerson ? [{ id: 'org', label: 'Organización' }] : []),
    ...(kind === 'group' ? [{ id: 'members', label: 'Miembros' }] : []),
    ...(kind !== 'ou' && kind !== 'container' && kind !== 'domain'
      ? [{ id: 'memberOf', label: 'Miembro de' }]
      : []),
    ...(kind === 'computer' ? [{ id: 'computer', label: 'Sistema' }] : []),
    { id: 'object', label: 'Objeto' },
    ...(advanced ? [{ id: 'attributes', label: 'Atributos' }] : []),
    ...(advanced ? [{ id: 'security', label: 'Seguridad', dirty: secDirty }] : [])
  ]

  const generalFields =
    kind === 'group' ? GENERAL_FIELDS.group
      : kind === 'computer' ? GENERAL_FIELDS.computer
        : isPerson ? GENERAL_FIELDS.person
          : GENERAL_FIELDS.container

  const flag = (f: number): boolean => uac !== undefined && (uac & f) !== 0
  const toggle = (f: number, v: boolean): void => setUac((u) => (u === undefined ? u : setFlag(u, f, v)))

  return (
    <Modal
      title={entry ? entry.name : rdnValue(dn)}
      subtitle={dnToCanonical(dn)}
      icon={entry ? <KindIcon kind={entry.kind} size={18} /> : <Settings2 size={18} />}
      size="xwide"
      tall
      bodyFlush
      onClose={() => void close()}
      closeOnBackdrop={false}
      footer={
        <>
          <span className="hint" style={{ marginRight: 'auto' }}>
            {entry ? KIND_LABEL[entry.kind] : ''}
          </span>
          <button className="btn" onClick={() => void close()}>Cerrar</button>
          <button className="btn primary" disabled={!dirty || busy} onClick={() => void save()}>
            {busy && <Spinner size={14} />} Guardar
          </button>
        </>
      }
    >
      <Tabs tabs={tabs} active={tab} onChange={setTab} />

      {loading && <div className="row" style={{ gap: 8, padding: 16 }}><Spinner /> Cargando…</div>}

      {!loading && entry && (
        <div style={{ overflow: 'auto', minHeight: 0, flex: 1 }}>
          {tab === 'general' && (
            <div className="col" style={{ gap: 10, padding: 16 }}>
              <div className="grid-2">
                <Field label="Nombre">
                  <input type="text" value={entry.name} disabled />
                </Field>
                <Field label="Clase de objeto">
                  <input type="text" value={entry.objectClass.slice(-1)[0] ?? ''} disabled />
                </Field>
              </div>
              {generalFields.map((f) => (
                <Text key={f.attr} label={f.label} value={attr(f.attr)} onChange={(v) => setAttr(f.attr, v)} />
              ))}
              {kind === 'group' && (
                <div className="grid-2">
                  <Field label="Ámbito">
                    <input type="text" disabled value={groupScopeLabel(Number(original('groupType') || 0))} />
                  </Field>
                  <Field label="Tipo">
                    <input
                      type="text"
                      disabled
                      value={Number(original('groupType') || 0) < 0 ? 'Seguridad' : 'Distribución'}
                    />
                  </Field>
                </div>
              )}
            </div>
          )}

          {tab === 'account' && (
            <div className="col" style={{ gap: 10, padding: 16 }}>
              <div className="grid-2">
                <Text label="Nombre de inicio de sesión" value={attr('sAMAccountName')} onChange={(v) => setAttr('sAMAccountName', v)} />
                <Text label="userPrincipalName" value={attr('userPrincipalName')} onChange={(v) => setAttr('userPrincipalName', v)} />
              </div>

              <div className="row" style={{ gap: 10, alignItems: 'flex-end' }}>
                <Field label="La cuenta expira el" hint="Vacío = nunca" style={{ flex: 1 }}>
                  <input type="date" value={expires} onChange={(e) => setExpires(e.target.value)} />
                </Field>
                <button className="btn" disabled={!expires} onClick={() => setExpires('')}>Nunca</button>
                {entry.locked && (
                  <button className="btn" onClick={() => void unlockAccounts([dn]).then(load)}>
                    <Unlock size={15} /> Desbloquear
                  </button>
                )}
              </div>

              <div className="col" style={{ gap: 6 }}>
                <Check2
                  label="Cuenta deshabilitada"
                  checked={flag(UAC.ACCOUNTDISABLE)}
                  onChange={(v) => toggle(UAC.ACCOUNTDISABLE, v)}
                />
                <Check2
                  label="El usuario debe cambiar la contraseña en el próximo inicio de sesión"
                  checked={mustChange}
                  disabled={flag(UAC.DONT_EXPIRE_PASSWORD) || cannotChange === true}
                  onChange={setMustChange}
                />
                <Check2
                  label="El usuario no puede cambiar la contraseña"
                  checked={cannotChange ?? false}
                  disabled={cannotChange === undefined}
                  onChange={setCannotChange}
                />
                <Check2
                  label="La contraseña nunca expira"
                  checked={flag(UAC.DONT_EXPIRE_PASSWORD)}
                  onChange={(v) => { toggle(UAC.DONT_EXPIRE_PASSWORD, v); if (v) setMustChange(false) }}
                />
                <Check2
                  label="No se requiere contraseña"
                  checked={flag(UAC.PASSWD_NOTREQD)}
                  onChange={(v) => toggle(UAC.PASSWD_NOTREQD, v)}
                />
                {UAC_TOGGLES.map((t) => (
                  <Check2 key={t.flag} label={t.label} checked={flag(t.flag)} onChange={(v) => toggle(t.flag, v)} />
                ))}
              </div>

              <div className="kv" style={{ marginTop: 6 }}>
                <span className="k">Último inicio de sesión (replicado)</span>
                <span className="v">{fmtDate(filetimeToDate(original('lastLogonTimestamp')))}</span>
                <span className="k">Último cambio de contraseña</span>
                <span className="v">{fmtDate(filetimeToDate(original('pwdLastSet')))}</span>
                <span className="k">Estado</span>
                <span className="v">
                  {entry.disabled ? 'Deshabilitada' : 'Habilitada'}
                  {entry.locked ? ' · Bloqueada' : ''}
                  {entry.expired ? ' · Expirada' : ''}
                </span>
                <span className="k">userAccountControl</span>
                <span className="v mono" title={decodeUAC(uac ?? 0).join(', ')}>
                  {uac ?? '—'} ({decodeUAC(uac ?? 0).length} flags)
                </span>
              </div>
            </div>
          )}

          {tab === 'address' && (
            <div className="col" style={{ gap: 10, padding: 16 }}>
              {ADDRESS_FIELDS.map((f) => (
                <Text key={f.attr} label={f.label} value={attr(f.attr)} onChange={(v) => setAttr(f.attr, v)} />
              ))}
            </div>
          )}

          {tab === 'org' && (
            <div className="col" style={{ gap: 10, padding: 16 }}>
              {ORG_FIELDS.map((f) => (
                <Text key={f.attr} label={f.label} value={attr(f.attr)} onChange={(v) => setAttr(f.attr, v)} />
              ))}
              <div className="row" style={{ gap: 8, alignItems: 'flex-end' }}>
                <Field label="Administrado por" style={{ flex: 1 }}>
                  <input type="text" value={rdnValue(attr('manager'))} disabled />
                </Field>
                <button className="btn" onClick={() => setManagerPicker(true)}>Cambiar…</button>
                <button className="btn" disabled={!attr('manager')} onClick={() => setAttr('manager', '')}>Quitar</button>
              </div>
            </div>
          )}

          {tab === 'members' && <MembersTab dn={dn} mode="members" canSetPrimary={false} />}
          {tab === 'memberOf' && (
            <MembersTab dn={dn} mode="memberOf" canSetPrimary={kind === 'user' || kind === 'inetOrgPerson'} />
          )}

          {tab === 'computer' && (
            <div className="col" style={{ gap: 10, padding: 16 }}>
              <div className="kv">
                <span className="k">Nombre DNS</span>
                <span className="v">{original('dNSHostName') || '—'}</span>
                <span className="k">Sistema operativo</span>
                <span className="v">{original('operatingSystem') || '—'}</span>
                <span className="k">Versión</span>
                <span className="v">{original('operatingSystemVersion') || '—'}</span>
                <span className="k">Nombre de cuenta</span>
                <span className="v mono">{original('sAMAccountName')}</span>
              </div>
              <Text label="Ubicación" value={attr('location')} onChange={(v) => setAttr('location', v)} />
              <Text label="Descripción" value={attr('description')} onChange={(v) => setAttr('description', v)} />
            </div>
          )}

          {tab === 'object' && (
            <div className="col" style={{ gap: 12, padding: 16 }}>
              <div className="kv">
                <span className="k">Nombre completo (DN)</span>
                <span className="v mono">{dn}</span>
                <span className="k">Nombre canónico</span>
                <span className="v">{dnToCanonical(dn)}</span>
                <span className="k">Clases de objeto</span>
                <span className="v">{entry.objectClass.join(', ')}</span>
                <span className="k">Creado</span>
                <span className="v">{fmtDate(generalizedTimeToDate(original('whenCreated')))}</span>
                <span className="k">Modificado</span>
                <span className="v">{fmtDate(generalizedTimeToDate(original('whenChanged')))}</span>
                <span className="k">objectGUID</span>
                <span className="v mono">{entry.objectGUID ?? '—'}</span>
                <span className="k">objectSID</span>
                <span className="v mono">{entry.objectSID ?? '—'}</span>
                <span className="k">USN (creado / actual)</span>
                <span className="v mono">{original('uSNCreated') || '—'} / {original('uSNChanged') || '—'}</span>
              </div>
              <Check2
                label="Proteger el objeto contra eliminación accidental"
                checked={protect ?? false}
                disabled={protect === undefined}
                onChange={setProtect}
              />
            </div>
          )}

          {tab === 'attributes' && <AttributeEditor dn={dn} onChanged={onChanged} />}
          {tab === 'security' && <SecurityTab dn={dn} onDirty={setSecDirty} />}
        </div>
      )}

      {managerPicker && (
        <Picker
          title="Seleccionar administrador"
          kinds={[...PICK_MANAGER]}
          multiple={false}
          onCancel={() => setManagerPicker(false)}
          onConfirm={(entries) => { setAttr('manager', entries[0]?.dn ?? ''); setManagerPicker(false) }}
        />
      )}
    </Modal>
  )
}

function groupScopeLabel(groupType: number): string {
  if (groupType & 0x00000008) return 'Universal'
  if (groupType & 0x00000004) return 'Local de dominio'
  if (groupType & 0x00000001) return 'Local integrada'
  return 'Global'
}
