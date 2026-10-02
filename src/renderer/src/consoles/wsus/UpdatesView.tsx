import { useEffect, useMemo, useState, type JSX } from 'react'
import {
  Search, CheckCircle2, XCircle, Info, Download, Ban, Undo2, ExternalLink, FileText, Package
} from 'lucide-react'
import type { WsusComputer, WsusGroup, WsusUpdate, WsusUpdateDetail } from '@shared/types'
import DetailList from '../../shell/DetailList'
import { MenuPopup, Modal, Spinner, useConfirm, type MenuItemDef } from '../../components/ui'
import { report, useApp } from '../../store'
import { fmtDate, fmtDateOnly } from '../../lib/format'
import {
  ACTION_LABEL, ApprovalBadge, GROUP_ALL, MSRC_LABEL, MSRC_RANK, Notice, OkBar, StateBadge, STATE_LABEL,
  approvalOf, countsTitle, flattenGroups, groupLabel, latestApproval, needed, okPercent
} from './common'

export type UpdatePreset = 'all' | 'critical' | 'security' | 'definitions'

const PRESET_TITLE: Record<UpdatePreset, string> = {
  all: 'Todas las actualizaciones',
  critical: 'Actualizaciones críticas',
  security: 'Actualizaciones de seguridad',
  definitions: 'Actualizaciones de definiciones'
}

/** Las clasificaciones vienen localizadas: se reconoce por la palabra clave. */
const PRESET_MATCH: Record<UpdatePreset, RegExp | null> = {
  all: null,
  critical: /cr[ií]tic/i,
  security: /segur|security/i,
  definitions: /definici|definition/i
}

type ApprovalFilter = 'unapproved' | 'approved' | 'declined' | 'anyButDeclined' | 'any'
type StatusFilter = 'failedOrNeeded' | 'okOrNoStatus' | 'failed' | 'needed' | 'any'
type SupersededFilter = 'any' | 'current' | 'superseded'

const STATE_WRITE_HINT = 'El servidor está en sólo lectura: habilitá los cambios en la conexión.'

export default function UpdatesView({
  serverId,
  allowWrites,
  preset,
  updates,
  groups,
  computers,
  loading,
  onReload
}: {
  serverId: string
  allowWrites: boolean
  preset: UpdatePreset
  updates: WsusUpdate[] | null
  groups: WsusGroup[]
  computers: WsusComputer[]
  loading: boolean
  onReload: () => void
}): JSX.Element {
  const [aprob, setAprob] = useState<ApprovalFilter>('anyButDeclined')
  const [estado, setEstado] = useState<StatusFilter>('any')
  const [reemplazo, setReemplazo] = useState<SupersededFilter>('any')
  const [texto, setTexto] = useState('')
  const [selected, setSelected] = useState<string | undefined>()
  const [checked, setChecked] = useState<Set<string>>(new Set())
  const [ctx, setCtx] = useState<{ items: MenuItemDef[]; x: number; y: number } | null>(null)
  const [detalle, setDetalle] = useState<WsusUpdate | null>(null)
  const [aprobar, setAprobar] = useState<WsusUpdate[] | null>(null)
  const confirm = useConfirm()
  const toast = useApp((s) => s.toast)

  useEffect(() => { setChecked(new Set()); setSelected(undefined) }, [preset, serverId])

  const filas = useMemo(() => {
    const re = PRESET_MATCH[preset]
    const q = texto.trim().toLowerCase()
    return (updates ?? []).filter((u) => {
      if (re && !re.test(u.classification ?? '')) return false
      const a = approvalOf(u)
      if (aprob === 'unapproved' && a !== 'none') return false
      if (aprob === 'approved' && a !== 'install' && a !== 'uninstall') return false
      if (aprob === 'declined' && a !== 'declined') return false
      if (aprob === 'anyButDeclined' && a === 'declined') return false
      if (estado === 'failed' && !u.counts.failed) return false
      if (estado === 'needed' && !needed(u.counts)) return false
      if (estado === 'failedOrNeeded' && !u.counts.failed && !needed(u.counts)) return false
      if (estado === 'okOrNoStatus' && (u.counts.failed || needed(u.counts))) return false
      if (reemplazo === 'current' && u.superseded) return false
      if (reemplazo === 'superseded' && !u.superseded) return false
      if (q) {
        const hay = `${u.title} ${u.kb.map((k) => `kb${k}`).join(' ')} ${u.bulletins.join(' ')} ${u.products.join(' ')}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
  }, [updates, preset, aprob, estado, reemplazo, texto])

  const seleccion = (): WsusUpdate[] => {
    if (checked.size) return (updates ?? []).filter((u) => checked.has(u.id))
    const u = (updates ?? []).find((x) => x.id === selected)
    return u ? [u] : []
  }

  const rechazar = async (list: WsusUpdate[]): Promise<void> => {
    const ok = await confirm({
      title: list.length === 1 ? 'Rechazar la actualización' : `Rechazar ${list.length} actualizaciones`,
      message: list.length === 1 ? list[0].title : `${list.length} actualizaciones seleccionadas.`,
      detail:
        'Se borran sus aprobaciones en todos los grupos y dejan de ofrecerse a los equipos. Se puede ' +
        'deshacer aprobándolas de nuevo, pero las aprobaciones anteriores no vuelven.',
      confirmLabel: 'Rechazar',
      danger: true
    })
    if (!ok) return
    const res = report(await window.adeep.wsus.decline(serverId, list.map((u) => u.id)))
    if (res) resumen(res, 'rechazada(s)')
  }

  /** Sacar del rechazo: es aprobarla como «no aprobada» para todos los equipos. */
  const desrechazar = async (list: WsusUpdate[]): Promise<void> => {
    const res = report(await window.adeep.wsus.approve(
      serverId, list.map((u) => ({ id: u.id, revision: u.revision })), [{ groupId: GROUP_ALL, action: 2 }]
    ))
    if (res) resumen(res, 'vuelta(s) a «sin aprobar»')
  }

  const descarga = async (list: WsusUpdate[], resume: boolean): Promise<void> => {
    const r = await window.adeep.wsus.setDownload(serverId, list.map((u) => ({ id: u.id, revision: u.revision })), resume)
    if (report(r, resume ? 'Descarga reanudada' : 'Descarga cancelada') !== undefined) onReload()
  }

  const resumen = (res: { id: string; error?: string }[], verbo: string): void => {
    const errores = res.filter((r) => r.error)
    if (errores.length) toast('error', `${errores.length} con error: ${errores[0].error}`)
    const bien = res.length - errores.length
    if (bien) toast('ok', `${bien} actualización(es) ${verbo}`)
    setChecked(new Set())
    onReload()
  }

  const exportar = (): void => {
    const rows = [
      ['Título', 'KB', 'Clasificación', 'Gravedad MSRC', 'Aprobación', 'Instalada/NA %', 'Necesaria', 'Falló', 'Llegada', 'Reemplazada', 'Id'],
      ...filas.map((u) => [
        u.title, u.kb.join(' '), u.classification ?? '', MSRC_LABEL[u.msrc] ?? u.msrc, approvalOf(u),
        String(okPercent(u.counts) ?? ''), String(needed(u.counts)), String(u.counts.failed),
        u.arrival ?? '', u.superseded ? 'sí' : 'no', u.id
      ])
    ]
    void window.adeep.app.exportCsv(rows, `wsus-${preset}.csv`).then((r) => report(r))
  }

  const menu = (list: WsusUpdate[]): MenuItemDef[] => {
    const uno = list.length === 1 ? list[0] : null
    const hayRechazadas = list.some((u) => u.declined)
    return [
      { id: 'props', label: 'Propiedades…', icon: <Info size={15} />, disabled: !uno, onSelect: () => uno && setDetalle(uno) },
      { id: 's0', separator: true },
      {
        id: 'approve', label: 'Aprobar…', icon: <CheckCircle2 size={15} />, disabled: !allowWrites || !list.length,
        title: allowWrites ? undefined : STATE_WRITE_HINT, onSelect: () => setAprobar(list)
      },
      {
        id: 'decline', label: 'Rechazar', icon: <XCircle size={15} />, danger: true,
        disabled: !allowWrites || !list.length || list.every((u) => u.declined),
        title: allowWrites ? undefined : STATE_WRITE_HINT,
        onSelect: () => void rechazar(list.filter((u) => !u.declined))
      },
      {
        id: 'undecline', label: 'Quitar el rechazo', icon: <Undo2 size={15} />,
        disabled: !allowWrites || !hayRechazadas, onSelect: () => void desrechazar(list.filter((u) => u.declined))
      },
      { id: 's1', separator: true },
      {
        id: 'cancel', label: 'Cancelar la descarga', icon: <Ban size={15} />,
        disabled: !allowWrites || !list.some((u) => u.state === 4), onSelect: () => void descarga(list, false)
      },
      {
        id: 'resume', label: 'Reintentar la descarga', icon: <Download size={15} />,
        disabled: !allowWrites || !list.some((u) => [6, 7, 8].includes(u.state)), onSelect: () => void descarga(list, true)
      },
      { id: 's2', separator: true },
      {
        id: 'kb', label: 'Abrir el artículo de soporte', icon: <ExternalLink size={15} />,
        disabled: !uno || (!uno.urls.length && !uno.kb.length),
        onSelect: () => uno && void window.adeep.app.openExternal(uno.urls[0] ?? `https://support.microsoft.com/kb/${uno.kb[0]}`)
      }
    ]
  }

  const todasMarcadas = filas.length > 0 && filas.every((u) => checked.has(u.id))
  const accion = seleccion()

  return (
    <>
      <div className="list-head" style={{ gap: 10, height: 'auto', minHeight: 34, flexWrap: 'wrap', padding: '5px 12px' }}>
        <div className="crumbs"><span className="crumb last">{PRESET_TITLE[preset]}</span></div>
        <select value={aprob} onChange={(e) => setAprob(e.target.value as ApprovalFilter)} style={{ width: 'auto', height: 26 }} title="Aprobación">
          <option value="unapproved">Sin aprobar</option>
          <option value="approved">Aprobadas</option>
          <option value="declined">Rechazadas</option>
          <option value="anyButDeclined">Cualquiera menos rechazadas</option>
          <option value="any">Cualquiera</option>
        </select>
        <select value={estado} onChange={(e) => setEstado(e.target.value as StatusFilter)} style={{ width: 'auto', height: 26 }} title="Estado en los equipos">
          <option value="failedOrNeeded">Fallidas o necesarias</option>
          <option value="okOrNoStatus">Instaladas/NA o sin estado</option>
          <option value="failed">Fallidas</option>
          <option value="needed">Necesarias</option>
          <option value="any">Cualquier estado</option>
        </select>
        <select value={reemplazo} onChange={(e) => setReemplazo(e.target.value as SupersededFilter)} style={{ width: 'auto', height: 26 }} title="Reemplazo">
          <option value="any">Vigentes y reemplazadas</option>
          <option value="current">Sólo vigentes</option>
          <option value="superseded">Sólo reemplazadas</option>
        </select>
        <div className="spacer" style={{ flex: 1 }} />
        {loading && <Spinner size={14} />}
        <span className="hint">{filas.length} de {updates?.length ?? 0}{checked.size ? ` · ${checked.size} marcada(s)` : ''}</span>
        <button className="btn sm" disabled={!accion.length || !allowWrites} title={allowWrites ? undefined : STATE_WRITE_HINT} onClick={() => setAprobar(accion)}>
          <CheckCircle2 size={14} /> Aprobar…
        </button>
        <button
          className="btn sm"
          disabled={!accion.length || !allowWrites || accion.every((u) => u.declined)}
          title={allowWrites ? undefined : STATE_WRITE_HINT}
          onClick={() => void rechazar(accion.filter((u) => !u.declined))}
        >
          <XCircle size={14} /> Rechazar
        </button>
        <button className="btn sm ghost" disabled={!filas.length} onClick={exportar} title="Exportar la vista a CSV">
          <FileText size={14} />
        </button>
        <div className="search" style={{ width: 220, margin: 0 }}>
          <Search size={14} />
          <input type="search" placeholder="Título, KB, boletín, producto…" value={texto} onChange={(e) => setTexto(e.target.value)} />
        </div>
      </div>
      <DetailList
        rows={filas}
        rowKey={(u) => u.id}
        selectedKey={selected}
        onSelect={(u) => setSelected(u.id)}
        onOpen={(u) => setDetalle(u)}
        onContextMenu={(u, x, y) => {
          setSelected(u.id)
          const list = checked.size && checked.has(u.id) ? (updates ?? []).filter((x2) => checked.has(x2.id)) : [u]
          setCtx({ items: menu(list), x, y })
        }}
        empty={updates === null ? 'Cargando el catálogo del servidor…' : 'Ninguna actualización cumple el filtro'}
        columns={[
          {
            id: 'check', label: '', width: 30,
            render: (u) => (
              <input
                type="checkbox"
                checked={checked.has(u.id)}
                onClick={(e) => e.stopPropagation()}
                onChange={(e) => setChecked((cur) => {
                  const next = new Set(cur)
                  if (e.target.checked) next.add(u.id)
                  else next.delete(u.id)
                  return next
                })}
                style={{ verticalAlign: -2 }}
              />
            )
          },
          {
            id: 'title', label: 'Título', width: '36%',
            render: (u) => <span title={u.title} style={{ opacity: u.declined ? 0.6 : 1 }}>{u.title}</span>,
            sortValue: (u) => u.title
          },
          { id: 'class', label: 'Clasificación', width: '14%', render: (u) => u.classification ?? '—', sortValue: (u) => u.classification ?? '' },
          { id: 'kb', label: 'KB', width: 90, render: (u) => <span className="mono">{u.kb[0] ?? '—'}</span>, sortValue: (u) => Number(u.kb[0]) || 0 },
          {
            id: 'msrc', label: 'MSRC', width: 92,
            render: (u) => u.msrc === 'Critical'
              ? <span className="badge danger">Crítica</span>
              : u.msrc === 'Important' ? <span className="badge warn">Importante</span> : (MSRC_LABEL[u.msrc] ?? u.msrc),
            sortValue: (u) => MSRC_RANK[u.msrc] ?? 0
          },
          { id: 'approval', label: 'Aprobación', width: 112, render: (u) => <ApprovalBadge u={u} groups={groups} />, sortValue: (u) => approvalOf(u) },
          { id: 'ok', label: 'Inst./NA', width: 96, render: (u) => <OkBar counts={u.counts} />, sortValue: (u) => okPercent(u.counts) ?? -1 },
          {
            id: 'needed', label: 'Necesaria', width: 80,
            render: (u) => (needed(u.counts) ? <span title={countsTitle(u.counts)}>{needed(u.counts)}</span> : <span className="hint">0</span>),
            sortValue: (u) => needed(u.counts)
          },
          {
            id: 'failed', label: 'Falló', width: 60,
            render: (u) => (u.counts.failed ? <span className="badge danger">{u.counts.failed}</span> : <span className="hint">0</span>),
            sortValue: (u) => u.counts.failed
          },
          { id: 'arrival', label: 'Llegada', width: 96, render: (u) => fmtDateOnly(u.arrival), sortValue: (u) => u.arrival ?? '' }
        ]}
      />
      <div className="list-head" style={{ borderTop: '1px solid var(--border)', borderBottom: 0 }}>
        <label className="hint row" style={{ gap: 6, cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={todasMarcadas}
            onChange={(e) => setChecked(e.target.checked ? new Set(filas.map((u) => u.id)) : new Set())}
          />
          Marcar todas las de la vista
        </label>
        <div className="spacer" style={{ flex: 1 }} />
        {checked.size > 0 && <button className="btn sm ghost" onClick={() => setChecked(new Set())}>Desmarcar</button>}
      </div>

      {ctx && <MenuPopup items={ctx.items} x={ctx.x} y={ctx.y} onClose={() => setCtx(null)} />}
      {detalle && (
        <UpdateDialog
          serverId={serverId}
          update={detalle}
          groups={groups}
          computers={computers}
          allowWrites={allowWrites}
          onClose={() => setDetalle(null)}
          onApprove={() => { setAprobar([detalle]); setDetalle(null) }}
        />
      )}
      {aprobar && (
        <ApproveDialog
          serverId={serverId}
          updates={aprobar}
          groups={groups}
          onClose={() => setAprobar(null)}
          onDone={() => { setAprobar(null); setChecked(new Set()); onReload() }}
        />
      )}
    </>
  )
}

type GroupChoice = 'keep' | 'install' | 'uninstall' | 'notApproved'

/**
 * Aprobación por grupo, como el diálogo de la consola de Windows. Cada grupo
 * con un cambio genera una aprobación explícita; los subgrupos heredan la del
 * padre en el servidor, así que «sin cambios» deja todo como está.
 */
export function ApproveDialog({
  serverId,
  updates,
  groups,
  onClose,
  onDone
}: {
  serverId: string
  updates: WsusUpdate[]
  groups: WsusGroup[]
  onClose: () => void
  onDone: () => void
}): JSX.Element {
  const uno = updates.length === 1 ? updates[0] : null
  const arbol = flattenGroups(groups)
  const inicial = (gid: string): GroupChoice => {
    if (!uno) return 'keep'
    const a = latestApproval(uno.approvals, gid)
    return a ? (a.action === 0 ? 'install' : a.action === 1 ? 'uninstall' : 'notApproved') : 'keep'
  }
  const [choice, setChoice] = useState<Record<string, GroupChoice>>(() =>
    Object.fromEntries(arbol.map(({ g }) => [g.id, inicial(g.id)]))
  )
  const [deadline, setDeadline] = useState<Record<string, string>>(() => {
    const out: Record<string, string> = {}
    if (uno) {
      for (const { g } of arbol) {
        const d = latestApproval(uno.approvals, g.id)?.deadline
        if (d) out[g.id] = toLocalInput(d)
      }
    }
    return out
  })
  const [saving, setSaving] = useState(false)
  const toast = useApp((s) => s.toast)
  const confirm = useConfirm()

  const deadlineInicial = (gid: string): string => (uno ? toLocalInput(latestApproval(uno.approvals, gid)?.deadline) : '')
  const cambios = arbol
    .filter(({ g }) => {
      const c = choice[g.id]
      if (c === 'keep') return false
      return c !== inicial(g.id) || (deadline[g.id] ?? '') !== deadlineInicial(g.id)
    })
    .map(({ g }) => ({
      groupId: g.id,
      action: choice[g.id] === 'install' ? 0 : choice[g.id] === 'uninstall' ? 1 : 2,
      deadline: choice[g.id] === 'install' || choice[g.id] === 'uninstall'
        ? (deadline[g.id] ? new Date(deadline[g.id]).toISOString() : undefined)
        : undefined
    }))

  const eula = updates.filter((u) => u.requiresEula)
  const noDesinstalables = updates.filter((u) => !u.uninstallable)
  const reemplazadas = updates.filter((u) => u.superseded)

  const guardar = async (): Promise<void> => {
    if (cambios.some((c) => c.groupId === GROUP_ALL && c.action === 0)) {
      const ok = await confirm({
        title: 'Aprobar para todos los equipos',
        message: `${updates.length} actualización(es) se van a instalar en todos los equipos del servidor, incluidos los servidores.`,
        confirmLabel: 'Aprobar para todos',
        danger: true
      })
      if (!ok) return
    }
    if (eula.length) {
      // La consola de Windows pide aceptar la licencia antes de aprobar; acá se acepta al confirmar.
      const ok = await confirm({
        title: 'Contrato de licencia',
        message: `${eula.length} actualización(es) requieren aceptar un contrato de licencia de Microsoft.`,
        detail: 'Al continuar se acepta en nombre de la organización, igual que en la consola de Windows.',
        confirmLabel: 'Aceptar y aprobar'
      })
      if (!ok) return
      for (const u of eula) {
        const r = await window.adeep.wsus.acceptEula(serverId, u.id, u.revision)
        if (!r.ok) { report(r); return }
      }
    }
    setSaving(true)
    const res = await window.adeep.wsus.approve(serverId, updates.map((u) => ({ id: u.id, revision: u.revision })), cambios)
    setSaving(false)
    const data = report(res)
    if (!data) return
    const errores = data.filter((d) => d.error)
    if (errores.length) toast('error', `${errores.length} con error: ${errores[0].error}`)
    if (data.length - errores.length) toast('ok', `Aprobación aplicada a ${data.length - errores.length} actualización(es)`)
    onDone()
  }

  return (
    <Modal
      title={uno ? 'Aprobar la actualización' : `Aprobar ${updates.length} actualizaciones`}
      subtitle={uno?.title}
      icon={<CheckCircle2 size={18} color="var(--accent)" />}
      size="wide"
      onClose={onClose}
      footer={
        <>
          <span className="hint">{cambios.length ? `${cambios.length} grupo(s) con cambios` : 'Sin cambios'}</span>
          <div className="spacer" style={{ flex: 1 }} />
          <button className="btn" onClick={onClose}>Cancelar</button>
          <button className="btn primary" disabled={!cambios.length || saving} onClick={() => void guardar()}>
            {saving ? 'Aplicando…' : 'Aplicar'}
          </button>
        </>
      }
    >
      {reemplazadas.length > 0 && (
        <Notice>
          {reemplazadas.length === 1 && uno ? 'Esta actualización está reemplazada' : `${reemplazadas.length} están reemplazadas`} por
          otra más nueva. Normalmente conviene aprobar la que la reemplaza y rechazar ésta.
        </Notice>
      )}
      <div className="mini-table-wrap">
        <table className="mini">
          <thead>
            <tr>
              <th>Grupo</th>
              <th style={{ width: 210 }}>Aprobación</th>
              <th style={{ width: 210 }}>Fecha límite (opcional)</th>
            </tr>
          </thead>
          <tbody>
            {arbol.map(({ g, depth }) => {
              const c = choice[g.id]
              return (
                <tr key={g.id}>
                  <td style={{ paddingLeft: 8 + depth * 16 }}>{groupLabel(g)}</td>
                  <td>
                    <select
                      value={c}
                      onChange={(e) => setChoice((cur) => ({ ...cur, [g.id]: e.target.value as GroupChoice }))}
                      style={{ height: 26 }}
                    >
                      <option value="keep">Sin cambios</option>
                      <option value="install">Aprobada para instalar</option>
                      <option value="uninstall" disabled={noDesinstalables.length === updates.length}>Aprobada para quitar</option>
                      <option value="notApproved">No aprobada</option>
                    </select>
                  </td>
                  <td>
                    <input
                      type="datetime-local"
                      disabled={c !== 'install' && c !== 'uninstall'}
                      value={deadline[g.id] ?? ''}
                      onChange={(e) => setDeadline((cur) => ({ ...cur, [g.id]: e.target.value }))}
                      style={{ height: 26 }}
                    />
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <p className="hint" style={{ marginTop: 10, lineHeight: 1.5 }}>
        Los subgrupos heredan la aprobación del grupo padre salvo que tengan una propia. Con fecha límite,
        al vencer los equipos la instalan sin preguntar y pueden reiniciarse.
        {noDesinstalables.length > 0 && ` ${noDesinstalables.length} de las elegidas no se pueden desinstalar.`}
      </p>
    </Modal>
  )
}

function toLocalInput(iso?: string): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`
}

const REBOOT = ['No pide reinicio', 'Siempre reinicia', 'Puede pedir reinicio']
const UPDATE_STATE: Record<number, string> = {
  1: 'Falta el contrato de licencia', 2: 'No se puede instalar', 3: 'No hace falta todavía',
  4: 'Faltan archivos por descargar', 5: 'Lista', 6: 'Descarga cancelada', 7: 'Falló la descarga', 8: 'Falló la descarga de la licencia'
}

export function UpdateDialog({
  serverId,
  update: u,
  groups,
  computers,
  allowWrites,
  onClose,
  onApprove
}: {
  serverId: string
  update: WsusUpdate
  groups: WsusGroup[]
  computers: WsusComputer[]
  allowWrites: boolean
  onClose: () => void
  onApprove: () => void
}): JSX.Element {
  const [tab, setTab] = useState<'general' | 'aprob' | 'estado' | 'reemplazo'>('general')
  const [detail, setDetail] = useState<WsusUpdateDetail | null>(null)
  const [filtroEstado, setFiltroEstado] = useState<number | 'needed' | 'all'>('needed')

  useEffect(() => {
    void window.adeep.wsus.updateDetail(serverId, u.id, u.revision).then((r) => {
      const d = report(r)
      if (d) setDetail(d)
    })
  }, [serverId, u.id, u.revision])

  const nombre = (id: string): string => computers.find((c) => c.id === id)?.name ?? id
  const grupo = (id?: string): string => {
    const g = groups.find((x) => x.id === id)
    return g ? groupLabel(g) : '—'
  }
  const equipos = (detail?.computers ?? []).filter((c) =>
    filtroEstado === 'all' ? true : filtroEstado === 'needed' ? c.state === 2 || c.state === 3 || c.state === 5 : c.state === filtroEstado
  )

  return (
    <Modal
      title={u.title}
      subtitle={`${u.classification ?? 'Actualización'}${u.kb.length ? ` · KB${u.kb.join(', KB')}` : ''} · revisión ${u.revision}`}
      icon={<Package size={18} color="var(--accent)" />}
      size="xwide"
      tall
      onClose={onClose}
      footer={
        <>
          <button className="btn" disabled={!allowWrites} title={allowWrites ? undefined : STATE_WRITE_HINT} onClick={onApprove}>
            Aprobar…
          </button>
          {(u.urls[0] || u.kb[0]) && (
            <button className="btn ghost" onClick={() => void window.adeep.app.openExternal(u.urls[0] ?? `https://support.microsoft.com/kb/${u.kb[0]}`)}>
              <ExternalLink size={14} /> Artículo de soporte
            </button>
          )}
          <div className="spacer" style={{ flex: 1 }} />
          <button className="btn primary" onClick={onClose}>Cerrar</button>
        </>
      }
    >
      <div className="tabs" style={{ marginBottom: 14 }}>
        <button className={`tab ${tab === 'general' ? 'on' : ''}`} onClick={() => setTab('general')}>General</button>
        <button className={`tab ${tab === 'aprob' ? 'on' : ''}`} onClick={() => setTab('aprob')}>Aprobaciones ({u.approvals.length})</button>
        <button className={`tab ${tab === 'estado' ? 'on' : ''}`} onClick={() => setTab('estado')}>Estado en los equipos</button>
        <button className={`tab ${tab === 'reemplazo' ? 'on' : ''}`} onClick={() => setTab('reemplazo')}>Reemplazos</button>
      </div>

      {tab === 'general' && (
        <>
          {u.description && <p style={{ margin: '0 0 14px', fontSize: 13, lineHeight: 1.55 }}>{u.description}</p>}
          <div className="kv">
            <span className="k">Estado</span>
            <span className="v">
              {u.declined ? <span className="badge neutral">Rechazada</span> : <ApprovalBadge u={u} groups={groups} />}
              {u.superseded && <span className="badge warn" style={{ marginLeft: 6 }}>Reemplazada</span>}
              {u.expired && <span className="badge neutral" style={{ marginLeft: 6 }}>Vencida</span>}
            </span>
            <span className="k">Archivos en el servidor</span>
            <span className="v">{UPDATE_STATE[u.state] ?? `estado ${u.state}`}</span>
            <span className="k">Gravedad MSRC</span>
            <span className="v">{MSRC_LABEL[u.msrc] ?? u.msrc}</span>
            <span className="k">Clasificación</span>
            <span className="v">{u.classification ?? '—'}</span>
            <span className="k">Productos</span>
            <span className="v">{u.products.join(', ') || '—'}</span>
            <span className="k">Artículos KB</span>
            <span className="v">{u.kb.map((k) => `KB${k}`).join(', ') || '—'}</span>
            <span className="k">Boletines</span>
            <span className="v">{u.bulletins.join(', ') || '—'}</span>
            <span className="k">Reinicio</span>
            <span className="v">{REBOOT[u.rebootBehavior] ?? '—'}</span>
            <span className="k">Se puede desinstalar</span>
            <span className="v">{u.uninstallable ? 'Sí' : 'No'}</span>
            <span className="k">Contrato de licencia</span>
            <span className="v">{u.requiresEula ? 'Requiere aceptarlo' : 'No'}</span>
            <span className="k">Publicada por Microsoft</span>
            <span className="v">{fmtDate(u.created)}</span>
            <span className="k">Llegó al servidor</span>
            <span className="v">{fmtDate(u.arrival)}</span>
            <span className="k">Equipos</span>
            <span className="v">{countsTitle(u.counts).split('\n').join(' · ')}</span>
            <span className="k">Id</span>
            <span className="v mono">{u.id}</span>
          </div>
        </>
      )}

      {tab === 'aprob' && (
        u.approvals.length ? (
          <div className="mini-table-wrap">
            <table className="mini">
              <thead><tr><th>Grupo</th><th>Acción</th><th>Fecha límite</th><th>Aprobada</th><th>Por</th><th>Revisión</th></tr></thead>
              <tbody>
                {u.approvals.map((a) => (
                  <tr key={a.id}>
                    <td>{grupo(a.groupId)}</td>
                    <td>{ACTION_LABEL[a.action] ?? a.action}</td>
                    <td>{fmtDate(a.deadline)}</td>
                    <td>{fmtDate(a.time)}</td>
                    <td>{a.admin === 'WUS Server' ? 'Regla automática' : a.admin ?? '—'}</td>
                    <td className="mono">{a.revision}{a.revision !== u.revision ? ' (vieja)' : ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <div className="hint">{u.declined ? 'Está rechazada: no tiene aprobaciones.' : 'No está aprobada para ningún grupo.'}</div>
      )}

      {tab === 'estado' && (
        !detail ? <Spinner /> : (
          <>
            <div className="mini-table-wrap" style={{ marginBottom: 14 }}>
              <table className="mini">
                <thead><tr><th>Grupo</th><th>Instaladas/NA</th><th>Necesaria</th><th>Falló</th><th>Sin estado</th></tr></thead>
                <tbody>
                  {flattenGroups(groups).map(({ g, depth }) => {
                    const c = detail.groups.find((x) => x.groupId === g.id)?.counts
                    if (!c) return null
                    return (
                      <tr key={g.id}>
                        <td style={{ paddingLeft: 8 + depth * 16 }}>{groupLabel(g)}</td>
                        <td><OkBar counts={c} /></td>
                        <td>{needed(c)}</td>
                        <td>{c.failed ? <span className="badge danger">{c.failed}</span> : 0}</td>
                        <td>{c.unknown}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            <div className="row" style={{ gap: 8, marginBottom: 8 }}>
              <span className="hint">Equipos:</span>
              <select value={String(filtroEstado)} onChange={(e) => setFiltroEstado(e.target.value === 'all' || e.target.value === 'needed' ? e.target.value : Number(e.target.value))} style={{ width: 'auto', height: 26 }}>
                <option value="needed">Necesaria o falló</option>
                {STATE_LABEL.map((l, i) => <option key={i} value={i}>{l}</option>)}
                <option value="all">Todos</option>
              </select>
              <span className="hint">{equipos.length}</span>
            </div>
            <div className="mini-table-wrap" style={{ maxHeight: 300, overflow: 'auto' }}>
              <table className="mini">
                <thead><tr><th>Equipo</th><th>Grupo</th><th>Estado</th></tr></thead>
                <tbody>
                  {equipos.map((c) => (
                    <tr key={c.computerId}>
                      <td>{nombre(c.computerId)}</td>
                      <td>{grupo(c.groupId)}</td>
                      <td><StateBadge state={c.state} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )
      )}

      {tab === 'reemplazo' && (
        !detail ? <Spinner /> : (
          <>
            <div style={{ fontWeight: 600, fontSize: 13, margin: '0 0 6px' }}>La reemplazan</div>
            <RefList refs={detail.supersededBy} vacio="Ninguna: es la versión vigente." />
            <div style={{ fontWeight: 600, fontSize: 13, margin: '14px 0 6px' }}>Reemplaza a</div>
            <RefList refs={detail.supersedes} vacio="No reemplaza a ninguna." />
          </>
        )
      )}
    </Modal>
  )
}

function RefList({ refs, vacio }: { refs: WsusUpdateDetail['supersedes']; vacio: string }): JSX.Element {
  if (!refs.length) return <div className="hint">{vacio}</div>
  return (
    <div className="mini-table-wrap">
      <table className="mini">
        <tbody>
          {refs.map((r) => (
            <tr key={`${r.id}-${r.revision}`}>
              <td>{r.title}</td>
              <td className="mono" style={{ width: 90 }}>{r.kb[0] ? `KB${r.kb[0]}` : ''}</td>
              <td style={{ width: 100 }}>{r.declined ? <span className="badge neutral">Rechazada</span> : null}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
