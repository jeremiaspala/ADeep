import { useCallback, useMemo, useState, type JSX } from 'react'
import {
  ScrollText, Link2, Unlink, ArrowUp, ArrowDown, ShieldCheck, Ban, Filter, Info
} from 'lucide-react'
import type { GpoInfo, GpoScope, SessionInfo, WmiFilter } from '@shared/types'
import ConsoleShell from '../../shell/ConsoleShell'
import SimpleTree, { type TreeItem } from '../../shell/SimpleTree'
import DetailList from '../../shell/DetailList'
import { Modal, MenuPopup, useConfirm, type MenuItemDef } from '../../components/ui'
import { report, useApp } from '../../store'
import { fmtDate } from '../../lib/format'

const LINK_DISABLED = 0x1
const LINK_ENFORCED = 0x2

type Vista =
  | { t: 'gpos' }
  | { t: 'scope'; scope: GpoScope }
  | { t: 'gpo'; gpo: GpoInfo }
  | { t: 'wmi' }

export default function GpoConsole(): JSX.Element {
  const confirm = useConfirm()
  const toast = useApp((s) => s.toast)

  const [gpos, setGpos] = useState<GpoInfo[]>([])
  const [scopes, setScopes] = useState<GpoScope[]>([])
  const [wmi, setWmi] = useState<WmiFilter[]>([])
  const [loading, setLoading] = useState(false)
  const [vista, setVista] = useState<Vista>({ t: 'gpos' })
  const [selectedId, setSelectedId] = useState('gpos')
  const [ctx, setCtx] = useState<{ items: MenuItemDef[]; x: number; y: number } | null>(null)
  const [dialog, setDialog] = useState<null | { t: 'link'; scope: GpoScope }>(null)

  const cargar = useCallback(async (): Promise<void> => {
    setLoading(true)
    const [g, s, w] = await Promise.all([
      window.adeep.gpo.list(),
      window.adeep.gpo.scopes(),
      window.adeep.gpo.wmiFilters()
    ])
    setLoading(false)
    if (report(g) !== undefined) setGpos(g.data ?? [])
    if (s.ok) setScopes(s.data ?? [])
    if (w.ok) setWmi(w.data ?? [])
  }, [])

  const onSession = useCallback((_i: SessionInfo) => { void cargar() }, [cargar])

  /** Los ámbitos con vínculos primero: es lo que uno viene a mirar. */
  const conVinculos = useMemo(() => scopes.filter((s) => s.links.length || s.blockInheritance), [scopes])

  const tree = useMemo<TreeItem[]>(() => [
    {
      id: 'raiz',
      label: 'Directivas de grupo',
      kind: 'domain',
      children: [
        { id: 'gpos', label: 'Objetos de directiva', kind: 'container', badge: String(gpos.length) },
        {
          id: 'ambitos',
          label: 'Dónde se aplican',
          kind: 'ou',
          badge: String(conVinculos.length),
          children: conVinculos.map((s) => ({
            id: s.dn,
            label: s.name,
            kind: s.type === 'domain' ? 'domain' : s.type === 'site' ? 'site' : 'ou',
            badge: s.blockInheritance ? `${s.links.length} ⃠` : String(s.links.length)
          }))
        },
        { id: 'wmi', label: 'Filtros WMI', kind: 'container', badge: String(wmi.length) }
      ]
    }
  ], [gpos, conVinculos, wmi])

  const recargarYVer = async (scopeDN?: string): Promise<void> => {
    await cargar()
    if (!scopeDN) return
    const res = await window.adeep.gpo.scopes()
    const actualizado = (res.data ?? []).find((s) => s.dn === scopeDN)
    if (actualizado) setVista({ t: 'scope', scope: actualizado })
  }

  const menuVinculo = (scope: GpoScope, gpoDN: string, options: number): MenuItemDef[] => [
    {
      id: 'enforced', label: 'Exigido', checked: (options & LINK_ENFORCED) !== 0,
      onSelect: () => void (async () => {
        const res = await window.adeep.gpo.setLinkOptions(scope.dn, gpoDN, options ^ LINK_ENFORCED)
        if (report(res, 'Vínculo actualizado') !== undefined) await recargarYVer(scope.dn)
      })()
    },
    {
      id: 'enabled', label: 'Vínculo habilitado', checked: (options & LINK_DISABLED) === 0,
      onSelect: () => void (async () => {
        const res = await window.adeep.gpo.setLinkOptions(scope.dn, gpoDN, options ^ LINK_DISABLED)
        if (report(res, 'Vínculo actualizado') !== undefined) await recargarYVer(scope.dn)
      })()
    },
    { id: 's1', separator: true },
    {
      id: 'up', label: 'Subir en la precedencia', icon: <ArrowUp size={15} />,
      onSelect: () => void (async () => {
        const res = await window.adeep.gpo.moveLink(scope.dn, gpoDN, -1)
        if (report(res, 'Orden actualizado') !== undefined) await recargarYVer(scope.dn)
      })()
    },
    {
      id: 'down', label: 'Bajar en la precedencia', icon: <ArrowDown size={15} />,
      onSelect: () => void (async () => {
        const res = await window.adeep.gpo.moveLink(scope.dn, gpoDN, 1)
        if (report(res, 'Orden actualizado') !== undefined) await recargarYVer(scope.dn)
      })()
    },
    { id: 's2', separator: true },
    {
      id: 'unlink', label: 'Quitar el vínculo', icon: <Unlink size={15} />, danger: true,
      onSelect: () => void (async () => {
        const ok = await confirm({
          title: 'Quitar vínculo',
          message: `¿Dejar de aplicar esta directiva en "${scope.name}"?`,
          detail: 'La directiva no se borra: sólo se saca el vínculo de este ámbito.',
          danger: true,
          confirmLabel: 'Quitar'
        })
        if (!ok) return
        const res = await window.adeep.gpo.unlink(scope.dn, gpoDN)
        if (report(res, 'Vínculo quitado') !== undefined) await recargarYVer(scope.dn)
      })()
    }
  ]

  const main = ((): JSX.Element => {
    switch (vista.t) {
      case 'gpos':
        return (
          <DetailList
            rows={gpos}
            rowKey={(g) => g.dn}
            rowKind={() => 'container'}
            onOpen={(g) => { setVista({ t: 'gpo', gpo: g }); setSelectedId(g.dn) }}
            empty="El dominio no tiene directivas de grupo"
            columns={[
              { id: 'name', label: 'Directiva', width: '30%', render: (g) => g.name, sortValue: (g) => g.name },
              {
                id: 'links', label: 'Vínculos', width: 100,
                render: (g) => (g.linkCount ? g.linkCount : <span className="badge warn">0</span>),
                sortValue: (g) => g.linkCount
              },
              {
                id: 'status', label: 'Estado', width: 220,
                render: (g) => (g.flags === 0 ? 'Habilitado' : <span className="badge warn">{g.statusLabel}</span>),
                sortValue: (g) => g.flags
              },
              {
                id: 'ver', label: 'Versión (equipo/usuario)', width: 190,
                render: (g) => `${g.computerVersion} / ${g.userVersion}`
              },
              { id: 'changed', label: 'Modificada', width: 160, render: (g) => fmtDate(g.changed), sortValue: (g) => g.changed ?? '' }
            ]}
          />
        )

      case 'scope': {
        const s = vista.scope
        return (
          <>
            <div className="list-head">
              <div className="crumbs">
                <span className="crumb">{s.type === 'domain' ? 'Dominio' : s.type === 'site' ? 'Sitio' : 'Unidad organizativa'}</span>
                <span className="sepr">›</span>
                <span className="crumb last">{s.name}</span>
              </div>
              <div className="spacer" style={{ flex: 1 }} />
              <button className="btn sm" onClick={() => setDialog({ t: 'link', scope: s })}>
                <Link2 size={13} /> Vincular directiva
              </button>
              <button
                className={`btn sm ${s.blockInheritance ? 'danger' : ''}`}
                onClick={() => void (async () => {
                  const res = await window.adeep.gpo.setBlockInheritance(s.dn, !s.blockInheritance)
                  if (report(res, 'Herencia actualizada') !== undefined) await recargarYVer(s.dn)
                })()}
              >
                <Ban size={13} /> {s.blockInheritance ? 'Quitar bloqueo de herencia' : 'Bloquear herencia'}
              </button>
            </div>
            <DetailList
              rows={s.links}
              rowKey={(l) => l.gpoDN}
              rowKind={() => 'container'}
              onContextMenu={(l, x, y) => setCtx({ items: menuVinculo(s, l.gpoDN, l.options), x, y })}
              empty="No hay directivas vinculadas a este ámbito"
              columns={[
                { id: 'order', label: 'Orden', width: 80, render: (l) => l.order, sortValue: (l) => l.order },
                { id: 'name', label: 'Directiva', width: '38%', render: (l) => l.gpoName },
                {
                  id: 'enforced', label: 'Exigido', width: 110,
                  render: (l) => (l.enforced ? <span className="badge accent">Sí</span> : 'No')
                },
                {
                  id: 'enabled', label: 'Vínculo', width: 140,
                  render: (l) => (l.enabled ? 'Habilitado' : <span className="badge warn">Deshabilitado</span>)
                },
                { id: 'dn', label: 'GPO', render: (l) => <span className="mono">{l.gpoDN.split(',')[0]}</span> }
              ]}
            />
            {s.blockInheritance && (
              <div style={{ padding: '10px 16px', background: 'var(--warn-soft)', fontSize: 12.5 }}>
                Este ámbito bloquea la herencia: sólo se aplican estas directivas y las marcadas
                como exigidas en niveles superiores.
              </div>
            )}
          </>
        )
      }

      case 'gpo': {
        const g = vista.gpo
        const vinculada = scopes.filter((s) => s.links.some((l) => l.gpoDN.toLowerCase() === g.dn.toLowerCase()))
        return (
          <>
            <div className="list-head">
              <div className="crumbs"><span className="crumb last">{g.name}</span></div>
              <div className="spacer" style={{ flex: 1 }} />
              <button
                className="btn sm"
                onClick={(e) => {
                  const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
                  setCtx({
                    items: [
                      { id: 'st', title: 'Estado de la directiva' },
                      ...[0, 1, 2, 3].map((f) => ({
                        id: `f${f}`,
                        label: ['Habilitada', 'Configuración de usuario deshabilitada',
                          'Configuración de equipo deshabilitada', 'Todo deshabilitado'][f],
                        checked: g.flags === f,
                        onSelect: () => void (async () => {
                          const res = await window.adeep.gpo.setStatus(g.dn, f)
                          if (report(res, 'Estado actualizado') !== undefined) {
                            await cargar()
                            setVista({ t: 'gpo', gpo: { ...g, flags: f } })
                          }
                        })()
                      }))
                    ],
                    x: r.left - 150, y: r.bottom + 4
                  })
                }}
              >
                <ShieldCheck size={13} /> Estado
              </button>
            </div>
            <div style={{ padding: 16, overflow: 'auto' }}>
              <div className="kv" style={{ marginBottom: 16 }}>
                <span className="k">Identificador</span>
                <span className="v mono">{g.guid}</span>
                <span className="k">Estado</span>
                <span className="v">{g.statusLabel}</span>
                <span className="k">Versión</span>
                <span className="v">equipo {g.computerVersion} · usuario {g.userVersion}</span>
                <span className="k">Extensiones configuradas</span>
                <span className="v">{g.machineExtensions} de equipo, {g.userExtensions} de usuario</span>
                <span className="k">Filtro WMI</span>
                <span className="v">{g.wmiFilter ?? '—'}</span>
                <span className="k">Creada</span>
                <span className="v">{fmtDate(g.created)}</span>
                <span className="k">Modificada</span>
                <span className="v">{fmtDate(g.changed)}</span>
                <span className="k">Archivos en SYSVOL</span>
                <span className="v mono">{g.path || '—'}</span>
              </div>

              <div className="lbl" style={{ marginBottom: 6 }}>Se aplica en ({vinculada.length})</div>
              <div className="mini-table-wrap">
                <table className="mini">
                  <thead>
                    <tr><th style={{ width: '40%' }}>Ámbito</th><th style={{ width: 120 }}>Tipo</th><th>Estado del vínculo</th></tr>
                  </thead>
                  <tbody>
                    {vinculada.map((s) => {
                      const l = s.links.find((x) => x.gpoDN.toLowerCase() === g.dn.toLowerCase())!
                      return (
                        <tr key={s.dn} onClick={() => { setVista({ t: 'scope', scope: s }); setSelectedId(s.dn) }}>
                          <td>{s.name}</td>
                          <td>{s.type === 'domain' ? 'Dominio' : s.type === 'site' ? 'Sitio' : 'OU'}</td>
                          <td>
                            orden {l.order}
                            {l.enforced ? ' · exigido' : ''}
                            {l.enabled ? '' : ' · deshabilitado'}
                          </td>
                        </tr>
                      )
                    })}
                    {!vinculada.length && (
                      <tr><td colSpan={3} className="hint">No está vinculada en ningún lado: no se aplica a nadie.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>

              <div className="row" style={{ gap: 8, marginTop: 16, alignItems: 'flex-start', fontSize: 12.5, color: 'var(--text-dim)' }}>
                <Info size={15} />
                <span>
                  El contenido de la directiva (las opciones que configura) vive en SYSVOL, no en el
                  directorio. Desde acá se administra dónde se aplica, en qué orden y con qué estado.
                </span>
              </div>
            </div>
          </>
        )
      }

      case 'wmi':
        return (
          <DetailList
            rows={wmi}
            rowKey={(w) => w.dn}
            rowKind={() => 'container'}
            empty="El dominio no tiene filtros WMI"
            columns={[
              { id: 'name', label: 'Filtro', width: '25%', render: (w) => w.name, sortValue: (w) => w.name },
              { id: 'desc', label: 'Descripción', width: '25%', render: (w) => w.description ?? '' },
              { id: 'query', label: 'Consulta', render: (w) => <span className="mono">{w.query}</span> }
            ]}
          />
        )
    }
  })()

  return (
    <>
      <ConsoleShell
        title="ADeep — Directivas de grupo"
        icon={<ScrollText size={17} />}
        treeTitle="Directivas de grupo"
        loading={loading}
        onRefresh={() => void cargar()}
        onSession={onSession}
        menus={{
          Acción: [
            {
              id: 'sin', label: 'Ver directivas sin vincular', icon: <Filter size={15} />,
              onSelect: () => {
                const sueltas = gpos.filter((g) => g.linkCount === 0)
                setVista({ t: 'gpos' })
                setSelectedId('gpos')
                toast('info', `${sueltas.length} de ${gpos.length} directivas no están vinculadas en ningún ámbito`)
              }
            }
          ]
        }}
        toolbar={
          <span className="hint" style={{ paddingLeft: 4 }}>
            {gpos.length} directivas · {gpos.filter((g) => g.linkCount === 0).length} sin vincular
          </span>
        }
        tree={
          <SimpleTree
            items={tree}
            selectedId={selectedId}
            defaultExpanded={['raiz', 'ambitos']}
            onSelect={(item) => {
              setSelectedId(item.id)
              if (item.id === 'gpos') return setVista({ t: 'gpos' })
              if (item.id === 'wmi') return setVista({ t: 'wmi' })
              const s = scopes.find((x) => x.dn === item.id)
              if (s) setVista({ t: 'scope', scope: s })
            }}
          />
        }
        main={main}
        status={
          <span className="seg">
            {vista.t === 'scope'
              ? `${vista.scope.links.length} directiva(s) vinculada(s)`
              : `${gpos.length} directiva(s) · ${scopes.filter((s) => s.links.length).length} ámbito(s) con vínculos`}
          </span>
        }
      />

      {ctx && <MenuPopup items={ctx.items} x={ctx.x} y={ctx.y} onClose={() => setCtx(null)} />}

      {dialog?.t === 'link' && (
        <VincularDialog
          scope={dialog.scope}
          gpos={gpos}
          onClose={() => setDialog(null)}
          onLinked={async () => { setDialog(null); await recargarYVer(dialog.scope.dn) }}
        />
      )}
    </>
  )
}

function VincularDialog({
  scope, gpos, onClose, onLinked
}: {
  scope: GpoScope
  gpos: GpoInfo[]
  onClose: () => void
  onLinked: () => void
}): JSX.Element {
  const [elegida, setElegida] = useState<string>()
  const [busy, setBusy] = useState(false)
  const yaVinculadas = new Set(scope.links.map((l) => l.gpoDN.toLowerCase()))
  const disponibles = gpos.filter((g) => !yaVinculadas.has(g.dn.toLowerCase()))

  const vincular = async (): Promise<void> => {
    if (!elegida) return
    setBusy(true)
    const res = await window.adeep.gpo.link(scope.dn, elegida)
    setBusy(false)
    if (report(res, 'Directiva vinculada') !== undefined) onLinked()
  }

  return (
    <Modal
      title="Vincular una directiva"
      subtitle={scope.name}
      icon={<Link2 size={18} color="var(--accent)" />}
      size="wide"
      onClose={onClose}
      footer={
        <>
          <span className="hint" style={{ marginRight: 'auto' }}>
            Queda primera en el orden de precedencia
          </span>
          <button className="btn" onClick={onClose}>Cancelar</button>
          <button className="btn primary" disabled={!elegida || busy} onClick={() => void vincular()}>
            Vincular
          </button>
        </>
      }
    >
      <div className="mini-table-wrap" style={{ height: 320, overflow: 'auto' }}>
        <table className="mini">
          <tbody>
            {disponibles.map((g) => (
              <tr key={g.dn} className={elegida === g.dn ? 'sel' : ''} onClick={() => setElegida(g.dn)}>
                <td>{g.name}</td>
                <td style={{ width: 130 }}>{g.linkCount} vínculo(s)</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Modal>
  )
}
