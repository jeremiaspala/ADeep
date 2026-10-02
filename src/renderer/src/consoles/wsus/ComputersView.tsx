import { useEffect, useMemo, useState, type JSX } from 'react'
import { Search, Info, FolderInput, Trash2, FileText, Monitor } from 'lucide-react'
import type { WsusComputer, WsusComputerUpdate, WsusEvent, WsusGroup } from '@shared/types'
import DetailList from '../../shell/DetailList'
import { MenuPopup, Modal, Spinner, useConfirm, type MenuItemDef } from '../../components/ui'
import { report } from '../../store'
import { fmtDate } from '../../lib/format'
import {
  GROUP_ALL, GROUP_UNASSIGNED, MSRC_LABEL, Notice, OkBar, StateBadge, STATE_LABEL, SYNC_RESULT,
  countsTitle, flattenGroups, groupLabel, hresult, needed, okPercent, Opt
} from './common'

type StatusFilter = 'failedOrNeeded' | 'ok' | 'failed' | 'needed' | 'stale' | 'any'

const STATE_WRITE_HINT = 'El servidor está en sólo lectura: habilitá los cambios en la conexión.'
const DIAS_SIN_REPORTE = 30

export default function ComputersView({
  serverId,
  allowWrites,
  group,
  groups,
  computers,
  loading,
  onReload
}: {
  serverId: string
  allowWrites: boolean
  group: WsusGroup
  groups: WsusGroup[]
  computers: WsusComputer[] | null
  loading: boolean
  onReload: () => void
}): JSX.Element {
  const [estado, setEstado] = useState<StatusFilter>('any')
  const [texto, setTexto] = useState('')
  const [subgrupos, setSubgrupos] = useState(true)
  const [selected, setSelected] = useState<string | undefined>()
  const [ctx, setCtx] = useState<{ items: MenuItemDef[]; x: number; y: number } | null>(null)
  const [detalle, setDetalle] = useState<WsusComputer | null>(null)
  const [mover, setMover] = useState<WsusComputer | null>(null)
  const confirm = useConfirm()

  const ids = useMemo(() => {
    const set = new Set([group.id])
    if (subgrupos) {
      let added = true
      while (added) {
        added = false
        for (const g of groups) if (g.parentId && set.has(g.parentId) && !set.has(g.id)) { set.add(g.id); added = true }
      }
    }
    return set
  }, [group.id, groups, subgrupos])

  const limite = Date.now() - DIAS_SIN_REPORTE * 86_400_000
  const filas = useMemo(() => {
    const q = texto.trim().toLowerCase()
    return (computers ?? []).filter((c) => {
      if (group.id !== GROUP_ALL && !c.groupIds.some((g) => ids.has(g))) return false
      if (estado === 'failed' && !c.counts.failed) return false
      if (estado === 'needed' && !needed(c.counts)) return false
      if (estado === 'failedOrNeeded' && !c.counts.failed && !needed(c.counts)) return false
      if (estado === 'ok' && (c.counts.failed || needed(c.counts))) return false
      if (estado === 'stale' && c.lastReport && new Date(c.lastReport).getTime() > limite) return false
      if (q && !`${c.name} ${c.ip ?? ''} ${c.os ?? ''}`.toLowerCase().includes(q)) return false
      return true
    })
  }, [computers, group.id, ids, estado, texto, limite])

  const quitar = async (c: WsusComputer): Promise<void> => {
    const ok = await confirm({
      title: 'Quitar el equipo de WSUS',
      message: c.name,
      detail:
        'Se borra del servidor con todo su historial de estado. Si el equipo sigue apuntando a este WSUS ' +
        'por directiva, vuelve a aparecer en su próxima detección, sin historial.',
      confirmLabel: 'Quitar',
      danger: true
    })
    if (!ok) return
    if (report(await window.adeep.wsus.deleteComputer(serverId, c.id), `${c.name} quitado de WSUS`) !== undefined) onReload()
  }

  const exportar = (): void => {
    const rows = [
      ['Equipo', 'IP', 'Sistema operativo', 'Grupos', 'Instaladas/NA %', 'Necesarias', 'Fallidas', 'Último informe', 'Última sincronización', 'Resultado', 'Cliente WUA'],
      ...filas.map((c) => [
        c.name, c.ip ?? '', c.os ?? '', c.groupIds.filter((g) => g !== GROUP_ALL).map((g) => nombreGrupo(g)).join('; '),
        String(okPercent(c.counts) ?? ''), String(needed(c.counts)), String(c.counts.failed),
        c.lastReport ?? '', c.lastSync ?? '', SYNC_RESULT[c.lastSyncResult] ?? '', c.clientVersion ?? ''
      ])
    ]
    void window.adeep.app.exportCsv(rows, `wsus-equipos-${group.name}.csv`).then((r) => report(r))
  }

  const nombreGrupo = (id: string): string => {
    const g = groups.find((x) => x.id === id)
    return g ? groupLabel(g) : id
  }

  const menu = (c: WsusComputer): MenuItemDef[] => [
    { id: 'props', label: 'Propiedades…', icon: <Info size={15} />, onSelect: () => setDetalle(c) },
    {
      id: 'move', label: 'Cambiar la pertenencia…', icon: <FolderInput size={15} />,
      disabled: !allowWrites, title: allowWrites ? undefined : STATE_WRITE_HINT, onSelect: () => setMover(c)
    },
    { id: 's', separator: true },
    {
      id: 'del', label: 'Quitar de WSUS', icon: <Trash2 size={15} />, danger: true,
      disabled: !allowWrites, title: allowWrites ? undefined : STATE_WRITE_HINT, onSelect: () => void quitar(c)
    }
  ]

  const sel = filas.find((c) => c.id === selected)
  return (
    <>
      <div className="list-head" style={{ gap: 10 }}>
        <div className="crumbs"><span className="crumb last">{groupLabel(group)}</span></div>
        <select value={estado} onChange={(e) => setEstado(e.target.value as StatusFilter)} style={{ width: 'auto', height: 26 }}>
          <option value="failedOrNeeded">Fallidas o necesarias</option>
          <option value="ok">Al día</option>
          <option value="failed">Con fallas</option>
          <option value="needed">Con actualizaciones necesarias</option>
          <option value="stale">Sin informar hace {DIAS_SIN_REPORTE} días</option>
          <option value="any">Cualquier estado</option>
        </select>
        {group.id !== GROUP_ALL && (
          <label className="hint row" style={{ gap: 5, cursor: 'pointer' }}>
            <input type="checkbox" checked={subgrupos} onChange={(e) => setSubgrupos(e.target.checked)} /> Subgrupos
          </label>
        )}
        <div className="spacer" style={{ flex: 1 }} />
        {loading && <Spinner size={14} />}
        <span className="hint">{filas.length} equipo(s)</span>
        <button className="btn sm" disabled={!sel || !allowWrites} title={allowWrites ? undefined : STATE_WRITE_HINT} onClick={() => sel && setMover(sel)}>
          <FolderInput size={14} /> Cambiar pertenencia…
        </button>
        <button className="btn sm ghost" disabled={!filas.length} onClick={exportar} title="Exportar la vista a CSV"><FileText size={14} /></button>
        <div className="search" style={{ width: 200, margin: 0 }}>
          <Search size={14} />
          <input type="search" placeholder="Nombre, IP, sistema…" value={texto} onChange={(e) => setTexto(e.target.value)} />
        </div>
      </div>
      <DetailList
        rows={filas}
        rowKey={(c) => c.id}
        rowKind={() => 'wsusComputer'}
        selectedKey={selected}
        onSelect={(c) => setSelected(c.id)}
        onOpen={(c) => setDetalle(c)}
        onContextMenu={(c, x, y) => { setSelected(c.id); setCtx({ items: menu(c), x, y }) }}
        empty={computers === null ? 'Cargando los equipos…' : 'Ningún equipo cumple el filtro'}
        columns={[
          { id: 'name', label: 'Equipo', width: '24%', render: (c) => c.name, sortValue: (c) => c.name },
          { id: 'ip', label: 'IP', width: 110, render: (c) => <span className="mono">{c.ip ?? '—'}</span>, sortValue: (c) => c.ip ?? '' },
          { id: 'os', label: 'Sistema operativo', width: '19%', render: (c) => c.os ?? '—', sortValue: (c) => c.os ?? '' },
          { id: 'ok', label: 'Inst./NA', width: 96, render: (c) => <OkBar counts={c.counts} />, sortValue: (c) => okPercent(c.counts) ?? -1 },
          {
            id: 'needed', label: 'Necesarias', width: 84,
            render: (c) => (needed(c.counts) ? <span title={countsTitle(c.counts)}>{needed(c.counts)}</span> : <span className="hint">0</span>),
            sortValue: (c) => needed(c.counts)
          },
          {
            id: 'failed', label: 'Fallidas', width: 70,
            render: (c) => (c.counts.failed ? <span className="badge danger">{c.counts.failed}</span> : <span className="hint">0</span>),
            sortValue: (c) => c.counts.failed
          },
          {
            id: 'report', label: 'Último informe', width: 130,
            render: (c) => {
              const viejo = !c.lastReport || new Date(c.lastReport).getTime() < limite
              return <span style={{ color: viejo ? 'var(--warn)' : undefined }}>{c.lastReport ? fmtDate(c.lastReport) : 'Nunca'}</span>
            },
            sortValue: (c) => c.lastReport ?? ''
          },
          {
            id: 'groups', label: 'Grupos',
            render: (c) => c.groupIds.filter((g) => g !== GROUP_ALL).map(nombreGrupo).join(', ') || '—'
          }
        ]}
      />
      {ctx && <MenuPopup items={ctx.items} x={ctx.x} y={ctx.y} onClose={() => setCtx(null)} />}
      {detalle && (
        <ComputerDialog
          serverId={serverId}
          computer={detalle}
          groups={groups}
          allowWrites={allowWrites}
          onClose={() => setDetalle(null)}
          onMove={() => { setMover(detalle); setDetalle(null) }}
        />
      )}
      {mover && (
        <MembershipDialog
          serverId={serverId}
          computer={mover}
          groups={groups}
          onClose={() => setMover(null)}
          onDone={() => { setMover(null); onReload() }}
        />
      )}
    </>
  )
}

function ComputerDialog({
  serverId, computer: c, groups, allowWrites, onClose, onMove
}: {
  serverId: string
  computer: WsusComputer
  groups: WsusGroup[]
  allowWrites: boolean
  onClose: () => void
  onMove: () => void
}): JSX.Element {
  const [tab, setTab] = useState<'general' | 'updates' | 'events'>('general')
  const [updates, setUpdates] = useState<WsusComputerUpdate[] | null>(null)
  const [events, setEvents] = useState<WsusEvent[] | null>(null)
  const [filtro, setFiltro] = useState<'needed' | 'all' | number>('needed')

  useEffect(() => {
    if (tab === 'updates' && !updates) {
      void window.adeep.wsus.computerUpdates(serverId, c.id).then((r) => setUpdates(report(r) ?? []))
    }
    if (tab === 'events' && !events) {
      void window.adeep.wsus.computerEvents(serverId, c.id, 30).then((r) => setEvents(report(r) ?? []))
    }
  }, [tab, updates, events, serverId, c.id])

  const lista = (updates ?? []).filter((u) =>
    filtro === 'all' ? u.state !== 1 : filtro === 'needed' ? [2, 3, 5].includes(u.state) : u.state === filtro
  )

  return (
    <Modal
      title={c.name}
      subtitle={`${c.os ?? 'Equipo'} · ${c.ip ?? ''}`}
      icon={<Monitor size={18} color="var(--accent)" />}
      size="xwide"
      tall
      onClose={onClose}
      footer={
        <>
          <button className="btn" disabled={!allowWrites} title={allowWrites ? undefined : STATE_WRITE_HINT} onClick={onMove}>
            Cambiar la pertenencia…
          </button>
          <div className="spacer" style={{ flex: 1 }} />
          <button className="btn primary" onClick={onClose}>Cerrar</button>
        </>
      }
    >
      <div className="tabs" style={{ marginBottom: 14 }}>
        <button className={`tab ${tab === 'general' ? 'on' : ''}`} onClick={() => setTab('general')}>General</button>
        <button className={`tab ${tab === 'updates' ? 'on' : ''}`} onClick={() => setTab('updates')}>Actualizaciones</button>
        <button className={`tab ${tab === 'events' ? 'on' : ''}`} onClick={() => setTab('events')}>Eventos (30 días)</button>
      </div>

      {tab === 'general' && (
        <div className="kv">
          <span className="k">Estado</span>
          <span className="v">{countsTitle(c.counts).split('\n').join(' · ')}</span>
          <span className="k">Grupos</span>
          <span className="v">{c.groupIds.map((g) => groups.find((x) => x.id === g)).filter(Boolean).map((g) => groupLabel(g!)).join(', ')}</span>
          <span className="k">Grupo pedido por directiva</span>
          <span className="v">{c.requestedGroup ?? '— (asignación desde la consola)'}</span>
          <span className="k">Último informe de estado</span>
          <span className="v">{fmtDate(c.lastReport)}</span>
          <span className="k">Última sincronización</span>
          <span className="v">{fmtDate(c.lastSync)} · {SYNC_RESULT[c.lastSyncResult] ?? '—'}</span>
          <span className="k">Sistema operativo</span>
          <span className="v">{c.os ?? '—'} <span className="mono">{c.osVersion}</span></span>
          <span className="k">Idioma</span>
          <span className="v">{c.locale ?? '—'}</span>
          <span className="k">Fabricante y modelo</span>
          <span className="v">{[c.make, c.model].filter(Boolean).join(' · ') || '—'}</span>
          <span className="k">Agente de Windows Update</span>
          <span className="v mono">{c.clientVersion ?? '—'}</span>
          <span className="k">Dirección IP</span>
          <span className="v mono">{c.ip ?? '—'}</span>
          <span className="k">Id</span>
          <span className="v mono">{c.id}</span>
        </div>
      )}

      {tab === 'updates' && (
        updates === null ? <Spinner /> : (
          <>
            <div className="row" style={{ gap: 8, marginBottom: 8 }}>
              <select value={String(filtro)} onChange={(e) => setFiltro(e.target.value === 'all' || e.target.value === 'needed' ? e.target.value : Number(e.target.value))} style={{ width: 'auto', height: 26 }}>
                <option value="needed">Necesarias o fallidas</option>
                {STATE_LABEL.map((l, i) => <option key={i} value={i}>{l}</option>)}
                <option value="all">Todas las aplicables</option>
              </select>
              <span className="hint">{lista.length} de {updates.length}</span>
            </div>
            <div className="mini-table-wrap" style={{ maxHeight: 420, overflow: 'auto' }}>
              <table className="mini">
                <thead><tr><th>Actualización</th><th style={{ width: 90 }}>KB</th><th style={{ width: 150 }}>Clasificación</th><th style={{ width: 90 }}>MSRC</th><th style={{ width: 150 }}>Estado</th></tr></thead>
                <tbody>
                  {lista.map((u) => (
                    <tr key={u.updateId}>
                      <td>{u.title}</td>
                      <td className="mono">{u.kb[0] ?? ''}</td>
                      <td>{u.classification ?? ''}</td>
                      <td>{MSRC_LABEL[u.msrc] ?? u.msrc}</td>
                      <td><StateBadge state={u.state} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )
      )}

      {tab === 'events' && (
        events === null ? <Spinner /> : events.length ? (
          <div className="mini-table-wrap" style={{ maxHeight: 460, overflow: 'auto' }}>
            <table className="mini">
              <thead><tr><th style={{ width: 140 }}>Fecha</th><th>Evento</th><th style={{ width: 110 }}>Código</th></tr></thead>
              <tbody>
                {[...events].sort((a, b) => b.time.localeCompare(a.time)).map((e, i) => (
                  <tr key={i}>
                    <td>{fmtDate(e.time)}</td>
                    <td style={{ color: e.severity === 1 ? 'var(--danger)' : undefined }}>{e.message}</td>
                    <td className="mono">{hresult(e.hresult)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <div className="hint">El equipo no reportó eventos en los últimos 30 días.</div>
      )}
    </Modal>
  )
}

/**
 * Pertenencia a grupos. Con asignación desde la consola un equipo puede estar
 * en varios grupos a la vez; «Todos los equipos» y «Sin asignar» los maneja WSUS.
 */
function MembershipDialog({
  serverId, computer, groups, onClose, onDone
}: {
  serverId: string
  computer: WsusComputer
  groups: WsusGroup[]
  onClose: () => void
  onDone: () => void
}): JSX.Element {
  const elegibles = flattenGroups(groups).filter(({ g }) => g.id !== GROUP_ALL && g.id !== GROUP_UNASSIGNED)
  const [wanted, setWanted] = useState<Set<string>>(new Set(computer.groupIds))
  const [saving, setSaving] = useState(false)

  const guardar = async (): Promise<void> => {
    setSaving(true)
    const r = await window.adeep.wsus.setComputerGroups(serverId, computer.id, computer.groupIds, [...wanted])
    setSaving(false)
    if (report(r, `Pertenencia de ${computer.name} actualizada`) !== undefined) onDone()
  }

  return (
    <Modal
      title="Cambiar la pertenencia"
      subtitle={computer.name}
      icon={<FolderInput size={18} color="var(--accent)" />}
      onClose={onClose}
      footer={
        <>
          <div className="spacer" style={{ flex: 1 }} />
          <button className="btn" onClick={onClose}>Cancelar</button>
          <button className="btn primary" disabled={saving} onClick={() => void guardar()}>Guardar</button>
        </>
      }
    >
      {computer.requestedGroup && (
        <Notice>
          El equipo pide el grupo «{computer.requestedGroup}» por directiva. Si el servidor está en modo
          de asignación por directiva, lo que se cambie acá lo pisa el equipo en su próxima detección.
        </Notice>
      )}
      {elegibles.length ? elegibles.map(({ g, depth }) => (
        <div key={g.id} style={{ paddingLeft: depth * 16 - 16 }}>
          <Opt
            label={groupLabel(g)}
            checked={wanted.has(g.id)}
            onChange={(v) => setWanted((cur) => {
              const next = new Set(cur)
              if (v) next.add(g.id)
              else next.delete(g.id)
              return next
            })}
          />
        </div>
      )) : <div className="hint">No hay grupos propios: creá uno con clic derecho en «Todos los equipos».</div>}
      <p className="hint" style={{ marginTop: 8 }}>Sin ningún grupo marcado, el equipo vuelve a «Equipos sin asignar».</p>
    </Modal>
  )
}
