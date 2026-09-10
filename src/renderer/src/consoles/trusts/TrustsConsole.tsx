import { useCallback, useEffect, useMemo, useState, type JSX } from 'react'
import { Handshake, ShieldCheck, ArrowUpCircle, AtSign, Plus, Trash2, Info } from 'lucide-react'
import type { ForestInfo, PartitionInfo, SessionInfo, TrustInfo } from '@shared/types'
import ConsoleShell from '../../shell/ConsoleShell'
import SimpleTree, { type TreeItem } from '../../shell/SimpleTree'
import DetailList from '../../shell/DetailList'
import { Modal, Field, Text, Check2, MenuPopup, useConfirm, type MenuItemDef } from '../../components/ui'
import { useApp, report } from '../../store'
import { fmtDate, functionalLevel, FUNCTIONAL_LEVELS } from '../../lib/format'

type Selection =
  | { kind: 'forest' }
  | { kind: 'domains' }
  | { kind: 'trusts' }
  | { kind: 'trust'; trust: TrustInfo }
  | { kind: 'suffixes' }

export default function TrustsConsole(): JSX.Element {
  const session = useApp((s) => s.session)
  const confirm = useConfirm()

  const [forest, setForest] = useState<ForestInfo | null>(null)
  const [loading, setLoading] = useState(false)
  const [selection, setSelection] = useState<Selection>({ kind: 'forest' })
  const [selectedId, setSelectedId] = useState('forest')
  const [ctx, setCtx] = useState<{ items: MenuItemDef[]; x: number; y: number } | null>(null)
  const [dialog, setDialog] = useState<
    | null
    | { t: 'trust'; trust: TrustInfo }
    | { t: 'suffixes' }
    | { t: 'raise'; scope: 'domain' | 'forest' }
  >(null)

  const load = useCallback(async (): Promise<void> => {
    setLoading(true)
    const res = await window.adeep.trusts.forest()
    setLoading(false)
    const data = report(res)
    if (data) setForest(data)
  }, [])

  const onSession = useCallback((_info: SessionInfo) => { void load() }, [load])

  const tree = useMemo<TreeItem[]>(() => {
    if (!forest) return []
    const domains = forest.partitions.filter((p) => p.isDomain)
    return [
      {
        id: 'forest',
        label: forest.rootDomain.replace(/DC=/gi, '').replace(/,/g, '.') || 'Bosque',
        kind: 'forest',
        children: [
          {
            id: 'domains',
            label: 'Dominios del bosque',
            kind: 'partition',
            badge: String(domains.length),
            children: domains.map((d) => ({
              id: d.dn,
              label: d.dnsRoot,
              kind: 'domain' as const,
              badge: d.netbiosName
            }))
          },
          {
            id: 'trusts',
            label: 'Relaciones de confianza',
            kind: 'trust',
            badge: String(forest.trusts.length),
            children: forest.trusts.map((t) => ({
              id: t.dn,
              label: t.partner,
              kind: 'trust' as const,
              badge: t.directionLabel
            }))
          },
          { id: 'suffixes', label: 'Sufijos UPN', kind: 'container', badge: String(forest.upnSuffixes.length) }
        ]
      }
    ]
  }, [forest])

  const onSelect = (item: TreeItem): void => {
    setSelectedId(item.id)
    if (item.id === 'forest') return setSelection({ kind: 'forest' })
    if (item.id === 'domains') return setSelection({ kind: 'domains' })
    if (item.id === 'trusts') return setSelection({ kind: 'trusts' })
    if (item.id === 'suffixes') return setSelection({ kind: 'suffixes' })
    const trust = forest?.trusts.find((t) => t.dn === item.id)
    if (trust) return setSelection({ kind: 'trust', trust })
    setSelection({ kind: 'domains' })
  }

  const trustMenu = (trust: TrustInfo): MenuItemDef[] => [
    { id: 'props', label: 'Propiedades…', icon: <ShieldCheck size={15} />, onSelect: () => setDialog({ t: 'trust', trust }) },
    { id: 's1', separator: true },
    {
      id: 'del', label: 'Eliminar la confianza', icon: <Trash2 size={15} />, danger: true,
      onSelect: () => void (async () => {
        await confirm({
          title: 'Eliminar una confianza',
          message: 'ADeep no elimina confianzas.',
          detail:
            'Borrar sólo el objeto trustedDomain de AD deja la confianza a medio quitar: el secreto ' +
            'compartido sigue en la base de datos LSA de los dos dominios. Usá netdom trust /remove ' +
            'o Remove-ADTrust desde el DC.',
          confirmLabel: 'Entendido'
        })
      })()
    }
  ]

  const main = ((): JSX.Element => {
    if (!forest) return <div className="empty-state"><div className="title">Sin datos</div></div>

    switch (selection.kind) {
      case 'forest':
        return (
          <div style={{ padding: 16, overflow: 'auto' }}>
            <div className="kv">
              <span className="k">Bosque</span>
              <span className="v">{forest.rootDomain.replace(/DC=/gi, '').replace(/,/g, '.')}</span>
              <span className="k">Nivel funcional del bosque</span>
              <span className="v">
                {functionalLevel(forest.forestFunctionality)}
                <button className="btn sm ghost" style={{ marginLeft: 8 }} onClick={() => setDialog({ t: 'raise', scope: 'forest' })}>
                  Elevar…
                </button>
              </span>
              <span className="k">Nivel funcional del dominio</span>
              <span className="v">
                {functionalLevel(forest.domainFunctionality)}
                <button className="btn sm ghost" style={{ marginLeft: 8 }} onClick={() => setDialog({ t: 'raise', scope: 'domain' })}>
                  Elevar…
                </button>
              </span>
              <span className="k">Dominios</span>
              <span className="v">{forest.partitions.filter((p) => p.isDomain).length}</span>
              <span className="k">Particiones de aplicación</span>
              <span className="v">{forest.partitions.filter((p) => p.isApplicationPartition).length}</span>
              <span className="k">Confianzas</span>
              <span className="v">{forest.trusts.length}</span>
              <span className="k">Sufijos UPN alternativos</span>
              <span className="v">{forest.upnSuffixes.join(', ') || '—'}</span>
              <span className="k">Contenedor de particiones</span>
              <span className="v mono">{forest.partitionsDN}</span>
            </div>
          </div>
        )

      case 'domains':
        return (
          <DetailList
            rows={forest.partitions}
            rowKey={(p) => p.dn}
            rowKind={(p) => (p.isDomain ? 'domain' : 'partition')}
            empty="No hay particiones"
            columns={[
              { id: 'dns', label: 'Nombre', width: '30%', render: (p) => p.dnsRoot || p.name, sortValue: (p) => p.dnsRoot },
              { id: 'nb', label: 'NetBIOS', width: 140, render: (p) => p.netbiosName ?? '—' },
              {
                id: 'type', label: 'Tipo', width: 180,
                render: (p) => (p.isDomain ? 'Dominio' : p.isApplicationPartition ? 'Partición de aplicación' : 'Configuración'),
                sortValue: (p) => (p.isDomain ? 0 : 1)
              },
              {
                id: 'level', label: 'Nivel funcional', width: 200,
                render: (p) => (p.behaviorVersion !== undefined ? functionalLevel(p.behaviorVersion) : '—')
              },
              { id: 'nc', label: 'Contexto de nombres', render: (p) => <span className="mono">{p.ncName}</span> }
            ]}
          />
        )

      case 'trusts':
        return (
          <DetailList
            rows={forest.trusts}
            rowKey={(t) => t.dn}
            rowKind={() => 'trust'}
            onOpen={(t) => setDialog({ t: 'trust', trust: t })}
            onContextMenu={(t, x, y) => setCtx({ items: trustMenu(t), x, y })}
            empty="Este dominio no tiene relaciones de confianza"
            columns={[
              { id: 'partner', label: 'Dominio', width: '25%', render: (t) => t.partner, sortValue: (t) => t.partner },
              { id: 'dir', label: 'Dirección', width: 140, render: (t) => t.directionLabel },
              { id: 'type', label: 'Tipo', width: 160, render: (t) => t.typeLabel },
              {
                id: 'trans', label: 'Transitiva', width: 110,
                render: (t) => (t.transitive ? 'Sí' : 'No')
              },
              {
                id: 'sid', label: 'Filtrado de SID', width: 140,
                render: (t) => (t.sidFiltering ? <span className="badge ok">Activado</span> : <span className="badge warn">Desactivado</span>)
              },
              { id: 'created', label: 'Creada', width: 160, render: (t) => fmtDate(t.whenCreated) }
            ]}
          />
        )

      case 'trust': {
        const t = selection.trust
        return (
          <div style={{ padding: 16, overflow: 'auto' }}>
            <div className="row" style={{ justifyContent: 'space-between', marginBottom: 12 }}>
              <div className="lbl">{t.partner}</div>
              <button className="btn sm" onClick={() => setDialog({ t: 'trust', trust: t })}>Propiedades…</button>
            </div>
            <div className="kv">
              <span className="k">Nombre NetBIOS</span>
              <span className="v">{t.flatName ?? '—'}</span>
              <span className="k">Dirección</span>
              <span className="v">{t.directionLabel}</span>
              <span className="k">Tipo</span>
              <span className="v">{t.typeLabel}</span>
              <span className="k">Transitiva</span>
              <span className="v">{t.transitive ? 'Sí' : 'No'}</span>
              <span className="k">Filtrado de SID</span>
              <span className="v">{t.sidFiltering ? 'Activado' : 'Desactivado'}</span>
              <span className="k">Autenticación selectiva</span>
              <span className="v">{t.selectiveAuth ? 'Sí' : 'No'}</span>
              <span className="k">SID del dominio</span>
              <span className="v mono">{t.sid ?? '—'}</span>
              <span className="k">trustAttributes</span>
              <span className="v mono">0x{t.attributes.toString(16)}</span>
              <span className="k">Atributos</span>
              <span className="v">{t.attributeLabels.join(', ') || '—'}</span>
              <span className="k">Espacios de nombres</span>
              <span className="v">{t.forestNamespaces?.join(', ') || '—'}</span>
              <span className="k">Creada</span>
              <span className="v">{fmtDate(t.whenCreated)}</span>
              <span className="k">Modificada</span>
              <span className="v">{fmtDate(t.whenChanged)}</span>
            </div>
          </div>
        )
      }

      case 'suffixes':
        return (
          <div style={{ padding: 16, overflow: 'auto' }}>
            <div className="row" style={{ justifyContent: 'space-between', marginBottom: 12 }}>
              <div className="lbl">Sufijos UPN alternativos del bosque</div>
              <button className="btn sm" onClick={() => setDialog({ t: 'suffixes' })}>
                <Plus size={13} /> Administrar
              </button>
            </div>
            {forest.upnSuffixes.length ? (
              <div className="mini-table-wrap">
                <table className="mini">
                  <tbody>
                    {forest.upnSuffixes.map((s) => (
                      <tr key={s}><td><AtSign size={13} style={{ verticalAlign: -2 }} /> {s}</td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="hint">
                No hay sufijos alternativos. Los usuarios sólo pueden usar
                @{session.rootDSE?.defaultNamingContext?.replace(/DC=/gi, '').replace(/,/g, '.')}.
              </div>
            )}
          </div>
        )
    }
  })()

  return (
    <>
      <ConsoleShell
        title="ADeep — Dominios y confianzas de Active Directory"
        icon={<Handshake size={17} />}
        treeTitle="Dominios y confianzas"
        loading={loading}
        onRefresh={() => void load()}
        onSession={onSession}
        menus={{
          Acción: [
            { id: 'suffixes', label: 'Sufijos UPN…', icon: <AtSign size={15} />, onSelect: () => setDialog({ t: 'suffixes' }) },
            { id: 's1', separator: true },
            { id: 'raiseD', label: 'Elevar el nivel funcional del dominio…', icon: <ArrowUpCircle size={15} />, onSelect: () => setDialog({ t: 'raise', scope: 'domain' }) },
            { id: 'raiseF', label: 'Elevar el nivel funcional del bosque…', icon: <ArrowUpCircle size={15} />, onSelect: () => setDialog({ t: 'raise', scope: 'forest' }) }
          ]
        }}
        toolbar={
          <>
            <button className="tool" title="Sufijos UPN" onClick={() => setDialog({ t: 'suffixes' })}>
              <AtSign size={16} />
            </button>
            <span className="hint" style={{ paddingLeft: 8 }}>
              {forest ? `${forest.trusts.length} confianza(s)` : ''}
            </span>
          </>
        }
        tree={
          <SimpleTree
            items={tree}
            selectedId={selectedId}
            onSelect={onSelect}
            defaultExpanded={['forest', 'domains', 'trusts']}
            onContextMenu={(item, x, y) => {
              const trust = forest?.trusts.find((t) => t.dn === item.id)
              if (trust) setCtx({ items: trustMenu(trust), x, y })
            }}
          />
        }
        main={main}
        status={
          <span className="seg">
            {forest
              ? `Bosque ${functionalLevel(forest.forestFunctionality)} · dominio ${functionalLevel(forest.domainFunctionality)}`
              : 'Sin datos'}
          </span>
        }
      />

      {ctx && <MenuPopup items={ctx.items} x={ctx.x} y={ctx.y} onClose={() => setCtx(null)} />}

      {dialog?.t === 'trust' && (
        <TrustDialog
          trust={dialog.trust}
          onClose={() => setDialog(null)}
          onSaved={() => { setDialog(null); void load() }}
        />
      )}

      {dialog?.t === 'suffixes' && forest && (
        <SuffixesDialog
          initial={forest.upnSuffixes}
          onClose={() => setDialog(null)}
          onSaved={() => { setDialog(null); void load() }}
        />
      )}

      {dialog?.t === 'raise' && forest && (
        <RaiseLevelDialog
          scope={dialog.scope}
          current={dialog.scope === 'domain' ? forest.domainFunctionality : forest.forestFunctionality}
          onClose={() => setDialog(null)}
          onDone={() => { setDialog(null); void load() }}
        />
      )}
    </>
  )
}

/* ---------------- Diálogos ---------------- */

function TrustDialog({
  trust, onClose, onSaved
}: {
  trust: TrustInfo
  onClose: () => void
  onSaved: () => void
}): JSX.Element {
  const [sidFiltering, setSidFiltering] = useState(trust.sidFiltering)
  const [selectiveAuth, setSelectiveAuth] = useState(trust.selectiveAuth)
  const [busy, setBusy] = useState(false)

  const save = async (): Promise<void> => {
    setBusy(true)
    const res = await window.adeep.trusts.update(trust.dn, { sidFiltering, selectiveAuth })
    setBusy(false)
    if (report(res, 'Confianza actualizada') !== undefined) onSaved()
  }

  const dirty = sidFiltering !== trust.sidFiltering || selectiveAuth !== trust.selectiveAuth

  return (
    <Modal
      title={trust.partner}
      subtitle={`${trust.typeLabel} · ${trust.directionLabel}`}
      icon={<Handshake size={18} color="var(--accent)" />}
      onClose={onClose}
      footer={
        <>
          <div className="spacer" style={{ flex: 1 }} />
          <button className="btn" onClick={onClose}>Cerrar</button>
          <button className="btn primary" disabled={!dirty || busy} onClick={() => void save()}>Guardar</button>
        </>
      }
    >
      <div className="col" style={{ gap: 12 }}>
        <Check2
          label="Cuarentena: aplicar filtrado de SID"
          checked={sidFiltering}
          onChange={setSidFiltering}
          hint="Descarta los SID de otros dominios que lleguen por esta confianza. Recomendado en confianzas externas."
        />
        <Check2
          label="Autenticación selectiva"
          checked={selectiveAuth}
          onChange={setSelectiveAuth}
          hint="Los usuarios del dominio de confianza necesitan el permiso «Autenticación permitida» en cada recurso."
        />
        <div className="kv" style={{ marginTop: 4 }}>
          <span className="k">SID</span>
          <span className="v mono">{trust.sid ?? '—'}</span>
          <span className="k">trustAttributes</span>
          <span className="v mono">0x{trust.attributes.toString(16)}</span>
        </div>
        <div className="row" style={{ gap: 8, alignItems: 'flex-start', color: 'var(--text-dim)', fontSize: 12 }}>
          <Info size={15} />
          <span>
            Crear, validar o restablecer una confianza requiere LSA RPC y no se puede hacer por LDAP.
            Desde acá sólo se administran los atributos que viven en el directorio.
          </span>
        </div>
      </div>
    </Modal>
  )
}

function SuffixesDialog({
  initial, onClose, onSaved
}: {
  initial: string[]
  onClose: () => void
  onSaved: () => void
}): JSX.Element {
  const [list, setList] = useState<string[]>(initial)
  const [value, setValue] = useState('')
  const [busy, setBusy] = useState(false)

  const add = (): void => {
    const clean = value.trim().replace(/^@/, '')
    if (!clean || list.includes(clean)) return
    setList([...list, clean])
    setValue('')
  }

  const save = async (): Promise<void> => {
    setBusy(true)
    const res = await window.adeep.trusts.setUpnSuffixes(list)
    setBusy(false)
    if (report(res, 'Sufijos UPN guardados') !== undefined) onSaved()
  }

  return (
    <Modal
      title="Sufijos UPN alternativos"
      subtitle="Se aplican a todo el bosque"
      icon={<AtSign size={18} color="var(--accent)" />}
      onClose={onClose}
      footer={
        <>
          <div className="spacer" style={{ flex: 1 }} />
          <button className="btn" onClick={onClose}>Cancelar</button>
          <button className="btn primary" disabled={busy} onClick={() => void save()}>Guardar</button>
        </>
      }
    >
      <div className="row" style={{ gap: 8, alignItems: 'flex-end' }}>
        <Text label="Nuevo sufijo" value={value} onChange={setValue} placeholder="empresa.com.ar" style={{ flex: 1 }} onEnter={add} />
        <button className="btn" onClick={add} disabled={!value.trim()}>Agregar</button>
      </div>
      <div className="mini-table-wrap" style={{ marginTop: 12, maxHeight: 240, overflow: 'auto' }}>
        <table className="mini">
          <tbody>
            {list.map((s) => (
              <tr key={s}>
                <td>@{s}</td>
                <td style={{ width: 60, textAlign: 'right' }}>
                  <button className="btn sm ghost icon" onClick={() => setList(list.filter((x) => x !== s))}>
                    <Trash2 size={13} />
                  </button>
                </td>
              </tr>
            ))}
            {!list.length && <tr><td className="hint">Sin sufijos alternativos.</td></tr>}
          </tbody>
        </table>
      </div>
    </Modal>
  )
}

function RaiseLevelDialog({
  scope, current, onClose, onDone
}: {
  scope: 'domain' | 'forest'
  current: number
  onClose: () => void
  onDone: () => void
}): JSX.Element {
  const [level, setLevel] = useState(current + 1)
  const [busy, setBusy] = useState(false)
  const [maxSupported, setMaxSupported] = useState<number>()
  const [confirmText, setConfirmText] = useState('')

  useEffect(() => {
    void (async () => {
      const res = await window.adeep.trusts.maxSupportedLevel()
      if (res.ok) setMaxSupported(res.data)
    })()
  }, [])

  const options = Object.keys(FUNCTIONAL_LEVELS)
    .map(Number)
    .filter((n) => n > current)

  const raise = async (): Promise<void> => {
    setBusy(true)
    const res = scope === 'domain'
      ? await window.adeep.trusts.raiseDomainLevel(level)
      : await window.adeep.trusts.raiseForestLevel(level)
    setBusy(false)
    if (report(res, 'Nivel funcional elevado') !== undefined) onDone()
  }

  return (
    <Modal
      title={scope === 'domain' ? 'Elevar el nivel funcional del dominio' : 'Elevar el nivel funcional del bosque'}
      icon={<ArrowUpCircle size={18} color="var(--warn)" />}
      onClose={onClose}
      footer={
        <>
          <div className="spacer" style={{ flex: 1 }} />
          <button className="btn" onClick={onClose}>Cancelar</button>
          <button
            className="btn danger"
            disabled={busy || confirmText.trim().toUpperCase() !== 'ELEVAR' || !options.length}
            onClick={() => void raise()}
          >
            Elevar
          </button>
        </>
      }
    >
      <div className="col" style={{ gap: 12 }}>
        <div className="kv">
          <span className="k">Nivel actual</span>
          <span className="v">{functionalLevel(current)}</span>
          {maxSupported !== undefined && (
            <>
              <span className="k">Máximo que soportan los DC</span>
              <span className="v">{functionalLevel(maxSupported)}</span>
            </>
          )}
        </div>

        {options.length ? (
          <Field label="Nuevo nivel">
            <select value={level} onChange={(e) => setLevel(Number(e.target.value))}>
              {options.map((n) => (
                <option key={n} value={n} disabled={maxSupported !== undefined && n > maxSupported}>
                  {functionalLevel(n)}
                  {maxSupported !== undefined && n > maxSupported ? ' — no soportado por todos los DC' : ''}
                </option>
              ))}
            </select>
          </Field>
        ) : (
          <div className="hint">Ya está en el nivel máximo conocido.</div>
        )}

        <div style={{ color: 'var(--danger)', fontSize: 13 }}>
          Esta operación es irreversible y se replica a todo el {scope === 'domain' ? 'dominio' : 'bosque'}.
          Los controladores con un sistema operativo anterior dejarán de poder unirse.
        </div>
        <Text
          label="Escribí ELEVAR para confirmar"
          value={confirmText}
          onChange={setConfirmText}
        />
      </div>
    </Modal>
  )
}
