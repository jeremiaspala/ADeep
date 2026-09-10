import { useCallback, useMemo, useState, type JSX } from 'react'
import {
  Globe, Plus, Trash2, Server, FileText, ArrowRightLeft, Settings2, Search
} from 'lucide-react'
import type { DnsNode, DnsRecordView, DnsZone, DnsZoneDetails, SessionInfo } from '@shared/types'
import ConsoleShell from '../../shell/ConsoleShell'
import SimpleTree, { type TreeItem } from '../../shell/SimpleTree'
import DetailList from '../../shell/DetailList'
import { Modal, Field, Text, MenuPopup, useConfirm, type MenuItemDef } from '../../components/ui'
import { report } from '../../store'

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
  const [dialog, setDialog] = useState<
    | null
    | { t: 'nuevo'; zone: DnsZone; tipo: number }
    | { t: 'editar'; fila: Fila }
    | { t: 'zona' }
  >(null)

  const cargarZonas = useCallback(async (): Promise<void> => {
    setLoading(true)
    const [z, s] = await Promise.all([window.adeep.dns.zones(), window.adeep.dns.servers()])
    setLoading(false)
    if (report(z) !== undefined) setZones(z.data ?? [])
    if (s.ok) setServers(s.data ?? [])
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
    return [
      {
        id: 'servidor',
        label: servers[0] ?? 'DNS',
        kind: 'server',
        children: [
          { id: 'directas', label: 'Zonas de búsqueda directa', kind: 'dnsRoot', badge: String(directas.length), children: directas.map(item) },
          { id: 'inversas', label: 'Zonas de búsqueda inversa', kind: 'dnsRoot', badge: String(inversas.length), children: inversas.map(item) }
        ]
      }
    ]
  }, [zones, servers])

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

  const main = zona ? (
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
      empty="No hay zonas DNS integradas en el directorio"
      columns={[
        { id: 'name', label: 'Zona', width: '30%', render: (z) => z.name, sortValue: (z) => z.name },
        { id: 'kind', label: 'Tipo', width: 150, render: (z) => (z.reverse ? 'Búsqueda inversa' : 'Búsqueda directa') },
        { id: 'scope', label: 'Replicación', width: '30%', render: (z) => z.scopeLabel },
        { id: 'records', label: 'Nombres', width: 110, render: (z) => z.records, sortValue: (z) => z.records }
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
              onSelect: () => { setZona(null); setNodes([]); setDetails(null) }
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
            selectedId={zona?.dn}
            defaultExpanded={['servidor', 'directas', 'inversas']}
            onSelect={(item) => {
              const z = zones.find((x) => x.dn === item.id)
              if (z) void abrirZona(z)
              else if (item.id === 'servidor') { setZona(null); setNodes([]) }
            }}
          />
        }
        main={main}
        status={
          <span className="seg">
            {zona
              ? `${filas.length} registro(s) en ${zona.name}${details?.aging ? ' · envejecimiento activo' : ''}`
              : `${zones.length} zona(s)`}
          </span>
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
        <ZoneDialog zona={zona} detalles={details} onClose={() => setDialog(null)} />
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
  zona, detalles, onClose
}: {
  zona: DnsZone
  detalles: DnsZoneDetails | null
  onClose: () => void
}): JSX.Element {
  return (
    <Modal
      title={zona.name}
      subtitle={zona.reverse ? 'Zona de búsqueda inversa' : 'Zona de búsqueda directa'}
      icon={<Globe size={18} color="var(--accent)" />}
      onClose={onClose}
      footer={
        <>
          <div className="spacer" style={{ flex: 1 }} />
          <button className="btn primary" onClick={onClose}>Cerrar</button>
        </>
      }
    >
      <div className="kv">
        <span className="k">Replicación</span>
        <span className="v">{zona.scopeLabel}</span>
        <span className="k">Nombres</span>
        <span className="v">{zona.records}</span>
        <span className="k">Actualizaciones dinámicas</span>
        <span className="v">{detalles?.updates ?? '—'}</span>
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
    </Modal>
  )
}
