import { useCallback, useMemo, useState, type JSX } from 'react'
import {
  Globe, Plus, Trash2, Server, FileText, ArrowRightLeft, Settings2, Search,
  ShieldAlert, ShieldCheck, Waypoints
} from 'lucide-react'
import type {
  DnsIssue, DnsNode, DnsRecordView, DnsReview, DnsZone, DnsZoneDetails, SessionInfo
} from '@shared/types'
import ConsoleShell from '../../shell/ConsoleShell'
import SimpleTree, { type TreeItem } from '../../shell/SimpleTree'
import DetailList from '../../shell/DetailList'
import FindingList, { type Finding } from '../../shell/FindingList'
import { Modal, Field, Text, MenuPopup, useConfirm, type MenuItemDef } from '../../components/ui'
import { report } from '../../store'

const SEV_COLOR = { alta: 'var(--danger)', media: 'var(--warn)', baja: 'var(--text-dim)' } as const
const SEV_BG = { alta: 'var(--danger-soft)', media: 'var(--warn-soft)', baja: 'var(--bg-sunken)' } as const

/** Etiqueta de la política de actualizaciones, con el peso de seguridad al frente. */
function UpdateBadge({ value }: { value?: number }): JSX.Element {
  if (value === 1) return <span className="badge danger">no seguras</span>
  if (value === 2) return <span className="badge ok">sólo seguras</span>
  if (value === 0) return <span className="badge neutral">ninguna</span>
  return <span className="hint">—</span>
}

/** Tipos que se pueden crear desde la consola, con sus campos. */
const TIPOS: { type: number; label: string; fields: { key: string; label: string; hint?: string; numeric?: boolean }[] }[] = [
  { type: 1, label: 'A — Host IPv4', fields: [{ key: 'address', label: 'Dirección IP', hint: '10.20.0.15' }] },
  { type: 28, label: 'AAAA — Host IPv6', fields: [{ key: 'address', label: 'Dirección IPv6', hint: '2001:db8::15' }] },
  { type: 5, label: 'CNAME — Alias', fields: [{ key: 'host', label: 'Destino', hint: 'servidor.dominio.com' }] },
  { type: 12, label: 'PTR — Puntero inverso', fields: [{ key: 'host', label: 'Nombre', hint: 'servidor.dominio.com' }] },
  { type: 15, label: 'MX — Servidor de correo', fields: [
    { key: 'preference', label: 'Preferencia', numeric: true, hint: '10' },
    { key: 'exchange', label: 'Servidor', hint: 'mail.dominio.com' }
  ] },
  { type: 16, label: 'TXT — Texto', fields: [{ key: 'text', label: 'Texto', hint: 'v=spf1 mx -all' }] },
  { type: 2, label: 'NS — Servidor de nombres', fields: [{ key: 'host', label: 'Servidor', hint: 'dns1.dominio.com' }] },
  { type: 33, label: 'SRV — Servicio', fields: [
    { key: 'priority', label: 'Prioridad', numeric: true, hint: '0' },
    { key: 'weight', label: 'Peso', numeric: true, hint: '100' },
    { key: 'port', label: 'Puerto', numeric: true, hint: '443' },
    { key: 'target', label: 'Destino', hint: 'servidor.dominio.com' }
  ] }
]

interface Fila {
  key: string
  node: DnsNode
  record: DnsRecordView
}

export default function DnsConsole(): JSX.Element {
  const confirm = useConfirm()

  const [zones, setZones] = useState<DnsZone[]>([])
  const [servers, setServers] = useState<string[]>([])
  const [nodes, setNodes] = useState<DnsNode[]>([])
  const [details, setDetails] = useState<DnsZoneDetails | null>(null)
  const [zona, setZona] = useState<DnsZone | null>(null)
  const [loading, setLoading] = useState(false)
  const [filtro, setFiltro] = useState('')
  const [selected, setSelected] = useState<string>()
  const [ctx, setCtx] = useState<{ items: MenuItemDef[]; x: number; y: number } | null>(null)
  const [review, setReview] = useState<DnsReview | null>(null)
  const [vista, setVista] = useState<'zonas' | 'revision'>('zonas')
  const [dialog, setDialog] = useState<
    | null
    | { t: 'nuevo'; zone: DnsZone; tipo: number }
    | { t: 'editar'; fila: Fila }
    | { t: 'zona' }
    | { t: 'nuevaZona' }
  >(null)

  const cargarZonas = useCallback(async (): Promise<void> => {
    setLoading(true)
    const [z, s, r] = await Promise.all([
      window.adeep.dns.zones(),
      window.adeep.dns.servers(),
      window.adeep.dns.review()
    ])
    setLoading(false)
    if (report(z) !== undefined) setZones(z.data ?? [])
    if (s.ok) setServers(s.data ?? [])
    if (r.ok) setReview(r.data ?? null)
  }, [])

  /**
   * Tras escribir hay que recargar las zonas además de los registros: el árbol y
   * la lista muestran la cantidad de nombres, que si no queda vieja.
   */
  const recargarTodo = useCallback(async (z: DnsZone): Promise<void> => {
    const [zs, n, d] = await Promise.all([
      window.adeep.dns.zones(),
      window.adeep.dns.nodes(z.dn),
      window.adeep.dns.zoneDetails(z.dn)
    ])
    if (zs.ok) {
      const lista = zs.data ?? []
      setZones(lista)
      // La zona seleccionada también trae contadores nuevos.
      const actual = lista.find((x) => x.dn === z.dn)
      if (actual) setZona(actual)
    }
    if (report(n) !== undefined) setNodes(n.data ?? [])
    setDetails(d.ok ? d.data ?? null : null)
  }, [])

  const abrirZona = useCallback(async (z: DnsZone): Promise<void> => {
    setZona(z)
    setVista('zonas')
    setSelected(undefined)
    setLoading(true)
    const [n, d] = await Promise.all([
      window.adeep.dns.nodes(z.dn),
      window.adeep.dns.zoneDetails(z.dn)
    ])
    setLoading(false)
    if (report(n) !== undefined) setNodes(n.data ?? [])
    setDetails(d.ok ? d.data ?? null : null)
  }, [])

  const refrescar = useCallback((): void => {
    void cargarZonas()
    if (zona) void abrirZona(zona)
  }, [cargarZonas, abrirZona, zona])

  const onSession = useCallback((_i: SessionInfo) => { void cargarZonas() }, [cargarZonas])

  const tree = useMemo<TreeItem[]>(() => {
    const directas = zones.filter((z) => !z.reverse)
    const inversas = zones.filter((z) => z.reverse)
    const item = (z: DnsZone): TreeItem => ({
      id: z.dn, label: z.name, kind: z.reverse ? 'dnsReverseZone' : 'dnsZone', badge: String(z.records)
    })
    const graves = review?.issues.filter((i) => i.severity === 'alta').length ?? 0
    return [
      {
        id: 'servidor',
        label: servers[0] ?? 'DNS',
        kind: 'server',
        children: [
          { id: 'directas', label: 'Zonas de búsqueda directa', kind: 'dnsRoot', badge: String(directas.length), children: directas.map(item) },
          { id: 'inversas', label: 'Zonas de búsqueda inversa', kind: 'dnsRoot', badge: String(inversas.length), children: inversas.map(item) },
          {
            id: 'revision',
            label: 'Revisión de seguridad',
            kind: 'hvCheck',
            badge: review ? `${review.issues.length}${graves ? ` · ${graves}!` : ''}` : undefined
          }
        ]
      }
    ]
  }, [zones, servers, review])

  const filas = useMemo<Fila[]>(() => {
    const q = filtro.trim().toLowerCase()
    const out: Fila[] = []
    for (const n of nodes) {
      for (const r of n.records) {
        if (q && !n.name.toLowerCase().includes(q) && !r.data.toLowerCase().includes(q) && !r.typeName.toLowerCase().includes(q)) continue
        out.push({ key: `${n.dn}|${r.raw}`, node: n, record: r })
      }
    }
    return out
  }, [nodes, filtro])

  const borrarRegistro = async (fila: Fila): Promise<void> => {
    const ok = await confirm({
      title: 'Eliminar registro',
      message: `¿Eliminar el registro ${fila.record.typeName} de "${fila.node.name}"?`,
      detail: `${fila.node.fqdn}\n${fila.record.data}`,
      danger: true,
      confirmLabel: 'Eliminar'
    })
    if (!ok) return
    const res = await window.adeep.dns.deleteRecord(fila.node.dn, fila.record.raw)
    if (report(res, 'Registro eliminado') !== undefined && zona) await recargarTodo(zona)
  }

  const menuFila = (fila: Fila): MenuItemDef[] => [
    { id: 'edit', label: 'Editar…', icon: <Settings2 size={15} />, onSelect: () => setDialog({ t: 'editar', fila }) },
    { id: 's1', separator: true },
    { id: 'del', label: 'Eliminar', icon: <Trash2 size={15} />, danger: true, onSelect: () => void borrarRegistro(fila) }
  ]

  const nuevoMenu = (): MenuItemDef[] =>
    TIPOS.map((t) => ({
      id: `t${t.type}`,
      label: t.label,
      disabled: !zona,
      onSelect: () => zona && setDialog({ t: 'nuevo', zone: zona, tipo: t.type })
    }))

  const borrarZona = async (z: DnsZone): Promise<void> => {
    const ok = await confirm({
      title: 'Eliminar la zona entera',
      message: `Se va a borrar «${z.name}» con sus ${z.records} nombre(s).`,
      detail:
        'Todo lo que resolvía en esa zona deja de resolver. Si es una zona en uso, se cae lo que ' +
        'dependa de esos nombres hasta que la restaures desde una copia. No hay deshacer.',
      confirmLabel: 'Eliminar la zona',
      danger: true
    })
    if (!ok) return
    const res = await window.adeep.dns.deleteZone(z.dn)
    if (report(res, `Zona ${z.name} eliminada`) !== undefined) {
      setZona(null)
      setNodes([])
      await cargarZonas()
    }
  }

  const menuZona = (z: DnsZone): MenuItemDef[] => [
    { id: 'abrir', label: 'Abrir', icon: <Globe size={15} />, onSelect: () => void abrirZona(z) },
    { id: 's1', separator: true },
    { id: 'del', label: 'Eliminar zona…', icon: <Trash2 size={15} />, danger: true, onSelect: () => void borrarZona(z) }
  ]

  /**
   * Corrige los root hints de una copia: direcciones vigentes y servidores que
   * falten. No borra nada de lo que ya esté.
   */
  const corregirRootHints = async (scopeLabel: string): Promise<void> => {
    const rh = review?.rootHints.find((x) => x.scopeLabel === scopeLabel)
    if (!rh) return
    const viejos = rh.servers.filter((x) => x.stale)
    const ok = await confirm({
      title: 'Corregir los root hints',
      message: `Se van a actualizar los servidores raíz de «${rh.scopeLabel}».`,
      detail:
        (viejos.length ? `Direcciones a corregir: ${viejos.map((v) => v.name.split('.')[0]).join(', ')}.\n` : '') +
        (rh.missing.length ? `Servidores a agregar: ${rh.missing.map((m) => m.split('.')[0]).join(', ')}.\n` : '') +
        '\nNo se borra nada de lo que ya esté. Los root hints sólo se usan si el servidor resuelve ' +
        'por su cuenta hasta la raíz; si tenés reenviadores globales, este cambio no altera nada. ' +
        'Contrastá la lista con https://www.internic.net/domain/named.root si querés verificarla.',
      confirmLabel: 'Corregir'
    })
    if (!ok) return
    const res = await window.adeep.dns.fixRootHints(rh.dn)
    const data = report(res)
    if (data) {
      report({ ok: true }, `Root hints: ${data.cambios.length} cambio(s)`)
      await cargarZonas()
    }
  }

  const accionPara = (i: DnsIssue): Finding['action'] => {
    if (i.id.startsWith('roothints:')) {
      const rh = review?.rootHints.find((x) => `Root hints (${x.scopeLabel})` === i.zone)
      if (!rh) return undefined
      return { label: 'Corregir los root hints', run: () => void corregirRootHints(rh.scopeLabel) }
    }
    if (zones.some((z) => z.name === i.zone)) {
      return {
        label: `Abrir propiedades de ${i.zone}`,
        run: () => {
          const z = zones.find((x) => x.name === i.zone)
          if (z) { void abrirZona(z); setDialog({ t: 'zona' }) }
        }
      }
    }
    return undefined
  }

  const revisionPane = (
    <>
      <div className="list-head">
        <div className="crumbs"><span className="crumb last">Revisión de seguridad del DNS</span></div>
      </div>
      <div style={{ padding: 16, overflow: 'auto' }}>
        <p className="hint" style={{ margin: '0 0 14px', maxWidth: 860, lineHeight: 1.55 }}>
          Sólo sobre lo que DNS guarda en el directorio. Las transferencias de zona, los
          reenviadores globales y la lista de bloqueo de consultas globales son configuración del
          servicio DNS, no del objeto de Active Directory: desde acá no se ven, y esta revisión no
          dice nada sobre ellas.
        </p>

        <FindingList
          vacio={
            review
              ? `Nada para observar en ${review.zonesChecked} zona(s) y ${review.recordsChecked} registro(s).`
              : 'Todavía no se corrió la revisión.'
          }
          findings={(review?.issues ?? []).map((i: DnsIssue): Finding => ({
            id: i.id,
            severity: i.severity,
            subject: `${i.zone}${i.record ? ` · ${i.record}` : ''}`,
            label: i.label,
            detail: i.detail,
            action: accionPara(i)
          }))}
        />
      </div>
    </>
  )

  const main = vista === 'revision' ? revisionPane : zona ? (
    <>
      <div className="list-head">
        <div className="crumbs">
          <span className="crumb">{zona.reverse ? 'Búsqueda inversa' : 'Búsqueda directa'}</span>
          <span className="sepr">›</span>
          <span className="crumb last">{zona.name}</span>
        </div>
        <div className="spacer" style={{ flex: 1 }} />
        <div className="search" style={{ width: 220, margin: 0 }}>
          <Search size={14} />
          <input type="search" placeholder="Filtrar registros…" value={filtro} onChange={(e) => setFiltro(e.target.value)} />
        </div>
      </div>
      <DetailList
        rows={filas}
        rowKey={(f) => f.key}
        rowKind={() => 'dnsRecord'}
        selectedKey={selected}
        onSelect={(f) => setSelected(f.key)}
        onOpen={(f) => setDialog({ t: 'editar', fila: f })}
        onContextMenu={(f, x, y) => { setSelected(f.key); setCtx({ items: menuFila(f), x, y }) }}
        empty="La zona no tiene registros"
        columns={[
          { id: 'name', label: 'Nombre', width: '30%', render: (f) => f.node.name, sortValue: (f) => f.node.name },
          { id: 'type', label: 'Tipo', width: 110, render: (f) => f.record.typeName, sortValue: (f) => f.record.typeName },
          { id: 'data', label: 'Datos', render: (f) => <span className="mono">{f.record.data}</span>, sortValue: (f) => f.record.data },
          { id: 'ttl', label: 'TTL', width: 110, render: (f) => `${f.record.ttl} s`, sortValue: (f) => f.record.ttl },
          {
            id: 'static', label: 'Origen', width: 120,
            render: (f) => (f.record.static ? 'Estático' : <span className="badge neutral">Dinámico</span>),
            sortValue: (f) => (f.record.static ? 0 : 1)
          }
        ]}
      />
    </>
  ) : (
    <DetailList
      rows={zones}
      rowKey={(z) => z.dn}
      rowKind={(z) => (z.reverse ? 'dnsReverseZone' : 'dnsZone')}
      onOpen={(z) => void abrirZona(z)}
      onContextMenu={(z, x, y) => setCtx({ items: menuZona(z), x, y })}
      empty="No hay zonas DNS integradas en el directorio"
      columns={[
        { id: 'name', label: 'Zona', width: '26%', render: (z) => z.name, sortValue: (z) => z.name },
        {
          id: 'kind', label: 'Tipo', width: 150,
          render: (z) => z.zoneTypeLabel ?? (z.reverse ? 'Búsqueda inversa' : 'Búsqueda directa')
        },
        { id: 'scope', label: 'Replicación', width: '24%', render: (z) => z.scopeLabel },
        {
          id: 'upd', label: 'Actualizaciones dinámicas', width: 190,
          render: (z) => <UpdateBadge value={z.allowUpdate} />,
          sortValue: (z) => z.allowUpdate ?? 9
        },
        {
          id: 'aging', label: 'Envejece', width: 100,
          render: (z) => (z.aging ? 'Sí' : <span className="hint">No</span>)
        },
        { id: 'records', label: 'Nombres', width: 100, render: (z) => z.records, sortValue: (z) => z.records }
      ]}
    />
  )

  return (
    <>
      <ConsoleShell
        title="ADeep — DNS"
        icon={<Globe size={17} />}
        treeTitle="DNS"
        loading={loading}
        onRefresh={refrescar}
        onSession={onSession}
        menus={{
          Acción: [
            {
              id: 'nuevo', label: 'Nuevo registro', icon: <Plus size={15} />,
              disabled: !zona, title: undefined, submenu: nuevoMenu()
            },
            { id: 's1', separator: true },
            {
              id: 'zona', label: 'Propiedades de la zona…', icon: <Settings2 size={15} />,
              disabled: !zona, onSelect: () => setDialog({ t: 'zona' })
            },
            {
              id: 'todas', label: 'Ver todas las zonas', icon: <ArrowRightLeft size={15} />,
              onSelect: () => { setVista('zonas'); setZona(null); setNodes([]); setDetails(null) }
            },
            { id: 's2', separator: true },
            {
              id: 'nuevaZona', label: 'Nueva zona…', icon: <Waypoints size={15} />,
              onSelect: () => setDialog({ t: 'nuevaZona' })
            },
            {
              id: 'borrarZona', label: 'Eliminar esta zona…', icon: <Trash2 size={15} />,
              danger: true, disabled: !zona, onSelect: () => zona && void borrarZona(zona)
            },
            { id: 's3', separator: true },
            {
              id: 'revision', label: 'Revisión de seguridad', icon: <ShieldAlert size={15} />,
              onSelect: () => { setVista('revision'); setZona(null); setNodes([]) }
            }
          ]
        }}
        toolbar={
          <>
            <button className="tool" title="Nuevo registro" disabled={!zona} onClick={(e) => {
              const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
              setCtx({ items: nuevoMenu(), x: r.left, y: r.bottom + 4 })
            }}>
              <Plus size={16} />
            </button>
            <span className="hint" style={{ paddingLeft: 8 }}>
              <Server size={13} style={{ verticalAlign: -2 }} /> {servers.length} servidor(es) DNS
            </span>
          </>
        }
        tree={
          <SimpleTree
            items={tree}
            selectedId={vista === 'revision' ? 'revision' : zona?.dn}
            defaultExpanded={['servidor', 'directas', 'inversas']}
            onSelect={(item) => {
              const z = zones.find((x) => x.dn === item.id)
              if (z) void abrirZona(z)
              else if (item.id === 'revision') { setVista('revision'); setZona(null); setNodes([]) }
              else if (item.id === 'servidor') { setVista('zonas'); setZona(null); setNodes([]) }
            }}
          />
        }
        main={main}
        status={
          <>
            <span className="seg">
              {zona
                ? `${filas.length} registro(s) en ${zona.name}${details?.aging ? ' · envejecimiento activo' : ''}`
                : `${zones.length} zona(s)`}
            </span>
            {review && (
              <span className={`seg ${review.issues.some((i) => i.severity === 'alta') ? 'err' : ''}`}>
                {review.issues.length
                  ? `${review.issues.length} observación(es) de seguridad` +
                    `${review.issues.filter((i) => i.severity === 'alta').length ? `, ${review.issues.filter((i) => i.severity === 'alta').length} grave(s)` : ''}`
                  : 'Sin observaciones de seguridad'}
              </span>
            )}
          </>
        }
      />

      {ctx && <MenuPopup items={ctx.items} x={ctx.x} y={ctx.y} onClose={() => setCtx(null)} />}

      {dialog?.t === 'nuevo' && (
        <RecordDialog
          titulo="Nuevo registro"
          zona={dialog.zone}
          tipo={dialog.tipo}
          onClose={() => setDialog(null)}
          onGuardar={async (nodeName, input) => {
            const res = await window.adeep.dns.addRecord(dialog.zone.dn, nodeName, input)
            if (report(res, 'Registro creado') !== undefined) {
              setDialog(null)
              await recargarTodo(dialog.zone)
            }
          }}
        />
      )}

      {dialog?.t === 'editar' && zona && (
        <RecordDialog
          titulo={`Editar registro ${dialog.fila.record.typeName}`}
          zona={zona}
          tipo={dialog.fila.record.type}
          nombreInicial={dialog.fila.node.name}
          valoresIniciales={dialog.fila.record.fields}
          ttlInicial={dialog.fila.record.ttl}
          nombreFijo
          onClose={() => setDialog(null)}
          onGuardar={async (_nodeName, input) => {
            const res = await window.adeep.dns.replaceRecord(
              dialog.fila.node.dn, dialog.fila.record.raw, input
            )
            if (report(res, 'Registro actualizado') !== undefined) {
              setDialog(null)
              await recargarTodo(zona)
            }
          }}
        />
      )}

      {dialog?.t === 'zona' && zona && (
        <ZoneDialog
          zona={zona}
          detalles={details}
          onClose={() => setDialog(null)}
          onCambio={() => { setDialog(null); void cargarZonas(); void abrirZona(zona) }}
        />
      )}

      {dialog?.t === 'nuevaZona' && (
        <NewZoneDialog
          onClose={() => setDialog(null)}
          onCreada={() => { setDialog(null); void cargarZonas() }}
        />
      )}

    </>
  )
}

function RecordDialog({
  titulo, zona, tipo, nombreInicial, valoresIniciales, ttlInicial, nombreFijo, onClose, onGuardar
}: {
  titulo: string
  zona: DnsZone
  tipo: number
  nombreInicial?: string
  valoresIniciales?: Record<string, string | number>
  ttlInicial?: number
  nombreFijo?: boolean
  onClose: () => void
  onGuardar: (nodeName: string, input: { type: number; ttl: number; fields: Record<string, string | number> }) => Promise<void>
}): JSX.Element {
  const def = TIPOS.find((t) => t.type === tipo) ?? TIPOS[0]
  const [nombre, setNombre] = useState(nombreInicial ?? '')
  const [ttl, setTtl] = useState(ttlInicial ?? 3600)
  const [valores, setValores] = useState<Record<string, string>>(() => {
    const out: Record<string, string> = {}
    for (const f of def.fields) out[f.key] = String(valoresIniciales?.[f.key] ?? '')
    return out
  })
  const [busy, setBusy] = useState(false)

  const completo = def.fields.every((f) => valores[f.key]?.trim()) && (nombreFijo || nombre.trim())

  const guardar = async (): Promise<void> => {
    setBusy(true)
    const fields: Record<string, string | number> = {}
    for (const f of def.fields) fields[f.key] = f.numeric ? Number(valores[f.key]) : valores[f.key].trim()
    await onGuardar(nombre.trim() || '@', { type: tipo, ttl, fields })
    setBusy(false)
  }

  return (
    <Modal
      title={titulo}
      subtitle={`${def.label} · zona ${zona.name}`}
      icon={<FileText size={18} color="var(--accent)" />}
      onClose={onClose}
      footer={
        <>
          <div className="spacer" style={{ flex: 1 }} />
          <button className="btn" onClick={onClose}>Cancelar</button>
          <button className="btn primary" disabled={!completo || busy} onClick={() => void guardar()}>Guardar</button>
        </>
      }
    >
      <div className="col" style={{ gap: 10 }}>
        <Text
          label="Nombre"
          value={nombre}
          onChange={setNombre}
          disabled={nombreFijo}
          hint={nombre ? `${nombre}.${zona.name}` : `Vacío = la zona misma (${zona.name})`}
          autoFocus={!nombreFijo}
        />
        {def.fields.map((f) => (
          <Text
            key={f.key}
            label={f.label}
            value={valores[f.key] ?? ''}
            onChange={(v) => setValores((cur) => ({ ...cur, [f.key]: v }))}
            placeholder={f.hint}
            autoFocus={nombreFijo && f === def.fields[0]}
          />
        ))}
        <Field label="TTL (segundos)">
          <input type="number" min={0} value={ttl} onChange={(e) => setTtl(Number(e.target.value) || 0)} />
        </Field>
        <div className="hint">
          El registro se crea estático. Los servidores DNS releen la zona de Active Directory en
          su próximo ciclo de carga, así que el cambio puede tardar en verse.
        </div>
      </div>
    </Modal>
  )
}

function ZoneDialog({
  zona, detalles, onClose, onCambio
}: {
  zona: DnsZone
  detalles: DnsZoneDetails | null
  onClose: () => void
  onCambio: () => void
}): JSX.Element {
  const confirm = useConfirm()
  const [busy, setBusy] = useState(false)
  const actual = detalles?.allowUpdate ?? zona.allowUpdate

  /**
   * Cambiar a «no seguras» es abrir la zona a cualquiera de la red, así que va
   * con confirmación escrita. Cerrarla no necesita ceremonia: sólo saber a quién
   * puede romperle el registro automático.
   */
  const cambiar = async (value: 0 | 1 | 2): Promise<void> => {
    if (value === actual) return
    const abriendo = value === 1
    const ok = await confirm({
      title: abriendo ? 'Abrir la zona a actualizaciones NO seguras' : 'Cambiar las actualizaciones dinámicas',
      message: abriendo
        ? `Cualquier equipo que llegue al DNS va a poder crear o pisar registros de ${zona.name} sin autenticarse.`
        : `${zona.name} pasa a «${value === 2 ? 'sólo actualizaciones seguras' : 'sin actualizaciones dinámicas'}».`,
      detail: abriendo
        ? 'Es el camino directo para secuestrar un nombre del dominio y quedar en el medio del ' +
          'tráfico. Sólo tiene sentido en una zona que no resuelve nada sensible y con clientes que ' +
          'no se pueden autenticar.'
        : value === 0
          ? 'Los equipos dejan de poder registrarse solos: a partir de ahora los registros los creás ' +
            'a mano. Un equipo que cambie de IP va a quedar resolviendo mal hasta que lo corrijas.'
          : 'Sólo el dueño de cada registro va a poder modificarlo. Es la opción recomendada. Los ' +
            'clientes que no estén unidos al dominio dejan de poder registrarse solos.',
      confirmLabel: abriendo ? 'Abrir igual' : 'Cambiar',
      danger: abriendo
    })
    if (!ok) return
    setBusy(true)
    const res = await window.adeep.dns.setZoneUpdates(zona.dn, value)
    setBusy(false)
    if (report(res, 'Actualizaciones dinámicas cambiadas') !== undefined) onCambio()
  }

  const OPCIONES: { value: 0 | 1 | 2; label: string; hint: string }[] = [
    { value: 2, label: 'Sólo actualizaciones seguras', hint: 'Recomendado: cada equipo sólo puede tocar su propio registro.' },
    { value: 0, label: 'No permitidas', hint: 'Todos los registros se administran a mano.' },
    { value: 1, label: 'Permitidas: seguras y NO seguras', hint: 'Cualquiera de la red puede crear o pisar cualquier registro.' }
  ]

  return (
    <Modal
      title={zona.name}
      subtitle={`${zona.zoneTypeLabel ?? (zona.reverse ? 'Zona de búsqueda inversa' : 'Zona de búsqueda directa')} · ${zona.scopeLabel}`}
      icon={<Globe size={18} color="var(--accent)" />}
      size="wide"
      onClose={onClose}
      footer={
        <>
          <div className="spacer" style={{ flex: 1 }} />
          <button className="btn primary" onClick={onClose}>Cerrar</button>
        </>
      }
    >
      <div
        className="row"
        style={{
          gap: 10, alignItems: 'flex-start', padding: 12, marginBottom: 14,
          borderRadius: 'var(--r-sm)',
          background: actual === 1 ? 'var(--danger-soft)' : 'var(--bg-sunken)'
        }}
      >
        {actual === 1 ? <ShieldAlert size={18} color="var(--danger)" /> : <ShieldCheck size={18} color="var(--ok)" />}
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 8 }}>
            Actualizaciones dinámicas
          </div>
          <div className="col" style={{ gap: 6 }}>
            {OPCIONES.map((o) => (
              <label key={o.value} className="check" style={{ alignItems: 'flex-start' }}>
                <input
                  type="radio"
                  name="allowUpdate"
                  checked={actual === o.value}
                  disabled={busy}
                  onChange={() => void cambiar(o.value)}
                />
                <span>
                  {o.label}
                  <div className="hint">{o.hint}</div>
                </span>
              </label>
            ))}
          </div>
        </div>
      </div>

      <div className="kv">
        <span className="k">Replicación</span>
        <span className="v">{zona.scopeLabel}</span>
        <span className="k">Tipo de zona</span>
        <span className="v">{detalles?.zoneTypeLabel ?? zona.zoneTypeLabel ?? '—'}</span>
        <span className="k">Nombres</span>
        <span className="v">{zona.records}</span>
        <span className="k">Envejecimiento</span>
        <span className="v">{detalles?.aging ? 'Activado' : 'Desactivado'}</span>
        {detalles?.noRefresh !== undefined && (
          <>
            <span className="k">Intervalo sin actualización</span>
            <span className="v">{detalles.noRefresh} h</span>
          </>
        )}
        {detalles?.refresh !== undefined && (
          <>
            <span className="k">Intervalo de actualización</span>
            <span className="v">{detalles.refresh} h</span>
          </>
        )}
        {!!detalles?.masterServers.length && (
          <>
            <span className="k">Servidores maestros</span>
            <span className="v mono">{detalles.masterServers.join(', ')}</span>
          </>
        )}
        {!!detalles?.scavengingServers.length && (
          <>
            <span className="k">Servidores de limpieza</span>
            <span className="v mono">{detalles.scavengingServers.join(', ')}</span>
          </>
        )}
        <span className="k">Servidor principal (SOA)</span>
        <span className="v">{String(detalles?.soa?.fields.primary ?? '—')}</span>
        <span className="k">Responsable</span>
        <span className="v">{String(detalles?.soa?.fields.admin ?? '—')}</span>
        <span className="k">Número de serie</span>
        <span className="v mono">{String(detalles?.soa?.fields.serial ?? '—')}</span>
        <span className="k">Servidores de nombres</span>
        <span className="v">{detalles?.ns.map((n) => n.data).join(', ') || '—'}</span>
        <span className="k">DN</span>
        <span className="v mono">{zona.dn}</span>
      </div>

      <div className="hint" style={{ marginTop: 14, lineHeight: 1.5 }}>
        Las transferencias de zona y los reenviadores globales no están en Active Directory: son
        configuración del servicio DNS y se ven en la consola del servidor, no acá.
      </div>
    </Modal>
  )
}

/** Alta de zona. Sólo principales integradas en el directorio: es lo que da LDAP. */
function NewZoneDialog({
  onClose, onCreada
}: {
  onClose: () => void
  onCreada: () => void
}): JSX.Element {
  const [nombre, setNombre] = useState('')
  const [scope, setScope] = useState<'domain' | 'forest' | 'legacy'>('domain')
  const [busy, setBusy] = useState(false)

  const limpio = nombre.trim().toLowerCase().replace(/\.$/, '')
  const valido = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(limpio)

  const crear = async (): Promise<void> => {
    setBusy(true)
    const res = await window.adeep.dns.createZone(limpio, scope)
    setBusy(false)
    if (report(res, `Zona ${limpio} creada`) !== undefined) onCreada()
  }

  return (
    <Modal
      title="Nueva zona"
      subtitle="Zona principal integrada en Active Directory"
      icon={<Globe size={18} color="var(--accent)" />}
      onClose={onClose}
      footer={
        <>
          <div className="spacer" style={{ flex: 1 }} />
          <button className="btn" onClick={onClose}>Cancelar</button>
          <button className="btn primary" disabled={!valido || busy} onClick={() => void crear()}>
            Crear
          </button>
        </>
      }
    >
      <div className="col" style={{ gap: 10 }}>
        <Text
          label="Nombre de la zona"
          value={nombre}
          onChange={setNombre}
          placeholder="ejemplo.local — o 0.168.192.in-addr.arpa para una inversa"
          autoFocus
        />
        <Field label="Replicación">
          <select value={scope} onChange={(e) => setScope(e.target.value as typeof scope)}>
            <option value="domain">Todos los servidores DNS del dominio</option>
            <option value="forest">Todos los servidores DNS del bosque</option>
            <option value="legacy">Controladores de dominio (heredado)</option>
          </select>
        </Field>
        <div
          className="row"
          style={{
            gap: 10, alignItems: 'flex-start', padding: 12,
            borderRadius: 'var(--r-sm)', background: 'var(--bg-sunken)'
          }}
        >
          <ShieldCheck size={17} color="var(--ok)" />
          <div className="hint" style={{ lineHeight: 1.5 }}>
            La zona se crea <strong>sin actualizaciones dinámicas</strong>. Si necesitás que los
            equipos se registren solos, activá «sólo actualizaciones seguras» en las propiedades;
            nunca las no seguras salvo que sepas exactamente por qué.
          </div>
        </div>
        {nombre.trim() && !valido && (
          <div className="hint" style={{ color: 'var(--danger)' }}>
            El nombre tiene que ser un dominio válido con al menos un punto.
          </div>
        )}
      </div>
    </Modal>
  )
}
