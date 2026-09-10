import { useCallback, useEffect, useMemo, useState, type JSX } from 'react'
import { Database, Search, Copy, Trash2, Settings2, Plus, FolderTree } from 'lucide-react'
import type { LdapBrowserNode, LdapContext, SessionInfo } from '@shared/types'
import ConsoleShell from '../../shell/ConsoleShell'
import DetailList from '../../shell/DetailList'
import { Modal, Field, Text, MenuPopup, useConfirm, type MenuItemDef } from '../../components/ui'
import AttributeEditor from '../../components/AttributeEditor'
import SecurityTab from '../../components/SecurityTab'
import { Tabs, Spinner } from '../../components/ui'
import { report } from '../../store'
import { KindIcon } from '../../lib/icons'
import { copyText } from '../../lib/objectActions'
import { rdnValue } from '../../lib/format'

interface Rama {
  dn: string
  label: string
  kind: LdapBrowserNode['kind']
  hijos?: Rama[]
  abierta: boolean
  cargando: boolean
}

export default function LdapConsole(): JSX.Element {
  const confirm = useConfirm()

  const [arbol, setArbol] = useState<Rama[]>([])
  const [seleccion, setSeleccion] = useState<string>()
  const [hijos, setHijos] = useState<LdapBrowserNode[]>([])
  const [loading, setLoading] = useState(false)
  const [filtro, setFiltro] = useState('')
  const [ctx, setCtx] = useState<{ items: MenuItemDef[]; x: number; y: number } | null>(null)
  const [dialog, setDialog] = useState<null | { t: 'props'; dn: string } | { t: 'nuevo'; parentDN: string }>(null)

  const cargarContextos = useCallback(async (): Promise<void> => {
    setLoading(true)
    const res = await window.adeep.ldapb.contexts()
    setLoading(false)
    const data = report(res)
    if (!data) return
    setArbol(data.map((c: LdapContext) => ({
      dn: c.dn, label: c.label, kind: 'container' as const, abierta: false, cargando: false
    })))
    if (data[0]) await abrir(data[0].dn)
  }, [])

  const abrir = useCallback(async (dn: string): Promise<void> => {
    setSeleccion(dn)
    setLoading(true)
    const res = await window.adeep.ldapb.children(dn)
    setLoading(false)
    const data = report(res)
    if (data) setHijos(data)
  }, [])

  const expandir = useCallback(async (dn: string): Promise<void> => {
    const res = await window.adeep.ldapb.children(dn)
    const data = res.ok ? res.data ?? [] : []
    setArbol((cur) => patch(cur, dn, (r) => ({
      ...r,
      abierta: true,
      cargando: false,
      hijos: data.map((h) => ({
        dn: h.dn, label: h.name, kind: h.kind, abierta: false, cargando: false
      }))
    })))
  }, [])

  /**
   * Después de crear o borrar hay que refrescar la lista **y** la rama del árbol:
   * si no, el objeto nuevo no aparece hasta reiniciar la consola.
   */
  const refrescarNodo = useCallback(async (dn: string): Promise<void> => {
    await abrir(dn)
    const rama = buscar(arbol, dn)
    if (rama?.abierta) await expandir(dn)
  }, [abrir, expandir, arbol])

  const onSession = useCallback((_i: SessionInfo) => { void cargarContextos() }, [cargarContextos])

  const filas = useMemo(() => {
    const q = filtro.trim().toLowerCase()
    if (!q) return hijos
    return hijos.filter((h) =>
      h.name.toLowerCase().includes(q) ||
      h.objectClass.toLowerCase().includes(q) ||
      h.dn.toLowerCase().includes(q)
    )
  }, [hijos, filtro])

  const menuObjeto = (n: LdapBrowserNode): MenuItemDef[] => [
    { id: 'open', label: 'Explorar', icon: <FolderTree size={15} />, onSelect: () => void abrir(n.dn) },
    { id: 'props', label: 'Propiedades…', icon: <Settings2 size={15} />, onSelect: () => setDialog({ t: 'props', dn: n.dn }) },
    { id: 's1', separator: true },
    { id: 'copy', label: 'Copiar DN', icon: <Copy size={15} />, onSelect: () => void copyText(n.dn, 'DN copiado') },
    { id: 's2', separator: true },
    {
      id: 'del', label: 'Eliminar', icon: <Trash2 size={15} />, danger: true,
      onSelect: () => void (async () => {
        const ok = await confirm({
          title: 'Eliminar objeto',
          message: `¿Eliminar "${n.name}"?`,
          detail: `${n.dn}\n\nEs un borrado directo en el directorio, sin las validaciones de la consola de usuarios.`,
          danger: true,
          confirmLabel: 'Eliminar'
        })
        if (!ok) return
        const res = await window.adeep.obj.delete([n.dn], false)
        if (report(res, 'Objeto eliminado') !== undefined && seleccion) await refrescarNodo(seleccion)
      })()
    }
  ]

  const render = (ramas: Rama[], nivel: number): JSX.Element[] =>
    ramas.flatMap((r) => {
      const fila = (
        <div
          key={r.dn}
          className={`tree-row ${r.dn === seleccion ? 'sel' : ''}`}
          style={{ paddingLeft: 6 + nivel * 15 }}
          onClick={() => { void abrir(r.dn); if (!r.abierta) void expandir(r.dn) }}
          title={r.dn}
        >
          <span
            className={`twisty ${r.abierta ? 'open' : ''}`}
            onClick={(e) => {
              e.stopPropagation()
              if (r.abierta) setArbol((cur) => patch(cur, r.dn, (x) => ({ ...x, abierta: false })))
              else void expandir(r.dn)
            }}
          >
            {r.cargando ? <Spinner size={12} /> : '›'}
          </span>
          <KindIcon kind={r.kind} />
          <span className="tree-label">{r.label}</span>
        </div>
      )
      return r.abierta && r.hijos ? [fila, ...render(r.hijos, nivel + 1)] : [fila]
    })

  return (
    <>
      <ConsoleShell
        title="ADeep — Editor LDAP"
        icon={<Database size={17} />}
        treeTitle="Contextos de nombres"
        loading={loading}
        onRefresh={() => { void cargarContextos(); if (seleccion) void abrir(seleccion) }}
        onSession={onSession}
        menus={{
          Acción: [
            {
              id: 'nuevo', label: 'Nuevo objeto…', icon: <Plus size={15} />,
              disabled: !seleccion, onSelect: () => seleccion && setDialog({ t: 'nuevo', parentDN: seleccion })
            },
            { id: 's1', separator: true },
            {
              id: 'props', label: 'Propiedades del contenedor…', icon: <Settings2 size={15} />,
              disabled: !seleccion, onSelect: () => seleccion && setDialog({ t: 'props', dn: seleccion })
            },
            {
              id: 'copy', label: 'Copiar DN del contenedor', icon: <Copy size={15} />,
              disabled: !seleccion, onSelect: () => seleccion && void copyText(seleccion, 'DN copiado')
            }
          ]
        }}
        toolbar={
          <span className="hint" style={{ paddingLeft: 4 }}>
            Acceso crudo al directorio: acá no hay red de contención.
          </span>
        }
        tree={<>{render(arbol, 0)}</>}
        main={
          <>
            <div className="list-head">
              <div className="crumbs">
                <span className="crumb last mono" title={seleccion}>{seleccion ?? '—'}</span>
              </div>
              <div className="spacer" style={{ flex: 1 }} />
              <div className="search" style={{ width: 220 }}>
                <Search size={14} />
                <input type="search" placeholder="Filtrar…" value={filtro} onChange={(e) => setFiltro(e.target.value)} />
              </div>
            </div>
            <DetailList
              rows={filas}
              rowKey={(n) => n.dn}
              rowKind={(n) => n.kind}
              onOpen={(n) => void abrir(n.dn)}
              onContextMenu={(n, x, y) => setCtx({ items: menuObjeto(n), x, y })}
              empty="El contenedor no tiene objetos"
              columns={[
                { id: 'name', label: 'Nombre', width: '28%', render: (n) => n.name, sortValue: (n) => n.name },
                { id: 'class', label: 'Clase', width: 200, render: (n) => n.objectClass, sortValue: (n) => n.objectClass },
                { id: 'dn', label: 'Nombre distintivo', render: (n) => <span className="mono">{n.dn}</span> }
              ]}
            />
          </>
        }
        status={<span className="seg">{filas.length} objeto(s)</span>}
      />

      {ctx && <MenuPopup items={ctx.items} x={ctx.x} y={ctx.y} onClose={() => setCtx(null)} />}

      {dialog?.t === 'props' && (
        <ObjetoDialog dn={dialog.dn} onClose={() => setDialog(null)} onChanged={() => seleccion && void refrescarNodo(seleccion)} />
      )}

      {dialog?.t === 'nuevo' && (
        <NuevoObjetoDialog
          parentDN={dialog.parentDN}
          onClose={() => setDialog(null)}
          onCreated={() => { setDialog(null); if (seleccion) void refrescarNodo(seleccion) }}
        />
      )}
    </>
  )
}

function ObjetoDialog({
  dn, onClose, onChanged
}: {
  dn: string
  onClose: () => void
  onChanged: () => void
}): JSX.Element {
  const [tab, setTab] = useState('attrs')
  return (
    <Modal
      title={rdnValue(dn)}
      subtitle={dn}
      icon={<Database size={18} color="var(--accent)" />}
      size="xwide"
      tall
      bodyFlush
      onClose={onClose}
      footer={
        <>
          <div className="spacer" style={{ flex: 1 }} />
          <button className="btn primary" onClick={onClose}>Cerrar</button>
        </>
      }
    >
      <Tabs
        tabs={[{ id: 'attrs', label: 'Atributos' }, { id: 'sec', label: 'Seguridad' }]}
        active={tab}
        onChange={setTab}
      />
      <div style={{ overflow: 'auto', minHeight: 0, flex: 1 }}>
        {tab === 'attrs' && <AttributeEditor dn={dn} onChanged={onChanged} />}
        {tab === 'sec' && <SecurityTab dn={dn} onDirty={() => undefined} />}
      </div>
    </Modal>
  )
}

function NuevoObjetoDialog({
  parentDN, onClose, onCreated
}: {
  parentDN: string
  onClose: () => void
  onCreated: () => void
}): JSX.Element {
  const [clases, setClases] = useState<string[]>([])
  const [clase, setClase] = useState('')
  const [rdnAttr, setRdnAttr] = useState('cn')
  const [nombre, setNombre] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    void (async () => {
      const res = await window.adeep.ldapb.allowedClasses(parentDN)
      if (res.ok && res.data?.length) {
        setClases(res.data)
        setClase(res.data.includes('container') ? 'container' : res.data[0])
      }
    })()
  }, [parentDN])

  const crear = async (): Promise<void> => {
    setBusy(true)
    const res = await window.adeep.ldapb.create(parentDN, rdnAttr, nombre.trim(), clase)
    setBusy(false)
    if (report(res, 'Objeto creado') !== undefined) onCreated()
  }

  return (
    <Modal
      title="Nuevo objeto"
      subtitle={parentDN}
      icon={<Plus size={18} color="var(--accent)" />}
      onClose={onClose}
      footer={
        <>
          <div className="spacer" style={{ flex: 1 }} />
          <button className="btn" onClick={onClose}>Cancelar</button>
          <button className="btn primary" disabled={!clase || !nombre.trim() || busy} onClick={() => void crear()}>
            Crear
          </button>
        </>
      }
    >
      <div className="col" style={{ gap: 10 }}>
        <Field label="Clase" hint={clases.length ? `${clases.length} clases admitidas bajo este contenedor` : 'Leyendo el esquema…'}>
          <select value={clase} onChange={(e) => setClase(e.target.value)}>
            {clases.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </Field>
        <div className="grid-2">
          <Field label="Atributo del RDN">
            <select value={rdnAttr} onChange={(e) => setRdnAttr(e.target.value)}>
              <option value="cn">cn</option>
              <option value="ou">ou</option>
              <option value="dc">dc</option>
            </select>
          </Field>
          <Text label="Nombre" value={nombre} onChange={setNombre} autoFocus />
        </div>
        <div className="hint">
          Se crea con los atributos mínimos. Si la clase exige alguno más, el directorio va a
          rechazarlo y hay que completarlo desde el editor de atributos.
        </div>
      </div>
    </Modal>
  )
}

function buscar(ramas: Rama[], dn: string): Rama | undefined {
  for (const r of ramas) {
    if (r.dn === dn) return r
    const encontrada = r.hijos && buscar(r.hijos, dn)
    if (encontrada) return encontrada
  }
  return undefined
}

function patch(ramas: Rama[], dn: string, fn: (r: Rama) => Rama): Rama[] {
  return ramas.map((r) =>
    r.dn === dn ? fn(r) : r.hijos ? { ...r, hijos: patch(r.hijos, dn, fn) } : r
  )
}
