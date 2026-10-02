import { useEffect, useMemo, useState, type JSX } from 'react'
import { RefreshCw, Square, Download, Ban, FileText } from 'lucide-react'
import type {
  WsusComputer, WsusDownstreamServer, WsusGroup, WsusOverview, WsusServerConfig, WsusSyncRun, WsusUpdate
} from '@shared/types'
import DetailList from '../../shell/DetailList'
import FindingList, { type Finding } from '../../shell/FindingList'
import { Spinner, useConfirm } from '../../components/ui'
import { report } from '../../store'
import { fmtDate } from '../../lib/format'
import {
  GROUP_ALL, GROUP_UNASSIGNED, MSRC_LABEL, Notice, Panel, SYNC_RESULT, approvalOf, flattenGroups,
  fmtBytes, fmtTimeOfDay, groupLabel, hresult, needed, okPercent
} from './common'

const STATE_WRITE_HINT = 'El servidor está en sólo lectura: habilitá los cambios en la conexión.'
const SYNC_PHASE = ['Sin sincronizar', 'Actualizaciones', 'Aprobaciones', 'Categorías']
export const DIAS_SIN_REPORTE = 30

function Stat({ label, value, tone }: { label: string; value: string | number; tone?: 'danger' | 'warn' | 'ok' }): JSX.Element {
  const color = tone === 'danger' ? 'var(--danger)' : tone === 'warn' ? 'var(--warn)' : tone === 'ok' ? 'var(--ok)' : 'var(--text)'
  return (
    <div style={{ minWidth: 0 }}>
      <div style={{ fontSize: 22, fontWeight: 600, color, lineHeight: 1.1 }}>{value}</div>
      <div className="hint" style={{ marginTop: 2 }}>{label}</div>
    </div>
  )
}

/* ------------------------------ Resumen del servidor ------------------------------ */

export function OverviewView({
  server, overview, updates, computers, onReload, onOpen
}: {
  server: WsusServerConfig
  overview: WsusOverview | null
  updates: WsusUpdate[] | null
  computers: WsusComputer[] | null
  onReload: () => void
  onOpen: (vista: string) => void
}): JSX.Element {
  const confirm = useConfirm()
  if (!overview) return <div style={{ padding: 20 }}><Spinner /></div>
  const o = overview
  const sinc = o.syncRunning
  const w = o.allowWrites

  const cs = computers ?? []
  const limite = Date.now() - DIAS_SIN_REPORTE * 86_400_000
  const conFallas = cs.filter((c) => c.counts.failed).length
  const necesitan = cs.filter((c) => !c.counts.failed && needed(c.counts)).length
  const sinReporte = cs.filter((c) => !c.lastReport || new Date(c.lastReport).getTime() < limite).length
  const us = updates ?? []
  const vigentes = us.filter((u) => !u.declined)
  const updFallas = vigentes.filter((u) => u.counts.failed).length
  const updNecesarias = vigentes.filter((u) => !u.counts.failed && needed(u.counts)).length
  const sinAprobar = vigentes.filter((u) => approvalOf(u) === 'none' && needed(u.counts)).length

  const sync = async (start: boolean): Promise<void> => {
    if (!start) {
      const ok = await confirm({ title: 'Detener la sincronización', message: 'Se cancela la sincronización en curso.', confirmLabel: 'Detener' })
      if (!ok) return
    }
    const r = start ? await window.adeep.wsus.startSync(server.id) : await window.adeep.wsus.stopSync(server.id)
    if (report(r, start ? 'Sincronización iniciada' : 'Sincronización detenida') !== undefined) setTimeout(onReload, 1500)
  }
  const descargas = async (resume: boolean): Promise<void> => {
    const r = await window.adeep.wsus.setAllDownloads(server.id, resume)
    if (report(r, resume ? 'Descargas reanudadas' : 'Descargas canceladas') !== undefined) onReload()
  }

  const pendiente = o.download.total - o.download.done
  return (
    <div style={{ padding: 16, overflow: 'auto' }}>
      {!server.ssl && (
        <Notice>
          La conexión con este servidor va por HTTP. Si los equipos también lo usan por HTTP, alguien en la
          misma red puede inyectarles actualizaciones falsas. Ver <span className="crumb" style={{ cursor: 'pointer', textDecoration: 'underline' }} onClick={() => onOpen('revision')}>Revisión</span>.
        </Notice>
      )}
      {o.componentsWithErrors.length > 0 && (
        <Notice tone="danger">Componentes con errores en el servidor: {o.componentsWithErrors.join(', ')}.</Notice>
      )}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 14 }}>
        <Panel title="Equipos" actions={<button className="btn sm ghost" onClick={() => onOpen('computers')}>Ver</button>}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
            <Stat label="registrados" value={o.computerCount} />
            <Stat label="con fallas" value={computers ? conFallas : '…'} tone={conFallas ? 'danger' : undefined} />
            <Stat label="necesitan actualizaciones" value={computers ? necesitan : '…'} tone={necesitan ? 'warn' : undefined} />
            <Stat label={`sin informar hace ${DIAS_SIN_REPORTE} días`} value={computers ? sinReporte : '…'} tone={sinReporte ? 'warn' : undefined} />
          </div>
        </Panel>
        <Panel title="Actualizaciones" actions={<button className="btn sm ghost" onClick={() => onOpen('updates')}>Ver</button>}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
            <Stat label="en el catálogo" value={o.updateCount} />
            <Stat label="con fallas" value={updates ? updFallas : '…'} tone={updFallas ? 'danger' : undefined} />
            <Stat label="necesarias" value={updates ? updNecesarias : '…'} tone={updNecesarias ? 'warn' : undefined} />
            <Stat label="necesarias sin aprobar" value={updates ? sinAprobar : '…'} tone={sinAprobar ? 'warn' : undefined} />
          </div>
        </Panel>
        <Panel
          title="Sincronización"
          actions={
            sinc
              ? <button className="btn sm" disabled={!w} title={w ? undefined : STATE_WRITE_HINT} onClick={() => void sync(false)}><Square size={13} /> Detener</button>
              : <button className="btn sm" disabled={!w} title={w ? undefined : STATE_WRITE_HINT} onClick={() => void sync(true)}><RefreshCw size={13} /> Sincronizar ahora</button>
          }
        >
          <div className="kv" style={{ gridTemplateColumns: '130px 1fr' }}>
            <span className="k">Estado</span>
            <span className="v">{sinc ? (o.syncPhase ? `En curso: ${SYNC_PHASE[o.syncPhase]} (${o.syncProcessed} de ${o.syncTotal})` : 'En curso') : 'Inactiva'}</span>
            <span className="k">Última</span>
            <span className="v">{fmtDate(o.subscription.lastSync)}</span>
            <span className="k">Próxima</span>
            <span className="v">{o.subscription.synchronizeAutomatically ? fmtDate(o.subscription.nextSync) : 'Manual'}</span>
            <span className="k">Programación</span>
            <span className="v">
              {o.subscription.synchronizeAutomatically
                ? `${o.subscription.perDay} por día desde las ${fmtTimeOfDay(o.subscription.timeOfDay)}`
                : 'Sólo manual'}
            </span>
            <span className="k">Origen</span>
            <span className="v">{o.config.syncFromMicrosoft ? 'Microsoft Update' : `${o.config.upstreamServer}:${o.config.upstreamPort}${o.config.replica ? ' (réplica)' : ''}`}</span>
          </div>
        </Panel>
        <Panel
          title="Descargas"
          actions={
            <>
              <button className="btn sm ghost" disabled={!w || !pendiente} title={w ? 'Cancelar todas' : STATE_WRITE_HINT} onClick={() => void descargas(false)}><Ban size={13} /></button>
              <button className="btn sm ghost" disabled={!w} title={w ? 'Reintentar las fallidas o canceladas' : STATE_WRITE_HINT} onClick={() => void descargas(true)}><Download size={13} /></button>
            </>
          }
        >
          <div className="kv" style={{ gridTemplateColumns: '130px 1fr' }}>
            <span className="k">Contenido</span>
            <span className="v">{fmtBytes(o.download.done)} de {fmtBytes(o.download.total)}{pendiente ? ` · faltan ${fmtBytes(pendiente)}` : ' · completo'}</span>
            <span className="k">Dónde</span>
            <span className="v">{o.config.storeLocally ? <span className="mono">{o.config.contentPath ?? '—'}</span> : 'Los equipos descargan de Microsoft Update'}</span>
            <span className="k">Qué descarga</span>
            <span className="v">{o.config.downloadOnlyApproved ? 'Sólo lo aprobado' : 'Todo lo sincronizado'}{o.config.expressPackages ? ', con paquetes exprés' : ''}</span>
          </div>
        </Panel>
        <Panel title="Servidor">
          <div className="kv" style={{ gridTemplateColumns: '130px 1fr' }}>
            <span className="k">Versión</span>
            <span className="v mono">{o.version}{o.protocolVersion ? ` · protocolo ${o.protocolVersion}` : ''}</span>
            <span className="k">Base de datos</span>
            <span className="v mono">{o.database.server ?? '—'} / {o.database.name ?? '—'}</span>
            <span className="k">Conexión</span>
            <span className="v">{server.ssl ? 'HTTPS' : 'HTTP'} {server.host}:{server.port}</span>
            <span className="k">Cuenta</span>
            <span className="v">{o.adminName} · {o.role === 2 ? 'administrador' : 'sólo informes'}</span>
            <span className="k">Cambios</span>
            <span className="v">{w ? 'Habilitados' : 'Sólo lectura'}</span>
            <span className="k">Asignación a grupos</span>
            <span className="v">{o.config.serverTargeting ? 'Desde la consola' : 'Por directiva de grupo'}</span>
            <span className="k">Idiomas</span>
            <span className="v">{o.config.allLanguages ? 'Todos' : o.config.languages.join(', ') || '—'}</span>
          </div>
        </Panel>
      </div>
    </div>
  )
}

/* ------------------------------ Sincronizaciones ------------------------------ */

export function SyncView({ serverId, allowWrites, overview, onReload }: {
  serverId: string
  allowWrites: boolean
  overview: WsusOverview | null
  onReload: () => void
}): JSX.Element {
  const [runs, setRuns] = useState<WsusSyncRun[] | null>(null)
  const [dias, setDias] = useState(60)

  useEffect(() => {
    setRuns(null)
    void window.adeep.wsus.syncHistory(serverId, dias).then((r) => setRuns(report(r) ?? []))
  }, [serverId, dias, overview])

  const enCurso = overview?.syncRunning ?? false
  const start = async (): Promise<void> => {
    const r = enCurso ? await window.adeep.wsus.stopSync(serverId) : await window.adeep.wsus.startSync(serverId)
    if (report(r, enCurso ? 'Sincronización detenida' : 'Sincronización iniciada') !== undefined) setTimeout(onReload, 1500)
  }

  return (
    <>
      <div className="list-head">
        <div className="crumbs"><span className="crumb last">Sincronizaciones</span></div>
        <select value={dias} onChange={(e) => setDias(Number(e.target.value))} style={{ width: 'auto', height: 26 }}>
          <option value={7}>7 días</option>
          <option value={30}>30 días</option>
          <option value={60}>60 días</option>
          <option value={365}>Un año</option>
        </select>
        <div className="spacer" style={{ flex: 1 }} />
        {enCurso && <span className="hint">En curso{overview!.syncPhase ? `: ${SYNC_PHASE[overview!.syncPhase]} ${overview!.syncProcessed}/${overview!.syncTotal}` : ''}</span>}
        <button className="btn sm" disabled={!allowWrites} title={allowWrites ? undefined : STATE_WRITE_HINT} onClick={() => void start()}>
          {enCurso ? <><Square size={13} /> Detener</> : <><RefreshCw size={13} /> Sincronizar ahora</>}
        </button>
      </div>
      <DetailList
        rows={runs ?? []}
        rowKey={(r) => r.start}
        rowKind={() => 'wsusSync'}
        empty={runs === null ? 'Leyendo el historial…' : 'No hay sincronizaciones en el período'}
        columns={[
          { id: 'start', label: 'Inicio', width: 170, render: (r) => fmtDate(r.start), sortValue: (r) => r.start },
          { id: 'end', label: 'Fin', width: 170, render: (r) => fmtDate(r.end), sortValue: (r) => r.end ?? '' },
          {
            id: 'dur', label: 'Duración', width: 90,
            render: (r) => (r.end ? `${Math.max(1, Math.round((new Date(r.end).getTime() - new Date(r.start).getTime()) / 60000))} min` : '—')
          },
          { id: 'type', label: 'Tipo', width: 100, render: (r) => (r.manual ? 'Manual' : 'Programada') },
          {
            id: 'result', label: 'Resultado', width: 110,
            render: (r) => r.result === 'ok' ? <span className="badge ok">Correcta</span>
              : r.result === 'error' ? <span className="badge danger">Falló</span>
                : r.result === 'cancelada' ? <span className="badge neutral">Cancelada</span>
                  : <span className="badge accent">En curso</span>,
            sortValue: (r) => r.result
          },
          { id: 'msg', label: 'Detalle', render: (r) => `${r.message ?? ''} ${hresult(r.hresult)}` }
        ]}
      />
    </>
  )
}

/* ------------------------------ Informes ------------------------------ */

type Informe = 'updates' | 'computers' | 'groups' | 'classes' | 'stale' | 'sync'

const INFORMES: Record<Informe, string> = {
  updates: 'Estado de las actualizaciones',
  computers: 'Estado de los equipos',
  groups: 'Resumen por grupo',
  classes: 'Resumen por clasificación',
  stale: `Equipos sin informar (${DIAS_SIN_REPORTE} días)`,
  sync: 'Resultados de sincronización'
}

/**
 * Los informes de la consola de Windows, sin Report Viewer: tablas que se
 * ordenan, se filtran por grupo y se exportan a CSV.
 */
export function ReportsView({ serverId, updates, computers, groups }: {
  serverId: string
  updates: WsusUpdate[] | null
  computers: WsusComputer[] | null
  groups: WsusGroup[]
}): JSX.Element {
  const [informe, setInforme] = useState<Informe>('groups')
  const [grupo, setGrupo] = useState(GROUP_ALL)
  const [sinRechazadas, setSinRechazadas] = useState(true)
  const [runs, setRuns] = useState<WsusSyncRun[] | null>(null)

  useEffect(() => {
    if (informe === 'sync' && !runs) void window.adeep.wsus.syncHistory(serverId, 365).then((r) => setRuns(report(r) ?? []))
  }, [informe, runs, serverId])

  const descendientes = useMemo(() => {
    const set = new Set([grupo])
    let added = true
    while (added) {
      added = false
      for (const g of groups) if (g.parentId && set.has(g.parentId) && !set.has(g.id)) { set.add(g.id); added = true }
    }
    return set
  }, [grupo, groups])
  const cs = (computers ?? []).filter((c) => grupo === GROUP_ALL || c.groupIds.some((g) => descendientes.has(g)))
  const us = (updates ?? []).filter((u) => !sinRechazadas || !u.declined)
  const limite = Date.now() - DIAS_SIN_REPORTE * 86_400_000

  const tabla = ((): { head: string[]; rows: (string | number)[][]; render?: (r: (string | number)[], i: number) => JSX.Element } => {
    switch (informe) {
      case 'updates':
        return {
          head: ['Actualización', 'KB', 'Clasificación', 'MSRC', 'Aprobación', 'Instaladas', 'Necesarias', 'Fallidas', 'No aplicables', 'Sin estado', '% Inst./NA'],
          rows: us.map((u) => [u.title, u.kb[0] ?? '', u.classification ?? '', MSRC_LABEL[u.msrc] ?? u.msrc,
            approvalOf(u) === 'install' ? 'Instalar' : approvalOf(u) === 'uninstall' ? 'Quitar' : approvalOf(u) === 'declined' ? 'Rechazada' : 'Sin aprobar',
            u.counts.installed + u.counts.pendingReboot, needed(u.counts), u.counts.failed, u.counts.notApplicable, u.counts.unknown, okPercent(u.counts) ?? ''])
        }
      case 'computers':
        return {
          head: ['Equipo', 'IP', 'Sistema operativo', 'Instaladas', 'Necesarias', 'Fallidas', 'No aplicables', 'Sin estado', '% Inst./NA', 'Último informe'],
          rows: cs.map((c) => [c.name, c.ip ?? '', c.os ?? '', c.counts.installed + c.counts.pendingReboot, needed(c.counts), c.counts.failed,
            c.counts.notApplicable, c.counts.unknown, okPercent(c.counts) ?? '', c.lastReport ? fmtDate(c.lastReport) : 'Nunca'])
        }
      case 'groups':
        return {
          head: ['Grupo', 'Equipos', 'Al día', 'Necesitan', 'Con fallas', 'Sin informar', '% equipos al día'],
          rows: flattenGroups(groups).map(({ g, depth }) => {
            const ids = new Set([g.id])
            if (g.id !== GROUP_ALL) {
              let added = true
              while (added) {
                added = false
                for (const x of groups) if (x.parentId && ids.has(x.parentId) && !ids.has(x.id)) { ids.add(x.id); added = true }
              }
            }
            const lista = (computers ?? []).filter((c) => g.id === GROUP_ALL || c.groupIds.some((x) => ids.has(x)))
            const fall = lista.filter((c) => c.counts.failed).length
            const nec = lista.filter((c) => !c.counts.failed && needed(c.counts)).length
            const al = lista.length - fall - nec
            const stale = lista.filter((c) => !c.lastReport || new Date(c.lastReport).getTime() < limite).length
            return [`${' '.repeat(depth * 4)}${groupLabel(g)}`, lista.length, al, nec, fall, stale, lista.length ? Math.floor((al * 100) / lista.length) : '']
          })
        }
      case 'classes': {
        const map = new Map<string, { n: number; aprob: number; sin: number; rech: number; nec: number; fall: number; eq: number }>()
        for (const u of updates ?? []) {
          const k = u.classification ?? '(sin clasificación)'
          const e = map.get(k) ?? { n: 0, aprob: 0, sin: 0, rech: 0, nec: 0, fall: 0, eq: 0 }
          e.n++
          const a = approvalOf(u)
          if (a === 'declined') e.rech++
          else if (a === 'none') e.sin++
          else e.aprob++
          if (needed(u.counts)) e.nec++
          if (u.counts.failed) e.fall++
          e.eq += needed(u.counts)
          map.set(k, e)
        }
        return {
          head: ['Clasificación', 'Actualizaciones', 'Aprobadas', 'Sin aprobar', 'Rechazadas', 'Necesarias', 'Con fallas', 'Instalaciones pendientes'],
          rows: [...map].sort((a, b) => b[1].n - a[1].n).map(([k, e]) => [k, e.n, e.aprob, e.sin, e.rech, e.nec, e.fall, e.eq])
        }
      }
      case 'stale':
        return {
          head: ['Equipo', 'IP', 'Sistema operativo', 'Último informe', 'Última sincronización', 'Resultado'],
          rows: cs.filter((c) => !c.lastReport || new Date(c.lastReport).getTime() < limite)
            .sort((a, b) => (a.lastReport ?? '').localeCompare(b.lastReport ?? ''))
            .map((c) => [c.name, c.ip ?? '', c.os ?? '', c.lastReport ? fmtDate(c.lastReport) : 'Nunca', fmtDate(c.lastSync), SYNC_RESULT[c.lastSyncResult] ?? ''])
        }
      case 'sync':
        return {
          head: ['Inicio', 'Fin', 'Tipo', 'Resultado', 'Detalle'],
          rows: (runs ?? []).map((r) => [fmtDate(r.start), fmtDate(r.end), r.manual ? 'Manual' : 'Programada', r.result, `${r.message ?? ''} ${hresult(r.hresult)}`.trim()])
        }
    }
  })()

  const [orden, setOrden] = useState<{ col: number; dir: 1 | -1 } | null>(null)
  useEffect(() => setOrden(null), [informe])
  const rows = orden
    ? [...tabla.rows].sort((a, b) => {
        const x = a[orden.col]
        const y = b[orden.col]
        return (typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y), 'es', { numeric: true })) * orden.dir
      })
    : tabla.rows

  const exportar = (): void => {
    void window.adeep.app.exportCsv([tabla.head, ...rows.map((r) => r.map(String))], `wsus-${informe}.csv`).then((r) => report(r))
  }

  const usaGrupo = informe === 'computers' || informe === 'stale'
  const cargando = (informe === 'sync' && !runs) || ((informe === 'updates' || informe === 'classes') && !updates) ||
    ((informe === 'computers' || informe === 'groups' || informe === 'stale') && !computers)

  return (
    <>
      <div className="list-head" style={{ gap: 10 }}>
        <div className="crumbs"><span className="crumb">Informes</span><span className="sepr">›</span></div>
        <select value={informe} onChange={(e) => setInforme(e.target.value as Informe)} style={{ width: 'auto', height: 26 }}>
          {Object.entries(INFORMES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        {usaGrupo && (
          <select value={grupo} onChange={(e) => setGrupo(e.target.value)} style={{ width: 'auto', height: 26 }}>
            {flattenGroups(groups).map(({ g, depth }) => <option key={g.id} value={g.id}>{' '.repeat(depth * 3)}{groupLabel(g)}</option>)}
          </select>
        )}
        {(informe === 'updates') && (
          <label className="hint row" style={{ gap: 5, cursor: 'pointer' }}>
            <input type="checkbox" checked={sinRechazadas} onChange={(e) => setSinRechazadas(e.target.checked)} /> Sin rechazadas
          </label>
        )}
        <div className="spacer" style={{ flex: 1 }} />
        {cargando && <Spinner size={14} />}
        <span className="hint">{rows.length} fila(s)</span>
        <button className="btn sm" disabled={!rows.length} onClick={exportar}><FileText size={14} /> Exportar CSV</button>
      </div>
      <div className="grid" style={{ padding: 0 }}>
        <table className="list">
          <thead>
            <tr>
              {tabla.head.map((h, i) => (
                <th
                  key={h}
                  style={{ cursor: 'pointer', width: i === 0 ? '30%' : undefined }}
                  onClick={() => setOrden((o) => (o?.col === i ? { col: i, dir: o.dir === 1 ? -1 : 1 } : { col: i, dir: 1 }))}
                >
                  {h}{orden?.col === i && <span className="sort">{orden.dir === 1 ? ' ▲' : ' ▼'}</span>}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i}>
                {r.map((v, j) => (
                  <td key={j} style={{ whiteSpace: j === 0 ? 'pre' : undefined }} title={String(v)}>{v === '' ? '—' : v}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        {!rows.length && !cargando && <div className="empty-state"><div className="title">Sin datos para este informe</div></div>}
      </div>
    </>
  )
}

/* ------------------------------ Servidores secundarios ------------------------------ */

export function DownstreamView({ serverId }: { serverId: string }): JSX.Element {
  const [list, setList] = useState<WsusDownstreamServer[] | null>(null)
  useEffect(() => { void window.adeep.wsus.downstream(serverId).then((r) => setList(report(r) ?? [])) }, [serverId])
  return (
    <>
      <div className="list-head"><div className="crumbs"><span className="crumb last">Servidores secundarios</span></div></div>
      <DetailList
        rows={list ?? []}
        rowKey={(s) => s.id}
        rowKind={() => 'wsusDownstream'}
        empty={list === null ? 'Cargando…' : 'Ningún WSUS sincroniza desde este servidor'}
        columns={[
          { id: 'name', label: 'Servidor', width: '30%', render: (s) => s.name, sortValue: (s) => s.name },
          { id: 'mode', label: 'Modo', width: 120, render: (s) => (s.replica ? 'Réplica' : 'Autónomo') },
          { id: 'ver', label: 'Versión', width: 140, render: (s) => <span className="mono">{s.version ?? '—'}</span> },
          { id: 'sync', label: 'Última sincronización', render: (s) => fmtDate(s.lastSync), sortValue: (s) => s.lastSync ?? '' },
          { id: 'rollup', label: 'Último informe acumulado', render: (s) => fmtDate(s.lastRollup), sortValue: (s) => s.lastRollup ?? '' }
        ]}
      />
    </>
  )
}

/* ------------------------------ Revisión ------------------------------ */

export function reviewFindings(
  server: WsusServerConfig,
  o: WsusOverview | null,
  updates: WsusUpdate[] | null,
  computers: WsusComputer[] | null,
  groups: WsusGroup[],
  runs: WsusSyncRun[] | null
): Finding[] {
  const f: Finding[] = []
  const subj = server.name
  const id = (k: string): string => `wsus:${server.host}:${k}`
  if (!server.ssl) {
    f.push({
      id: id('http'), severity: 'alta', subject: subj,
      label: 'WSUS sin SSL',
      detail:
        'Los metadatos de las actualizaciones viajan por HTTP. Con un ARP spoofing o un proxy WPAD falso se ' +
        'le puede servir a los equipos una «actualización» firmada por Microsoft que ejecuta otra cosa ' +
        '(PsExec, BgInfo) con SYSTEM, y la sesión NTLM de la consola se puede relayar. Configurar SSL ' +
        '(wsusutil configuressl) y apuntar la directiva a https://…:8531.'
    })
  }
  if (o?.componentsWithErrors.length) {
    f.push({ id: id('components'), severity: 'alta', subject: subj, label: 'Componentes con errores', detail: o.componentsWithErrors.join(', ') })
  }
  if (o) {
    const last = o.subscription.lastSync ? new Date(o.subscription.lastSync).getTime() : 0
    if (Date.now() - last > 7 * 86_400_000) {
      f.push({ id: id('sync-old'), severity: 'media', subject: subj, label: 'Hace más de una semana que no sincroniza', detail: `Última sincronización: ${fmtDate(o.subscription.lastSync)}.` })
    }
    if (!o.subscription.synchronizeAutomatically) {
      f.push({ id: id('sync-manual'), severity: 'baja', subject: subj, label: 'Sincronización sólo manual', detail: 'Sin programación, el catálogo queda viejo si nadie lo dispara.' })
    }
  }
  const ultima = runs?.[0]
  if (ultima?.result === 'error') {
    f.push({ id: id('sync-failed'), severity: 'media', subject: subj, label: 'La última sincronización falló', detail: `${fmtDate(ultima.start)} · ${ultima.message ?? ''} ${hresult(ultima.hresult)}` })
  }
  if (updates) {
    const criticas = updates.filter((u) => !u.declined && !u.superseded && u.msrc === 'Critical' && needed(u.counts) && !u.approvals.some((a) => a.action === 0))
    if (criticas.length) {
      f.push({
        id: id('critical-unapproved'), severity: 'alta', subject: subj,
        label: `${criticas.length} actualización(es) de gravedad crítica necesarias y sin aprobar`,
        detail: criticas.slice(0, 6).map((u) => (u.kb[0] ? `KB${u.kb[0]}` : u.title)).join(', ') + (criticas.length > 6 ? '…' : '')
      })
    }
    const fallidas = updates.filter((u) => [7, 8].includes(u.state) && u.approvals.some((a) => a.action === 0))
    if (fallidas.length) {
      f.push({ id: id('download-failed'), severity: 'media', subject: subj, label: `${fallidas.length} aprobada(s) con la descarga fallida`, detail: 'Los equipos no las pueden instalar hasta que se reintente la descarga.' })
    }
    const reemplazadas = updates.filter((u) => u.superseded && !u.declined)
    if (reemplazadas.length > 50) {
      f.push({
        id: id('superseded'), severity: 'baja', subject: subj,
        label: `${reemplazadas.length} actualizaciones reemplazadas sin rechazar`,
        detail: 'Engordan el catálogo que evalúa cada equipo y hacen más lentas las detecciones. El asistente de limpieza las rechaza.'
      })
    }
  }
  if (computers) {
    const limite = Date.now() - DIAS_SIN_REPORTE * 86_400_000
    const stale = computers.filter((c) => !c.lastReport || new Date(c.lastReport).getTime() < limite)
    if (stale.length) {
      f.push({ id: id('stale'), severity: 'media', subject: subj, label: `${stale.length} equipo(s) sin informar hace más de ${DIAS_SIN_REPORTE} días`, detail: stale.slice(0, 8).map((c) => c.name.split('.')[0]).join(', ') + (stale.length > 8 ? '…' : '') })
    }
    const fallan = computers.filter((c) => c.counts.failed)
    if (fallan.length) {
      f.push({ id: id('failing'), severity: 'media', subject: subj, label: `${fallan.length} equipo(s) con instalaciones fallidas`, detail: fallan.slice(0, 8).map((c) => c.name.split('.')[0]).join(', ') + (fallan.length > 8 ? '…' : '') })
    }
    const syncFail = computers.filter((c) => c.lastSyncResult === 2)
    if (syncFail.length) {
      f.push({ id: id('client-sync'), severity: 'media', subject: subj, label: `${syncFail.length} equipo(s) no pudieron sincronizar con el servidor`, detail: syncFail.slice(0, 8).map((c) => c.name.split('.')[0]).join(', ') })
    }
    const unassigned = computers.filter((c) => c.groupIds.includes(GROUP_UNASSIGNED))
    if (unassigned.length) {
      const g = groups.find((x) => x.id === GROUP_UNASSIGNED)
      f.push({ id: id('unassigned'), severity: 'baja', subject: subj, label: `${unassigned.length} equipo(s) en «${g ? groupLabel(g) : 'Sin asignar'}»`, detail: 'Sólo reciben lo aprobado para «Todos los equipos».' })
    }
  }
  return f
}

export function ReviewView(props: {
  server: WsusServerConfig
  overview: WsusOverview | null
  updates: WsusUpdate[] | null
  computers: WsusComputer[] | null
  groups: WsusGroup[]
}): JSX.Element {
  const [runs, setRuns] = useState<WsusSyncRun[] | null>(null)
  useEffect(() => { void window.adeep.wsus.syncHistory(props.server.id, 14).then((r) => setRuns(report(r) ?? [])) }, [props.server.id])
  const findings = reviewFindings(props.server, props.overview, props.updates, props.computers, props.groups, runs)
  const cargando = !props.updates || !props.computers || !props.overview
  return (
    <>
      <div className="list-head">
        <div className="crumbs"><span className="crumb last">Revisión del servidor</span></div>
        <div className="spacer" style={{ flex: 1 }} />
        {cargando && <Spinner size={14} />}
      </div>
      <div style={{ padding: 16, overflow: 'auto' }}>
        <FindingList findings={findings} vacio="Nada para observar: sincroniza, los equipos informan y lo crítico está aprobado." />
      </div>
    </>
  )
}

