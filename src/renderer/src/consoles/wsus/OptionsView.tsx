import { useEffect, useMemo, useState, type JSX } from 'react'
import {
  Globe, Boxes, Clock, HardDrive, Monitor, ListChecks, Eraser, Mail, Plug, Plus, Trash2, Play, ChevronRight
} from 'lucide-react'
import type {
  WsusApprovalRule, WsusCategory, WsusEmailConfig, WsusGroup, WsusOverview, WsusProductsAndClassifications,
  WsusServerConfig
} from '@shared/types'
import { Field, Modal, Spinner, Text, useConfirm } from '../../components/ui'
import { report, useApp } from '../../store'
import { Notice, ServerDialog, flattenGroups, fmtBytes, fmtTimeOfDay, groupLabel, Opt } from './common'

type Dialogo = 'source' | 'products' | 'schedule' | 'files' | 'computers' | 'rules' | 'cleanup' | 'email' | 'connection'

const STATE_WRITE_HINT = 'El servidor está en sólo lectura: habilitá los cambios en la conexión.'

export default function OptionsView({
  server, overview, groups, onReload, onServers
}: {
  server: WsusServerConfig
  overview: WsusOverview | null
  groups: WsusGroup[]
  onReload: () => void
  onServers: (list: WsusServerConfig[]) => void
}): JSX.Element {
  const [dialog, setDialog] = useState<Dialogo | null>(null)
  const w = server.allowWrites
  const o = overview
  const close = (): void => setDialog(null)
  const done = (): void => { setDialog(null); onReload() }

  const items: { id: Dialogo; icon: JSX.Element; title: string; desc: string; write?: boolean }[] = [
    { id: 'source', icon: <Globe size={16} />, title: 'Origen de actualizaciones y proxy', desc: o ? (o.config.syncFromMicrosoft ? 'Microsoft Update' : `Desde ${o.config.upstreamServer}${o.config.replica ? ' (réplica)' : ''}`) + (o.config.useProxy ? ` · proxy ${o.config.proxyName}:${o.config.proxyPort}` : '') : '' },
    { id: 'products', icon: <Boxes size={16} />, title: 'Productos y clasificaciones', desc: 'Qué se sincroniza del catálogo' },
    { id: 'schedule', icon: <Clock size={16} />, title: 'Programación de la sincronización', desc: o ? (o.subscription.synchronizeAutomatically ? `${o.subscription.perDay} por día desde las ${fmtTimeOfDay(o.subscription.timeOfDay)}` : 'Manual') : '' },
    { id: 'files', icon: <HardDrive size={16} />, title: 'Archivos e idiomas', desc: o ? `${o.config.storeLocally ? 'Guarda los archivos' : 'Los equipos bajan de Microsoft'} · ${o.config.downloadOnlyApproved ? 'sólo lo aprobado' : 'todo'} · ${o.config.allLanguages ? 'todos los idiomas' : o.config.languages.join(', ')}` : '' },
    { id: 'computers', icon: <Monitor size={16} />, title: 'Equipos', desc: o ? (o.config.serverTargeting ? 'Grupos asignados desde la consola' : 'Grupos asignados por directiva') : '' },
    { id: 'rules', icon: <ListChecks size={16} />, title: 'Aprobaciones automáticas', desc: 'Reglas que aprueban lo que llega' },
    { id: 'cleanup', icon: <Eraser size={16} />, title: 'Asistente de limpieza del servidor', desc: 'Rechazar reemplazadas y vencidas, borrar obsoletos' },
    { id: 'email', icon: <Mail size={16} />, title: 'Notificaciones por correo', desc: 'Avisos de sincronización y resúmenes de estado' },
    { id: 'connection', icon: <Plug size={16} />, title: 'Conexión de la consola', desc: `${server.ssl ? 'HTTPS' : 'HTTP'} ${server.host}:${server.port} · ${w ? 'cambios habilitados' : 'sólo lectura'}` }
  ]

  return (
    <div style={{ padding: 16, overflow: 'auto' }}>
      {!w && (
        <Notice tone="info">
          Este servidor está en sólo lectura: se pueden ver todas las opciones, pero para cambiarlas hay
          que habilitar los cambios en «Conexión de la consola».
        </Notice>
      )}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(330px, 1fr))', gap: 10 }}>
        {items.map((it) => (
          <button
            key={it.id}
            className="btn"
            style={{ height: 'auto', padding: 12, justifyContent: 'flex-start', textAlign: 'left', gap: 12 }}
            onClick={() => setDialog(it.id)}
          >
            <span style={{ color: 'var(--accent)' }}>{it.icon}</span>
            <span style={{ minWidth: 0, flex: 1 }}>
              <div style={{ fontWeight: 600 }}>{it.title}</div>
              <div className="hint truncate">{it.desc}</div>
            </span>
            <ChevronRight size={14} />
          </button>
        ))}
      </div>

      {dialog === 'source' && o && <SourceDialog server={server} overview={o} onClose={close} onDone={done} />}
      {dialog === 'products' && <ProductsDialog server={server} onClose={close} onDone={done} />}
      {dialog === 'schedule' && o && <ScheduleDialog server={server} overview={o} onClose={close} onDone={done} />}
      {dialog === 'files' && o && <FilesDialog server={server} overview={o} onClose={close} onDone={done} />}
      {dialog === 'computers' && o && <TargetingDialog server={server} overview={o} onClose={close} onDone={done} />}
      {dialog === 'rules' && <RulesDialog server={server} groups={groups} onClose={close} onChanged={onReload} />}
      {dialog === 'cleanup' && <CleanupDialog server={server} onClose={close} onDone={done} />}
      {dialog === 'email' && <EmailDialog server={server} onClose={close} onDone={done} />}
      {dialog === 'connection' && (
        <ServerDialog initial={server} onClose={close} onSaved={(list) => { onServers(list); close(); onReload() }} />
      )}
    </div>
  )
}

function Footer({ w, saving, onClose, onSave, label = 'Guardar' }: {
  w: boolean; saving?: boolean; onClose: () => void; onSave: () => void; label?: string
}): JSX.Element {
  return (
    <>
      <div className="spacer" style={{ flex: 1 }} />
      <button className="btn" onClick={onClose}>{w ? 'Cancelar' : 'Cerrar'}</button>
      {w && <button className="btn primary" disabled={saving} onClick={onSave}>{saving ? 'Guardando…' : label}</button>}
    </>
  )
}

function ReadOnlyNote({ w }: { w: boolean }): JSX.Element | null {
  return w ? null : <Notice tone="info">{STATE_WRITE_HINT}</Notice>
}

function useSave(server: WsusServerConfig, onDone: () => void): [boolean, (fn: () => Promise<{ ok: boolean; error?: string; data?: unknown }>, msg: string) => Promise<void>] {
  const [saving, setSaving] = useState(false)
  const run = async (fn: () => Promise<{ ok: boolean; error?: string; data?: unknown }>, msg: string): Promise<void> => {
    setSaving(true)
    const r = await fn()
    setSaving(false)
    if (report(r, `${server.name}: ${msg}`) !== undefined) onDone()
  }
  return [saving, run]
}

/* ------------------------------ Origen y proxy ------------------------------ */

function SourceDialog({ server, overview, onClose, onDone }: { server: WsusServerConfig; overview: WsusOverview; onClose: () => void; onDone: () => void }): JSX.Element {
  const c = overview.config
  const [mu, setMu] = useState(c.syncFromMicrosoft)
  const [up, setUp] = useState(c.upstreamServer ?? '')
  const [upPort, setUpPort] = useState(String(c.upstreamPort))
  const [upSsl, setUpSsl] = useState(c.upstreamSsl)
  const [replica, setReplica] = useState(c.replica)
  const [useProxy, setUseProxy] = useState(c.useProxy)
  const [proxy, setProxy] = useState(c.proxyName ?? '')
  const [proxyPort, setProxyPort] = useState(String(c.proxyPort))
  const [saving, save] = useSave(server, onDone)
  const confirm = useConfirm()
  const w = server.allowWrites

  const guardar = async (): Promise<void> => {
    if (mu !== c.syncFromMicrosoft || replica !== c.replica) {
      const ok = await confirm({
        title: 'Cambiar el origen',
        message: 'Cambiar de dónde sincroniza el servidor afecta qué actualizaciones ve y, en modo réplica, borra las aprobaciones propias.',
        confirmLabel: 'Cambiar', danger: true
      })
      if (!ok) return
    }
    await save(() => window.adeep.wsus.setConfiguration(server.id, {
      syncFromMicrosoft: mu, upstreamServer: mu ? undefined : up, upstreamPort: Number(upPort) || 8530, upstreamSsl: upSsl,
      replica: mu ? false : replica, useProxy, proxyName: proxy, proxyPort: Number(proxyPort) || 80
    }), 'origen y proxy guardados')
  }

  return (
    <Modal title="Origen de actualizaciones y proxy" icon={<Globe size={18} color="var(--accent)" />} onClose={onClose}
      footer={<Footer w={w} saving={saving} onClose={onClose} onSave={() => void guardar()} />}>
      <ReadOnlyNote w={w} />
      <label className="check" style={{ display: 'flex' }}><input type="radio" checked={mu} disabled={!w} onChange={() => setMu(true)} /><span>Sincronizar desde Microsoft Update</span></label>
      <label className="check" style={{ display: 'flex' }}><input type="radio" checked={!mu} disabled={!w} onChange={() => setMu(false)} /><span>Sincronizar desde otro servidor WSUS</span></label>
      {!mu && (
        <div style={{ paddingLeft: 24 }}>
          <div className="row" style={{ gap: 12 }}>
            <Text label="Servidor de origen" value={up} onChange={setUp} disabled={!w} style={{ flex: 1 }} />
            <Text label="Puerto" value={upPort} onChange={setUpPort} disabled={!w} style={{ width: 100 }} />
          </div>
          <Opt label="Usar SSL con el servidor de origen" checked={upSsl} disabled={!w} onChange={setUpSsl} />
          <Opt label="Es una réplica del servidor de origen" hint="Hereda aprobaciones, grupos y opciones; no se administra por separado." checked={replica} disabled={!w} onChange={setReplica} />
        </div>
      )}
      <div style={{ marginTop: 10, paddingTop: 12, borderTop: '1px solid var(--border)' }}>
        <Opt label="Usar un proxy para sincronizar" checked={useProxy} disabled={!w} onChange={setUseProxy} />
        {useProxy && (
          <div className="row" style={{ gap: 12, paddingLeft: 24 }}>
            <Text label="Proxy" value={proxy} onChange={setProxy} disabled={!w} style={{ flex: 1 }} />
            <Text label="Puerto" value={proxyPort} onChange={setProxyPort} disabled={!w} style={{ width: 100 }} />
          </div>
        )}
        <p className="hint">Las credenciales del proxy se cargan desde la consola de Windows: el protocolo no permite leerlas.</p>
      </div>
    </Modal>
  )
}

/* ------------------------------ Productos y clasificaciones ------------------------------ */

function ProductsDialog({ server, onClose, onDone }: { server: WsusServerConfig; onClose: () => void; onDone: () => void }): JSX.Element {
  const [data, setData] = useState<WsusProductsAndClassifications | null>(null)
  const [prods, setProds] = useState<Set<string>>(new Set())
  const [classes, setClasses] = useState<Set<string>>(new Set())
  const [tab, setTab] = useState<'products' | 'classes'>('products')
  const [filtro, setFiltro] = useState('')
  const [soloMarcados, setSoloMarcados] = useState(false)
  const [open, setOpen] = useState<Set<string>>(new Set())
  const [saving, save] = useSave(server, onDone)
  const w = server.allowWrites

  useEffect(() => {
    void window.adeep.wsus.products(server.id).then((r) => {
      const d = report(r)
      if (!d) return
      setData(d)
      setProds(new Set(d.selectedProducts))
      setClasses(new Set(d.selectedClassifications))
      // Abiertas las ramas que tienen algo elegido.
      const byId = new Map(d.products.map((p) => [p.id, p]))
      const abrir = new Set<string>()
      for (const id of d.selectedProducts) {
        let p = byId.get(id)?.parentId
        while (p) { abrir.add(p); p = byId.get(p)?.parentId }
      }
      setOpen(abrir)
    })
  }, [server.id])

  const hijos = useMemo(() => {
    const m = new Map<string | undefined, WsusCategory[]>()
    for (const p of data?.products ?? []) {
      const list = m.get(p.parentId) ?? []
      list.push(p)
      m.set(p.parentId, list)
    }
    for (const l of m.values()) l.sort((a, b) => a.title.localeCompare(b.title, 'es'))
    return m
  }, [data])

  const q = filtro.trim().toLowerCase()
  const toggle = (set: Set<string>, id: string, v: boolean): Set<string> => {
    const n = new Set(set)
    if (v) n.add(id)
    else n.delete(id)
    return n
  }

  const contieneMarcado = (id: string): boolean =>
    (hijos.get(id) ?? []).some((c) => prods.has(c.id) || contieneMarcado(c.id))

  const rama = (parent: string | undefined, depth: number): JSX.Element[] =>
    (hijos.get(parent) ?? []).flatMap((p) => {
      const sub = hijos.get(p.id) ?? []
      const visible = !q || p.title.toLowerCase().includes(q) || sub.some((s) => s.title.toLowerCase().includes(q))
      if (!visible) return []
      if (soloMarcados && !prods.has(p.id) && !contieneMarcado(p.id)) return []
      const abierta = open.has(p.id) || !!q || soloMarcados
      return [
        <div key={p.id} className="row" style={{ paddingLeft: depth * 18, gap: 4, minHeight: 26 }}>
          <span
            className={`twisty ${abierta ? 'open' : ''} ${sub.length ? '' : 'empty'}`}
            onClick={() => setOpen((cur) => toggle(cur, p.id, !cur.has(p.id)))}
            style={{ cursor: 'pointer' }}
          >
            <ChevronRight size={14} />
          </span>
          <label className="row" style={{ gap: 6, cursor: w ? 'pointer' : 'default' }} title={p.description}>
            <input type="checkbox" disabled={!w} checked={prods.has(p.id)} onChange={(e) => setProds((cur) => toggle(cur, p.id, e.target.checked))} />
            <span>{p.title}</span>
            {p.type !== 'Product' && <span className="hint">({sub.length})</span>}
          </label>
        </div>,
        ...(abierta ? rama(p.id, depth + 1) : [])
      ]
    })

  return (
    <Modal title="Productos y clasificaciones" icon={<Boxes size={18} color="var(--accent)" />} size="wide" tall onClose={onClose}
      footer={<Footer w={w} saving={saving} onClose={onClose} onSave={() => void save(() => window.adeep.wsus.setProducts(server.id, [...prods], [...classes]), 'productos y clasificaciones guardados')} />}>
      <ReadOnlyNote w={w} />
      {!data ? <Spinner /> : (
        <>
          <div className="tabs" style={{ marginBottom: 10 }}>
            <button className={`tab ${tab === 'products' ? 'on' : ''}`} onClick={() => setTab('products')}>Productos ({prods.size})</button>
            <button className={`tab ${tab === 'classes' ? 'on' : ''}`} onClick={() => setTab('classes')}>Clasificaciones ({classes.size})</button>
          </div>
          {tab === 'products' ? (
            <>
              <div className="row" style={{ gap: 12, alignItems: 'center' }}>
                <Text value={filtro} onChange={setFiltro} placeholder="Filtrar productos…" style={{ flex: 1 }} />
                <label className="hint row" style={{ gap: 5, cursor: 'pointer', marginBottom: 10 }}>
                  <input type="checkbox" checked={soloMarcados} onChange={(e) => setSoloMarcados(e.target.checked)} /> Sólo los marcados
                </label>
              </div>
              <div style={{ maxHeight: 420, overflow: 'auto', border: '1px solid var(--border)', borderRadius: 'var(--r-sm)', padding: 6 }}>
                {rama(undefined, 0)}
              </div>
              <p className="hint">Marcar una familia sincroniza también los productos que Microsoft agregue después dentro de ella.</p>
            </>
          ) : (
            data.classifications.map((c) => (
              <Opt key={c.id} label={c.title} hint={c.description} disabled={!w} checked={classes.has(c.id)} onChange={(v) => setClasses((cur) => toggle(cur, c.id, v))} />
            ))
          )}
        </>
      )}
    </Modal>
  )
}

/* ------------------------------ Programación ------------------------------ */

function ScheduleDialog({ server, overview, onClose, onDone }: { server: WsusServerConfig; overview: WsusOverview; onClose: () => void; onDone: () => void }): JSX.Element {
  const s = overview.subscription
  const local = new Date(Date.UTC(2000, 0, 1, 0, 0, s.timeOfDay))
  const [auto, setAuto] = useState(s.synchronizeAutomatically)
  const [hora, setHora] = useState(`${String(local.getHours()).padStart(2, '0')}:${String(local.getMinutes()).padStart(2, '0')}`)
  const [perDay, setPerDay] = useState(s.perDay)
  const [saving, save] = useSave(server, onDone)
  const w = server.allowWrites

  const guardar = (): void => {
    const [h, m] = hora.split(':').map(Number)
    const d = new Date(2000, 0, 1, h || 0, m || 0)
    // Se guarda en UTC, como lo hace la consola de Windows.
    const secs = d.getUTCHours() * 3600 + d.getUTCMinutes() * 60
    void save(() => window.adeep.wsus.setSchedule(server.id, { synchronizeAutomatically: auto, timeOfDay: secs, perDay }), 'programación guardada')
  }

  return (
    <Modal title="Programación de la sincronización" icon={<Clock size={18} color="var(--accent)" />} onClose={onClose}
      footer={<Footer w={w} saving={saving} onClose={onClose} onSave={guardar} />}>
      <ReadOnlyNote w={w} />
      <label className="check" style={{ display: 'flex' }}><input type="radio" checked={!auto} disabled={!w} onChange={() => setAuto(false)} /><span>Sincronizar manualmente</span></label>
      <label className="check" style={{ display: 'flex' }}><input type="radio" checked={auto} disabled={!w} onChange={() => setAuto(true)} /><span>Sincronizar automáticamente</span></label>
      {auto && (
        <div className="row" style={{ gap: 12, paddingLeft: 24 }}>
          <Field label="Primera del día (hora local)"><input type="time" value={hora} disabled={!w} onChange={(e) => setHora(e.target.value)} /></Field>
          <Field label="Por día">
            <select value={perDay} disabled={!w} onChange={(e) => setPerDay(Number(e.target.value))}>
              {Array.from({ length: 24 }, (_, i) => i + 1).map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </Field>
        </div>
      )}
      <p className="hint">Microsoft agrega una demora aleatoria de hasta 30 minutos a la hora elegida.</p>
    </Modal>
  )
}

/* ------------------------------ Archivos e idiomas ------------------------------ */

function FilesDialog({ server, overview, onClose, onDone }: { server: WsusServerConfig; overview: WsusOverview; onClose: () => void; onDone: () => void }): JSX.Element {
  const c = overview.config
  const [local, setLocal] = useState(c.storeLocally)
  const [lazy, setLazy] = useState(c.downloadOnlyApproved)
  const [express, setExpress] = useState(c.expressPackages)
  const [saving, save] = useSave(server, onDone)
  const w = server.allowWrites
  return (
    <Modal title="Archivos e idiomas" icon={<HardDrive size={18} color="var(--accent)" />} onClose={onClose}
      footer={<Footer w={w} saving={saving} onClose={onClose} onSave={() => void save(() => window.adeep.wsus.setConfiguration(server.id, { storeLocally: local, downloadOnlyApproved: lazy, expressPackages: express }), 'opciones de archivos guardadas')} />}>
      <ReadOnlyNote w={w} />
      <label className="check" style={{ display: 'flex' }}><input type="radio" checked={local} disabled={!w} onChange={() => setLocal(true)} /><span>Guardar los archivos en este servidor <span className="mono hint">{c.contentPath}</span></span></label>
      {local && (
        <div style={{ paddingLeft: 24 }}>
          <Opt label="Descargar los archivos sólo cuando se aprueba la actualización" checked={lazy} disabled={!w} onChange={setLazy} />
          <Opt label="Descargar paquetes de instalación exprés" hint="Descargas más chicas para los equipos, mucho más espacio en el servidor." checked={express} disabled={!w} onChange={setExpress} />
        </div>
      )}
      <label className="check" style={{ display: 'flex' }}><input type="radio" checked={!local} disabled={!w} onChange={() => setLocal(false)} /><span>No guardar archivos: los equipos los bajan de Microsoft Update</span></label>
      <div style={{ marginTop: 10, paddingTop: 12, borderTop: '1px solid var(--border)' }}>
        <div className="kv">
          <span className="k">Idiomas</span>
          <span className="v">{c.allLanguages ? 'Todos' : c.languages.join(', ') || '—'}</span>
        </div>
        <p className="hint">Los idiomas se ven pero no se cambian desde acá: el protocolo los maneja por identificador interno y un error deja de bajar actualizaciones.</p>
      </div>
    </Modal>
  )
}

/* ------------------------------ Equipos ------------------------------ */

function TargetingDialog({ server, overview, onClose, onDone }: { server: WsusServerConfig; overview: WsusOverview; onClose: () => void; onDone: () => void }): JSX.Element {
  const c = overview.config
  const [target, setTarget] = useState(c.serverTargeting)
  const [days, setDays] = useState(String(c.computerDeletionDays))
  const [saving, save] = useSave(server, onDone)
  const w = server.allowWrites
  return (
    <Modal title="Equipos" icon={<Monitor size={18} color="var(--accent)" />} onClose={onClose}
      footer={<Footer w={w} saving={saving} onClose={onClose} onSave={() => void save(() => window.adeep.wsus.setConfiguration(server.id, { serverTargeting: target, computerDeletionDays: Number(days) || 30 }), 'opciones de equipos guardadas')} />}>
      <ReadOnlyNote w={w} />
      <label className="check" style={{ display: 'flex' }}><input type="radio" checked={target} disabled={!w} onChange={() => setTarget(true)} /><span>Asignar los equipos a grupos desde la consola</span></label>
      <label className="check" style={{ display: 'flex' }}><input type="radio" checked={!target} disabled={!w} onChange={() => setTarget(false)} /><span>Usar la directiva de grupo o el registro de cada equipo</span></label>
      <p className="hint">Con directiva, cada equipo pide su grupo en «Habilitar la asignación del lado del cliente» y los cambios de la consola se pierden en su próxima detección.</p>
      <Text label="Días sin contacto para considerar obsoleto un equipo (limpieza)" value={days} onChange={setDays} disabled={!w} style={{ width: 300 }} />
    </Modal>
  )
}

/* ------------------------------ Aprobaciones automáticas ------------------------------ */

function RulesDialog({ server, groups, onClose, onChanged }: { server: WsusServerConfig; groups: WsusGroup[]; onClose: () => void; onChanged: () => void }): JSX.Element {
  const [rules, setRules] = useState<WsusApprovalRule[] | null>(null)
  const [cats, setCats] = useState<WsusProductsAndClassifications | null>(null)
  const [edit, setEdit] = useState<WsusApprovalRule | null>(null)
  const confirm = useConfirm()
  const toast = useApp((s) => s.toast)
  const w = server.allowWrites

  const cargar = (): void => { void window.adeep.wsus.approvalRules(server.id).then((r) => setRules(report(r) ?? [])) }
  useEffect(() => {
    cargar()
    void window.adeep.wsus.products(server.id).then((r) => setCats(report(r) ?? null))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [server.id])

  const nombreClase = (id: string): string => cats?.classifications.find((c) => c.id === id)?.title ?? id
  const nombreProd = (id: string): string => cats?.products.find((c) => c.id === id)?.title ?? id
  const nombreGrupo = (id: string): string => { const g = groups.find((x) => x.id === id); return g ? groupLabel(g) : id }

  const toggle = async (r: WsusApprovalRule): Promise<void> => {
    const res = await window.adeep.wsus.saveApprovalRule(server.id, { ...r, enabled: !r.enabled })
    if (report(res, `Regla «${r.name}» ${r.enabled ? 'deshabilitada' : 'habilitada'}`)) cargar()
  }
  const borrar = async (r: WsusApprovalRule): Promise<void> => {
    if (!await confirm({ title: 'Borrar la regla', message: r.name, detail: 'Las aprobaciones que ya hizo quedan.', confirmLabel: 'Borrar', danger: true })) return
    if (report(await window.adeep.wsus.deleteApprovalRule(server.id, r.id), 'Regla borrada') !== undefined) cargar()
  }
  const ejecutar = async (r: WsusApprovalRule): Promise<void> => {
    if (!await confirm({
      title: 'Ejecutar la regla ahora',
      message: `Se aplican las aprobaciones de «${r.name}» a todas las actualizaciones que ya están en el servidor, no sólo a las nuevas.`,
      confirmLabel: 'Ejecutar', danger: true
    })) return
    const res = await window.adeep.wsus.runApprovalRule(server.id, r.id)
    const n = report(res)
    if (n !== undefined) { toast('ok', `La regla aprobó ${n} actualización(es)`); onChanged() }
  }

  return (
    <Modal title="Aprobaciones automáticas" icon={<ListChecks size={18} color="var(--accent)" />} size="xwide" onClose={onClose}
      footer={
        <>
          <button className="btn" disabled={!w || !cats} title={w ? undefined : STATE_WRITE_HINT}
            onClick={() => setEdit({ id: 0, name: '', enabled: true, action: 0, classificationIds: [], categoryIds: [], groupIds: [] })}>
            <Plus size={14} /> Nueva regla
          </button>
          <div className="spacer" style={{ flex: 1 }} />
          <button className="btn primary" onClick={onClose}>Cerrar</button>
        </>
      }>
      <ReadOnlyNote w={w} />
      {!rules ? <Spinner /> : !rules.length ? <div className="hint">No hay reglas.</div> : (
        <div className="mini-table-wrap">
          <table className="mini" style={{ tableLayout: 'fixed', width: '100%' }}>
            <thead><tr><th style={{ width: 60 }}>Activa</th><th style={{ width: '28%' }}>Regla</th><th>Aprueba</th><th style={{ width: '20%' }}>Para</th><th style={{ width: 150 }} /></tr></thead>
            <tbody>
              {rules.map((r) => (
                <tr key={r.id}>
                  <td><input type="checkbox" checked={r.enabled} disabled={!w} onChange={() => void toggle(r)} /></td>
                  <td style={{ whiteSpace: 'normal' }}><strong>{r.name}</strong>{r.deadlineDays ? <div className="hint">Fecha límite: {r.deadlineDays} día(s) después de aprobar</div> : null}</td>
                  <td style={{ whiteSpace: 'normal' }}>
                    {r.classificationIds.map(nombreClase).join(', ') || 'cualquier clasificación'}
                    <div className="hint">{r.categoryIds.length ? r.categoryIds.map(nombreProd).join(', ') : 'cualquier producto'}</div>
                  </td>
                  <td style={{ whiteSpace: 'normal' }}>{r.groupIds.map(nombreGrupo).join(', ') || '—'}</td>
                  <td>
                    <div className="row" style={{ gap: 4 }}>
                      <button className="btn sm ghost" disabled={!w || !cats} onClick={() => setEdit(r)}>Editar</button>
                      <button className="btn sm ghost" disabled={!w} title="Ejecutar ahora" onClick={() => void ejecutar(r)}><Play size={13} /></button>
                      <button className="btn sm ghost" disabled={!w} title="Borrar" onClick={() => void borrar(r)}><Trash2 size={13} /></button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {edit && cats && (
        <RuleEditor
          server={server} rule={edit} cats={cats} groups={groups}
          onClose={() => setEdit(null)}
          onSaved={() => { setEdit(null); cargar() }}
        />
      )}
    </Modal>
  )
}

function RuleEditor({ server, rule, cats, groups, onClose, onSaved }: {
  server: WsusServerConfig
  rule: WsusApprovalRule
  cats: WsusProductsAndClassifications
  groups: WsusGroup[]
  onClose: () => void
  onSaved: () => void
}): JSX.Element {
  const [r, setR] = useState(rule)
  const [saving, setSaving] = useState(false)
  const toggleIn = (k: 'classificationIds' | 'categoryIds' | 'groupIds', id: string, v: boolean): void =>
    setR((cur) => ({ ...cur, [k]: v ? [...cur[k], id] : cur[k].filter((x) => x !== id) }))
  // Sólo los productos que el servidor sincroniza tienen sentido en una regla.
  const productos = cats.products.filter((p) => cats.selectedProducts.includes(p.id))

  const guardar = async (): Promise<void> => {
    setSaving(true)
    const res = await window.adeep.wsus.saveApprovalRule(server.id, r)
    setSaving(false)
    if (report(res, `Regla «${r.name}» guardada`)) onSaved()
  }
  return (
    <Modal title={rule.id ? `Editar «${rule.name}»` : 'Nueva regla de aprobación'} icon={<ListChecks size={18} color="var(--accent)" />} size="wide" tall onClose={onClose}
      footer={<Footer w saving={saving} onClose={onClose} onSave={() => void guardar()} />}>
      <Text label="Nombre" value={r.name} onChange={(v) => setR({ ...r, name: v })} autoFocus />
      <Opt label="Regla habilitada" checked={r.enabled} onChange={(v) => setR({ ...r, enabled: v })} />
      <div className="row" style={{ gap: 16, alignItems: 'flex-start', marginTop: 8 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="lbl" style={{ fontWeight: 600, marginBottom: 4 }}>Clasificaciones</div>
          {cats.classifications.map((c) => <Opt key={c.id} label={c.title} checked={r.classificationIds.includes(c.id)} onChange={(v) => toggleIn('classificationIds', c.id, v)} />)}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="lbl" style={{ fontWeight: 600, marginBottom: 4 }}>Productos <span className="hint">(ninguno = todos)</span></div>
          {productos.map((c) => <Opt key={c.id} label={c.title} checked={r.categoryIds.includes(c.id)} onChange={(v) => toggleIn('categoryIds', c.id, v)} />)}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="lbl" style={{ fontWeight: 600, marginBottom: 4 }}>Grupos</div>
          {flattenGroups(groups).map(({ g, depth }) => (
            <div key={g.id} style={{ paddingLeft: depth * 14 }}>
              <Opt label={groupLabel(g)} checked={r.groupIds.includes(g.id)} onChange={(v) => toggleIn('groupIds', g.id, v)} />
            </div>
          ))}
        </div>
      </div>
    </Modal>
  )
}

/* ------------------------------ Limpieza ------------------------------ */

function CleanupDialog({ server, onClose, onDone }: { server: WsusServerConfig; onClose: () => void; onDone: () => void }): JSX.Element {
  const [preview, setPreview] = useState<{ obsoleteUpdates: number; updatesToCompress: number; staleComputers: number; computerDays: number } | null>(null)
  const [o, setO] = useState({
    declineSuperseded: true, declineExpired: true, deleteObsoleteUpdates: true,
    compressUpdates: true, deleteObsoleteComputers: false, deleteUnneededFiles: true
  })
  const [running, setRunning] = useState(false)
  const [result, setResult] = useState<string[] | null>(null)
  const confirm = useConfirm()
  const w = server.allowWrites

  useEffect(() => { void window.adeep.wsus.cleanupPreview(server.id).then((r) => setPreview(report(r) ?? null)) }, [server.id])

  const ejecutar = async (): Promise<void> => {
    const ok = await confirm({
      title: 'Ejecutar la limpieza',
      message: 'Rechaza y borra del servidor lo marcado. Lo rechazado se puede volver a aprobar; lo borrado vuelve sólo con otra sincronización.',
      detail: 'En una base grande puede tardar varios minutos. La consola de Windows hace lo mismo.',
      confirmLabel: 'Ejecutar', danger: true
    })
    if (!ok) return
    setRunning(true)
    const r = await window.adeep.wsus.cleanup(server.id, o)
    setRunning(false)
    const d = report(r)
    if (!d) return
    setResult([
      d.supersededDeclined !== undefined ? `Reemplazadas rechazadas: ${d.supersededDeclined}` : '',
      d.expiredDeclined !== undefined ? `Vencidas rechazadas: ${d.expiredDeclined}` : '',
      d.obsoleteUpdatesDeleted !== undefined ? `Actualizaciones obsoletas borradas: ${d.obsoleteUpdatesDeleted}` : '',
      d.updatesCompressed !== undefined ? `Revisiones comprimidas: ${d.updatesCompressed}` : '',
      d.computersDeleted !== undefined ? `Equipos borrados: ${d.computersDeleted}` : '',
      d.bytesFreed !== undefined ? `Espacio liberado: ${fmtBytes(d.bytesFreed)}` : '',
      ...d.errors.map((e) => `Error — ${e}`)
    ].filter(Boolean))
  }

  const p = preview
  return (
    <Modal title="Asistente de limpieza del servidor" icon={<Eraser size={18} color="var(--accent)" />} size="wide" onClose={result ? onDone : onClose}
      footer={result
        ? <><div className="spacer" style={{ flex: 1 }} /><button className="btn primary" onClick={onDone}>Cerrar</button></>
        : <Footer w={w} saving={running} onClose={onClose} onSave={() => void ejecutar()} label={running ? 'Limpiando…' : 'Ejecutar'} />}>
      <ReadOnlyNote w={w} />
      {result ? (
        <ul style={{ margin: 0, paddingLeft: 18, lineHeight: 1.7 }}>{result.map((l) => <li key={l}>{l}</li>)}</ul>
      ) : (
        <>
          <Opt label="Rechazar las actualizaciones reemplazadas" hint="Las que reemplazó otra aprobada y no necesita ningún equipo desde hace 30 días." checked={o.declineSuperseded} disabled={!w} onChange={(v) => setO({ ...o, declineSuperseded: v })} />
          <Opt label="Rechazar las actualizaciones vencidas" hint="Las que Microsoft retiró del catálogo." checked={o.declineExpired} disabled={!w} onChange={(v) => setO({ ...o, declineExpired: v })} />
          <Opt label="Borrar actualizaciones obsoletas" hint={p ? `${p.obsoleteUpdates} sin aprobar ni usar` : ''} checked={o.deleteObsoleteUpdates} disabled={!w} onChange={(v) => setO({ ...o, deleteObsoleteUpdates: v })} />
          <Opt label="Comprimir revisiones viejas" hint={p ? `${p.updatesToCompress} con revisiones anteriores` : ''} checked={o.compressUpdates} disabled={!w} onChange={(v) => setO({ ...o, compressUpdates: v })} />
          <Opt label="Borrar equipos que no se conectan" hint={p ? `${p.staleComputers} sin contacto hace más de ${p.computerDays} días` : ''} checked={o.deleteObsoleteComputers} disabled={!w} onChange={(v) => setO({ ...o, deleteObsoleteComputers: v })} />
          <Opt label="Borrar archivos de actualizaciones que ya no hacen falta" checked={o.deleteUnneededFiles} disabled={!w} onChange={(v) => setO({ ...o, deleteUnneededFiles: v })} />
          {running && <div className="row" style={{ gap: 8, marginTop: 10 }}><Spinner /> <span className="hint">Limpiando: no cierres la consola.</span></div>}
        </>
      )}
    </Modal>
  )
}

/* ------------------------------ Correo ------------------------------ */

function EmailDialog({ server, onClose, onDone }: { server: WsusServerConfig; onClose: () => void; onDone: () => void }): JSX.Element {
  const [e, setE] = useState<WsusEmailConfig | null>(null)
  const [hora, setHora] = useState('08:00')
  const [saving, save] = useSave(server, onDone)
  const w = server.allowWrites
  useEffect(() => {
    void window.adeep.wsus.emailConfig(server.id).then((r) => {
      const d = report(r)
      if (!d) return
      setE(d)
      const t = new Date(Date.UTC(2000, 0, 1, 0, 0, d.statusTimeOfDay))
      setHora(`${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}`)
    })
  }, [server.id])
  if (!e) return <Modal title="Notificaciones por correo" onClose={onClose}><Spinner /></Modal>

  const conHora = (): WsusEmailConfig => {
    const [h, m] = hora.split(':').map(Number)
    const d = new Date(2000, 0, 1, h || 0, m || 0)
    return { ...e, statusTimeOfDay: d.getUTCHours() * 3600 + d.getUTCMinutes() * 60 }
  }
  const set = <K extends keyof WsusEmailConfig>(k: K, v: WsusEmailConfig[K]): void => setE({ ...e, [k]: v })
  const probar = async (): Promise<void> => {
    report(await window.adeep.wsus.sendTestEmail(server.id, conHora()), 'Correo de prueba enviado')
  }

  return (
    <Modal title="Notificaciones por correo" icon={<Mail size={18} color="var(--accent)" />} size="wide" onClose={onClose}
      footer={
        <>
          <button className="btn" disabled={!w || !e.smtpHost} onClick={() => void probar()}>Enviar prueba</button>
          <Footer w={w} saving={saving} onClose={onClose} onSave={() => void save(() => window.adeep.wsus.setEmailConfig(server.id, conHora()), 'notificaciones guardadas')} />
        </>
      }>
      <ReadOnlyNote w={w} />
      <Opt label="Avisar cuando la sincronización trae actualizaciones nuevas" checked={e.sendSyncNotification} disabled={!w} onChange={(v) => set('sendSyncNotification', v)} />
      {e.sendSyncNotification && <Text label="Destinatarios (separados por coma)" value={e.syncRecipients} disabled={!w} onChange={(v) => set('syncRecipients', v)} />}
      <Opt label="Mandar un resumen de estado" checked={e.sendStatusNotification} disabled={!w} onChange={(v) => set('sendStatusNotification', v)} />
      {e.sendStatusNotification && (
        <>
          <div className="row" style={{ gap: 12 }}>
            <Field label="Frecuencia">
              <select value={e.statusFrequency} disabled={!w} onChange={(ev) => set('statusFrequency', ev.target.value as 'Daily' | 'Weekly')}>
                <option value="Daily">Diario</option>
                <option value="Weekly">Semanal</option>
              </select>
            </Field>
            <Field label="Hora"><input type="time" value={hora} disabled={!w} onChange={(ev) => setHora(ev.target.value)} /></Field>
          </div>
          <Text label="Destinatarios (separados por coma)" value={e.statusRecipients} disabled={!w} onChange={(v) => set('statusRecipients', v)} />
        </>
      )}
      <div style={{ marginTop: 10, paddingTop: 12, borderTop: '1px solid var(--border)' }}>
        <div className="row" style={{ gap: 12 }}>
          <Text label="Servidor SMTP" value={e.smtpHost} disabled={!w} onChange={(v) => set('smtpHost', v)} style={{ flex: 1 }} />
          <Text label="Puerto" value={String(e.smtpPort)} disabled={!w} onChange={(v) => set('smtpPort', Number(v) || 25)} style={{ width: 90 }} />
        </div>
        <div className="row" style={{ gap: 12 }}>
          <Text label="Nombre del remitente" value={e.senderName} disabled={!w} onChange={(v) => set('senderName', v)} style={{ flex: 1 }} />
          <Text label="Dirección del remitente" value={e.senderAddress} disabled={!w} onChange={(v) => set('senderAddress', v)} style={{ flex: 1 }} />
        </div>
        <div className="row" style={{ gap: 12 }}>
          <Field label="Idioma de los correos" style={{ width: 220 }}>
            <select value={e.language} disabled={!w} onChange={(ev) => set('language', ev.target.value)}>
              <option value="en">Inglés</option>
              <option value="es">Español</option>
            </select>
          </Field>
        </div>
        <Opt label="El servidor SMTP requiere autenticación" hint="La contraseña SMTP se carga desde la consola de Windows." checked={e.smtpRequiresAuth} disabled={!w} onChange={(v) => set('smtpRequiresAuth', v)} />
        {e.smtpRequiresAuth && <Text label="Usuario SMTP" value={e.smtpUser} disabled={!w} onChange={(v) => set('smtpUser', v)} />}
      </div>
    </Modal>
  )
}
