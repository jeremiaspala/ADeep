import { useEffect, useState, type JSX, type ReactNode } from 'react'
import { CloudDownload, ShieldAlert, Lock } from 'lucide-react'
import type { WsusApproval, WsusGroup, WsusServerConfig, WsusStateCounts, WsusUpdate } from '@shared/types'
import { Check2, Field, Modal, Text } from '../../components/ui'
import { report, useApp } from '../../store'
import { dnToDomain } from '../../lib/format'

export const GROUP_ALL = 'a0a08746-4dbe-4a37-9adf-9e7652c0b421'
export const GROUP_UNASSIGNED = 'b73ca6ed-5727-47f3-84de-015e03f6a88a'

/** UpdateInstallationState, en el orden de MS-WSUSAR 2.2.5.1. */
export const STATE_LABEL = [
  'Sin estado', 'No aplicable', 'Necesaria', 'Descargada', 'Instalada', 'Falló', 'Instalada, falta reiniciar'
]

export const STATE_BADGE = ['neutral', 'neutral', 'warn', 'warn', 'ok', 'danger', 'accent']

export const ACTION_LABEL: Record<number, string> = {
  0: 'Instalar', 1: 'Quitar', 2: 'No aprobada'
}

export const MSRC_LABEL: Record<string, string> = {
  Critical: 'Crítica', Important: 'Importante', Moderate: 'Moderada', Low: 'Baja', Unspecified: '—'
}

export const MSRC_RANK: Record<string, number> = { Critical: 4, Important: 3, Moderate: 2, Low: 1, Unspecified: 0 }

export const SYNC_RESULT = ['Nunca', 'Correcta', 'Falló', 'Cancelada', 'Desconocida']

/** Nombres de los grupos que trae WSUS, que el servidor devuelve en inglés. */
export function groupLabel(g: Pick<WsusGroup, 'id' | 'name'>): string {
  if (g.id === GROUP_ALL) return 'Todos los equipos'
  if (g.id === GROUP_UNASSIGNED) return 'Equipos sin asignar'
  return g.name
}

export const needed = (c: WsusStateCounts): number => c.notInstalled + c.downloaded
export const okCount = (c: WsusStateCounts): number => c.installed + c.notApplicable + c.pendingReboot
export const total = (c: WsusStateCounts): number =>
  c.unknown + c.notApplicable + c.notInstalled + c.downloaded + c.installed + c.failed + c.pendingReboot

/** Porcentaje «instalada o no aplicable», el número que muestra la consola de Windows. */
export function okPercent(c: WsusStateCounts): number | null {
  const t = total(c)
  return t ? Math.floor((okCount(c) * 100) / t) : null
}

export function fmtBytes(n: number): string {
  if (!n) return '0 B'
  const u = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.min(u.length - 1, Math.floor(Math.log(n) / Math.log(1024)))
  return `${(n / 1024 ** i).toFixed(i ? 1 : 0)} ${u[i]}`
}

export function fmtTimeOfDay(seconds: number): string {
  // La hora de sincronización se guarda en UTC; se muestra en la hora local.
  const d = new Date(Date.UTC(2000, 0, 1, 0, 0, seconds))
  return d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })
}

export function hresult(n?: number): string {
  if (!n) return ''
  return `0x${(n >>> 0).toString(16).toUpperCase().padStart(8, '0')}`
}

export type Approval = 'declined' | 'install' | 'uninstall' | 'none'

/** Estado de aprobación resumido para la columna de la lista. */
export function approvalOf(u: WsusUpdate): Approval {
  if (u.declined) return 'declined'
  if (u.approvals.some((a) => a.action === 0)) return 'install'
  if (u.approvals.some((a) => a.action === 1)) return 'uninstall'
  return 'none'
}

export function ApprovalBadge({ u, groups }: { u: WsusUpdate; groups: WsusGroup[] }): JSX.Element {
  const a = approvalOf(u)
  if (a === 'declined') return <span className="badge neutral">Rechazada</span>
  if (a === 'none') return <span className="badge warn">Sin aprobar</span>
  const activas = u.approvals.filter((x) => x.action === 0 || x.action === 1)
  const nombres = activas.map((x) => {
    const g = groups.find((gg) => gg.id === x.groupId)
    return `${g ? groupLabel(g) : x.groupId}: ${ACTION_LABEL[x.action]}`
  })
  return (
    <span className={`badge ${a === 'install' ? 'ok' : 'accent'}`} title={nombres.join('\n')}>
      {a === 'install' ? 'Instalar' : 'Quitar'} ({activas.length})
    </span>
  )
}

export function StateBadge({ state }: { state: number }): JSX.Element {
  return <span className={`badge ${STATE_BADGE[state] ?? 'neutral'}`}>{STATE_LABEL[state] ?? state}</span>
}

/** Barra de «instalada o no aplicable» con el porcentaje al lado. */
export function OkBar({ counts }: { counts: WsusStateCounts }): JSX.Element {
  const p = okPercent(counts)
  if (p === null) return <span className="hint">—</span>
  const color = counts.failed ? 'var(--danger)' : p === 100 ? 'var(--ok)' : 'var(--warn)'
  return (
    <span className="row" style={{ gap: 6 }} title={countsTitle(counts)}>
      <span style={{ width: 52, height: 6, borderRadius: 3, background: 'var(--bg-sunken)', overflow: 'hidden', flex: '0 0 auto' }}>
        <span style={{ display: 'block', width: `${p}%`, height: '100%', background: color }} />
      </span>
      <span className="mono" style={{ fontSize: 11.5 }}>{p}%</span>
    </span>
  )
}

export function countsTitle(c: WsusStateCounts): string {
  return [
    `Instaladas: ${c.installed}`, `Falta reiniciar: ${c.pendingReboot}`, `No aplicables: ${c.notApplicable}`,
    `Necesarias: ${needed(c)}`, `Fallidas: ${c.failed}`, `Sin estado: ${c.unknown}`
  ].join('\n')
}

/** Árbol de grupos aplanado, con profundidad, para listas y selectores. */
export function flattenGroups(groups: WsusGroup[]): { g: WsusGroup; depth: number }[] {
  const out: { g: WsusGroup; depth: number }[] = []
  const walk = (parent: string | undefined, depth: number): void => {
    groups
      .filter((g) => g.parentId === parent)
      .sort((a, b) => (a.id === GROUP_UNASSIGNED ? 1 : b.id === GROUP_UNASSIGNED ? -1 : a.name.localeCompare(b.name, 'es')))
      .forEach((g) => { out.push({ g, depth }); walk(g.id, depth + 1) })
  }
  walk(undefined, 0)
  return out
}

export function latestApproval(approvals: WsusApproval[], groupId: string): WsusApproval | undefined {
  return approvals.filter((a) => a.groupId === groupId).sort((a, b) => (b.time ?? '').localeCompare(a.time ?? ''))[0]
}

export function Panel({ title, children, actions }: { title: string; children: ReactNode; actions?: ReactNode }): JSX.Element {
  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 'var(--r-sm)', background: 'var(--bg-elev)', padding: 14, minWidth: 0 }}>
      <div className="row" style={{ marginBottom: 10, gap: 8 }}>
        <div style={{ fontWeight: 600, fontSize: 13 }}>{title}</div>
        <div className="spacer" style={{ flex: 1 }} />
        {actions}
      </div>
      {children}
    </div>
  )
}

export function Notice({ tone = 'warn', children }: { tone?: 'warn' | 'danger' | 'info'; children: ReactNode }): JSX.Element {
  const color = tone === 'danger' ? 'var(--danger)' : tone === 'info' ? 'var(--accent)' : 'var(--warn)'
  const bg = tone === 'danger' ? 'var(--danger-soft)' : tone === 'info' ? 'var(--accent-soft)' : 'var(--warn-soft)'
  return (
    <div className="row" style={{ gap: 10, alignItems: 'flex-start', padding: 12, borderRadius: 'var(--r-sm)', background: bg, marginBottom: 12 }}>
      {tone === 'info' ? <Lock size={16} color={color} /> : <ShieldAlert size={16} color={color} />}
      <div className="hint" style={{ lineHeight: 1.5, color: 'var(--text)' }}>{children}</div>
    </div>
  )
}

/** Alta y edición de la conexión a un servidor WSUS. */
export function ServerDialog({
  initial,
  onClose,
  onSaved
}: {
  initial?: WsusServerConfig
  onClose: () => void
  onSaved: (list: WsusServerConfig[], id: string) => void
}): JSX.Element {
  const [host, setHost] = useState(initial?.host ?? '')
  const [name, setName] = useState(initial?.name ?? '')
  const [ssl, setSsl] = useState(initial?.ssl ?? false)
  const [port, setPort] = useState(String(initial?.port ?? 8530))
  const [insecure, setInsecure] = useState(initial?.insecureTLS ?? false)
  const [allowWrites, setAllowWrites] = useState(initial?.allowWrites ?? false)
  const [ownUser, setOwnUser] = useState(!!initial?.user)
  const [user, setUser] = useState(initial?.user ?? '')
  const [password, setPassword] = useState('')
  const [probing, setProbing] = useState(false)
  const [probe, setProbe] = useState<string | null>(null)
  const [sugerencias, setSugerencias] = useState<string[]>([])
  const session = useApp((s) => s.session)

  useEffect(() => {
    if (initial) return
    // WSUS no publica nada en el directorio: lo único que hay para sugerir es el nombre del equipo.
    const dominio = dnToDomain(session.rootDSE?.defaultNamingContext ?? '')
    void window.adeep.search.pick('wsus', ['computer']).then((r) => {
      if (r.ok && r.data) {
        setSugerencias(r.data.map((e) => `${e.name.toLowerCase()}${dominio ? `.${dominio}` : ''}`).slice(0, 8))
      }
    }).catch(() => undefined)
  }, [initial, session])

  const portNum = Number(port)
  const valido = host.trim() && portNum > 0 && portNum < 65536 && (!ownUser || (user.trim() && (password || initial?.user)))

  const armar = async (): Promise<WsusServerConfig> => {
    const id = initial?.id ?? (await window.adeep.store.newId()).data ?? String(Date.now())
    return {
      id,
      name: name.trim() || host.trim().split('.')[0].toUpperCase(),
      host: host.trim(),
      port: portNum,
      ssl,
      insecureTLS: ssl && insecure ? true : undefined,
      allowWrites,
      user: ownUser ? user.trim() : undefined
    }
  }

  const guardar = async (): Promise<void> => {
    const server = await armar()
    const res = await window.adeep.wsus.saveServer(server, ownUser ? password || undefined : undefined)
    const list = report(res, `Conexión a ${server.name} guardada`)
    if (list) onSaved(list, server.id)
  }

  const probar = async (): Promise<void> => {
    setProbing(true)
    setProbe(null)
    const server = await armar()
    const saved = await window.adeep.wsus.saveServer(server, ownUser ? password || undefined : undefined)
    if (!saved.ok) { setProbing(false); setProbe(saved.error ?? 'No se pudo guardar'); return }
    const r = await window.adeep.wsus.ping(server.id)
    setProbing(false)
    if (r.ok && r.data) {
      const rol = r.data.role === 2 ? 'administrador' : r.data.role === 1 ? 'sólo informes' : 'sin rol'
      setProbe(`Conectado: WSUS ${r.data.version}, rol ${rol}.`)
    } else {
      setProbe(r.error ?? 'No se pudo conectar')
    }
    onSaved(saved.data ?? [], server.id)
  }

  return (
    <Modal
      title={initial ? `Conexión a ${initial.name}` : 'Agregar servidor WSUS'}
      subtitle="MS-WSUSAR: el mismo servicio que usa la consola de Windows"
      icon={<CloudDownload size={18} color="var(--accent)" />}
      onClose={onClose}
      footer={
        <>
          <button className="btn" disabled={!valido || probing} onClick={() => void probar()}>
            {probing ? 'Probando…' : 'Probar conexión'}
          </button>
          <div className="spacer" style={{ flex: 1 }} />
          <button className="btn" onClick={onClose}>Cancelar</button>
          <button className="btn primary" disabled={!valido} onClick={() => void guardar()}>Guardar</button>
        </>
      }
    >
      <Text label="Servidor" value={host} onChange={setHost} placeholder="wsus01.empresa.local" autoFocus />
      {sugerencias.length > 0 && !host && (
        <div className="row" style={{ gap: 6, flexWrap: 'wrap', margin: '-4px 0 10px' }}>
          <span className="hint">Del directorio:</span>
          {sugerencias.map((s) => (
            <button key={s} className="btn sm ghost" onClick={() => setHost(s)}>{s}</button>
          ))}
        </div>
      )}
      <Text label="Nombre para mostrar" value={name} onChange={setName} placeholder={host.split('.')[0].toUpperCase() || 'opcional'} />
      <div className="row" style={{ gap: 12, alignItems: 'flex-end' }}>
        <Field label="Protocolo" style={{ flex: 1 }}>
          <select
            value={ssl ? 'https' : 'http'}
            onChange={(e) => {
              const s = e.target.value === 'https'
              setSsl(s)
              if (port === '8530' || port === '8531') setPort(s ? '8531' : '8530')
            }}
          >
            <option value="http">HTTP</option>
            <option value="https">HTTPS (SSL)</option>
          </select>
        </Field>
        <Text label="Puerto" value={port} onChange={setPort} style={{ width: 110 }} />
      </div>
      {ssl && (
        <Opt
          label="No verificar el certificado del servidor"
          hint="Sólo para labs: sin verificación, cualquiera en el medio puede hacerse pasar por el WSUS."
          checked={insecure}
          onChange={setInsecure}
        />
      )}
      {!ssl && (
        <Notice>
          Por HTTP la contraseña no viaja (NTLM no la manda), pero sí todo lo demás, y la sesión
          autenticada se puede secuestrar desde la misma red. Si el servidor tiene configurado SSL
          (<span className="mono">wsusutil configuressl</span>), usá HTTPS en el 8531.
        </Notice>
      )}

      <div style={{ marginTop: 6, paddingTop: 12, borderTop: '1px solid var(--border)' }}>
        <Opt
          label="Usar otra cuenta para este servidor"
          hint="Si no, se autentica con la misma cuenta de la sesión LDAP."
          checked={ownUser}
          onChange={setOwnUser}
        />
        {ownUser && (
          <div className="row" style={{ gap: 12 }}>
            <Text label="Usuario" value={user} onChange={setUser} placeholder="DOMINIO\usuario o usuario@dominio" style={{ flex: 1 }} />
            <Text
              label="Contraseña"
              type="password"
              value={password}
              onChange={setPassword}
              placeholder={initial?.user ? 'sin cambios' : ''}
              style={{ flex: 1 }}
            />
          </div>
        )}
      </div>

      <div style={{ marginTop: 6, paddingTop: 12, borderTop: '1px solid var(--border)' }}>
        <Opt
          label="Permitir cambios en este servidor"
          hint="Aprobar, rechazar, mover equipos, sincronizar, limpiar y cambiar opciones. Apagado, la consola es de sólo lectura."
          checked={allowWrites}
          onChange={setAllowWrites}
        />
      </div>

      {probe && <div className="hint" style={{ marginTop: 10 }}>{probe}</div>}
    </Modal>
  )
}

/** Check2 en su propio renglón: `label.check` es inline y en los formularios se encadena. */
export function Opt(props: Parameters<typeof Check2>[0]): JSX.Element {
  return <div><Check2 {...props} /></div>
}
