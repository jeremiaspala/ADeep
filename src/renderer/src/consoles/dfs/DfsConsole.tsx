import { useCallback, useMemo, useState, type JSX } from 'react'
import {
  Share2, FolderSymlink, RefreshCcw, CalendarClock, AlertTriangle, Plus, Trash2, Settings2
} from 'lucide-react'
import type {
  DfsFolder, DfsNamespace, DfsTarget, DfsrGroup, SessionInfo
} from '@shared/types'
import ConsoleShell from '../../shell/ConsoleShell'
import SimpleTree, { type TreeItem } from '../../shell/SimpleTree'
import DetailList from '../../shell/DetailList'
import ScheduleEditor from '../../shell/ScheduleEditor'
import { Modal, Field, Text, Check2, MenuPopup, useConfirm, type MenuItemDef } from '../../components/ui'
import { useApp, report } from '../../store'

type Selection =
  | { kind: 'namespaces' }
  | { kind: 'namespace'; ns: DfsNamespace }
  | { kind: 'folder'; ns: DfsNamespace; folder: DfsFolder }
  | { kind: 'groups' }
  | { kind: 'group'; group: DfsrGroup }

export default function DfsConsole(): JSX.Element {
  const toast = useApp((s) => s.toast)
  const confirm = useConfirm()

  const [namespaces, setNamespaces] = useState<DfsNamespace[]>([])
  const [groups, setGroups] = useState<DfsrGroup[]>([])
  const [loading, setLoading] = useState(false)
  const [selection, setSelection] = useState<Selection>({ kind: 'namespaces' })
  const [selectedId, setSelectedId] = useState('namespaces')
  const [ctx, setCtx] = useState<{ items: MenuItemDef[]; x: number; y: number } | null>(null)
  const [dialog, setDialog] = useState<
    | null
    | { t: 'folder'; ns: DfsNamespace; folder: DfsFolder }
    | { t: 'schedule'; title: string; initial?: boolean[]; save: (s: boolean[] | null) => void }
  >(null)

  const load = useCallback(async (): Promise<void> => {
    setLoading(true)
    const [ns, rg] = await Promise.all([
      window.adeep.dfs.namespaces(),
      window.adeep.dfs.replicationGroups()
    ])
    setLoading(false)
    if (report(ns) !== undefined) setNamespaces(ns.data ?? [])
    if (rg.ok) setGroups(rg.data ?? [])
  }, [])

  const onSession = useCallback((_info: SessionInfo) => { void load() }, [load])

  const tree = useMemo<TreeItem[]>(() => [
    {
      id: 'namespaces',
      label: 'Espacios de nombres',
      kind: 'dfsRoot',
      badge: String(namespaces.length),
      children: namespaces.map((ns) => ({
        id: ns.dn,
        label: ns.name,
        kind: 'dfsNamespace' as const,
        badge: `v${ns.version}`,
        children: ns.folders.map((f) => ({
          id: `${ns.dn}::${f.path}`,
          label: f.path,
          kind: 'dfsFolder' as const,
          badge: `${f.targets.length}`
        }))
      }))
    },
    {
      id: 'groups',
      label: 'Replicación DFS',
      kind: 'dfsrRoot',
      badge: String(groups.length),
      children: groups.map((g) => ({
        id: g.dn,
        label: g.name,
        kind: 'dfsrGroup' as const,
        badge: g.isSysvol ? 'SYSVOL' : `${g.members.length}`
      }))
    }
  ], [namespaces, groups])

  const onSelect = (item: TreeItem): void => {
    setSelectedId(item.id)
    if (item.id === 'namespaces') return setSelection({ kind: 'namespaces' })
    if (item.id === 'groups') return setSelection({ kind: 'groups' })

    const ns = namespaces.find((n) => n.dn === item.id)
    if (ns) return setSelection({ kind: 'namespace', ns })

    const group = groups.find((g) => g.dn === item.id)
    if (group) return setSelection({ kind: 'group', group })

    if (item.id.includes('::')) {
      const [dn, path] = item.id.split('::')
      const parent = namespaces.find((n) => n.dn === dn)
      const folder = parent?.folders.find((f) => f.path === path)
      if (parent && folder) return setSelection({ kind: 'folder', ns: parent, folder })
    }
  }

  const folderMenu = (ns: DfsNamespace, folder: DfsFolder): MenuItemDef[] => [
    {
      id: 'props', label: 'Propiedades…', icon: <Settings2 size={15} />,
      disabled: ns.version === 1,
      title: ns.version === 1 ? undefined : undefined,
      onSelect: () => setDialog({ t: 'folder', ns, folder })
    },
    { id: 's1', separator: true },
    {
      id: 'del', label: 'Eliminar la carpeta', icon: <Trash2 size={15} />, danger: true,
      disabled: ns.version === 1,
      onSelect: () => void (async () => {
        if (!folder.dn) return
        const ok = await confirm({
          title: 'Eliminar carpeta DFS',
          message: `¿Eliminar "${folder.path}" del espacio de nombres ${ns.name}?`,
          danger: true,
          confirmLabel: 'Eliminar'
        })
        if (!ok) return
        const res = await window.adeep.dfs.deleteFolder(folder.dn)
        if (report(res, 'Carpeta eliminada') !== undefined) await load()
      })()
    }
  ]

  const v1Warning = (ns: DfsNamespace): JSX.Element | null =>
    ns.version === 1 ? (
      <div
        className="row"
        style={{ gap: 8, padding: '10px 12px', margin: '0 0 12px', background: 'var(--warn-soft)', borderRadius: 'var(--r-sm)', fontSize: 12.5 }}
      >
        <AlertTriangle size={16} color="var(--warn)" />
        <span>
          Espacio de nombres en modo Windows 2000: los vínculos viven dentro del blob binario
          <span className="mono"> pKT</span> y ADeep los muestra en sólo lectura.
          {ns.partial ? ' Además, parte del blob no se pudo interpretar.' : ''}
        </span>
      </div>
    ) : null

  const main = ((): JSX.Element => {
    switch (selection.kind) {
      case 'namespaces':
        return (
          <DetailList
            rows={namespaces}
            rowKey={(n) => n.dn}
            rowKind={() => 'dfsNamespace'}
            onOpen={(n) => { setSelection({ kind: 'namespace', ns: n }); setSelectedId(n.dn) }}
            empty="No hay espacios de nombres DFS en este dominio"
            columns={[
              { id: 'name', label: 'Espacio de nombres', width: '25%', render: (n) => n.name, sortValue: (n) => n.name },
              { id: 'path', label: 'Ruta', width: '30%', render: (n) => <span className="mono">{n.path}</span> },
              { id: 'version', label: 'Modo', width: 130, render: (n) => (n.version === 1 ? 'Windows 2000' : 'Windows 2008') },
              { id: 'roots', label: 'Destinos de raíz', width: 140, render: (n) => n.rootTargets.length, sortValue: (n) => n.rootTargets.length },
              { id: 'folders', label: 'Carpetas', width: 110, render: (n) => n.folders.length, sortValue: (n) => n.folders.length }
            ]}
          />
        )

      case 'namespace': {
        const ns = selection.ns
        return (
          <>
            <div className="list-head">
              <div className="crumbs">
                <span className="crumb last mono">{ns.path}</span>
              </div>
            </div>
            <div style={{ padding: 16, overflow: 'auto' }}>
              {v1Warning(ns)}
              <div className="lbl" style={{ marginBottom: 6 }}>Destinos de la raíz</div>
              <div className="mini-table-wrap" style={{ marginBottom: 16 }}>
                <table className="mini">
                  <thead><tr><th>Destino</th><th style={{ width: 130 }}>Estado</th></tr></thead>
                  <tbody>
                    {ns.rootTargets.map((t) => (
                      <tr key={t.path}>
                        <td className="mono">{t.path}</td>
                        <td>{t.enabled ? <span className="badge ok">En línea</span> : <span className="badge warn">Deshabilitado</span>}</td>
                      </tr>
                    ))}
                    {!ns.rootTargets.length && <tr><td colSpan={2} className="hint">Sin destinos de raíz.</td></tr>}
                  </tbody>
                </table>
              </div>

              <div className="lbl" style={{ marginBottom: 6 }}>Carpetas ({ns.folders.length})</div>
              <div className="mini-table-wrap">
                <table className="mini">
                  <thead>
                    <tr>
                      <th style={{ width: '30%' }}>Carpeta</th>
                      <th>Destinos</th>
                      <th style={{ width: '25%' }}>Comentario</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ns.folders.map((f) => (
                      <tr
                        key={f.path}
                        onClick={() => { setSelection({ kind: 'folder', ns, folder: f }); setSelectedId(`${ns.dn}::${f.path}`) }}
                        onContextMenu={(e) => { e.preventDefault(); setCtx({ items: folderMenu(ns, f), x: e.clientX, y: e.clientY }) }}
                      >
                        <td>{f.path}</td>
                        <td className="mono">
                          {f.targets.map((t) => (
                            <div key={t.path} style={{ opacity: t.enabled ? 1 : 0.5 }}>
                              {t.path}{t.enabled ? '' : ' (deshabilitado)'}
                            </div>
                          ))}
                        </td>
                        <td>{f.comment ?? ''}</td>
                      </tr>
                    ))}
                    {!ns.folders.length && <tr><td colSpan={3} className="hint">Sin carpetas.</td></tr>}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )
      }

      case 'folder': {
        const { ns, folder } = selection
        return (
          <>
            <div className="list-head">
              <div className="crumbs">
                <span className="crumb">{ns.name}</span>
                <span className="sepr">›</span>
                <span className="crumb last">{folder.path}</span>
              </div>
            </div>
            <div style={{ padding: 16, overflow: 'auto' }}>
              {v1Warning(ns)}
              <div className="row" style={{ justifyContent: 'space-between', marginBottom: 10 }}>
                <div className="kv" style={{ gridTemplateColumns: '120px 1fr' }}>
                  <span className="k">Ruta</span>
                  <span className="v mono">{`${ns.path}\\${folder.path}`}</span>
                  <span className="k">Comentario</span>
                  <span className="v">{folder.comment ?? '—'}</span>
                  {folder.ttl !== undefined && (
                    <>
                      <span className="k">TTL de referencia</span>
                      <span className="v">{folder.ttl} s</span>
                    </>
                  )}
                </div>
                {ns.version === 2 && (
                  <button className="btn sm" onClick={() => setDialog({ t: 'folder', ns, folder })}>
                    Editar destinos…
                  </button>
                )}
              </div>
              <div className="mini-table-wrap">
                <table className="mini">
                  <thead>
                    <tr>
                      <th>Destino</th>
                      <th style={{ width: 130 }}>Estado</th>
                      <th style={{ width: 130 }}>Prioridad</th>
                    </tr>
                  </thead>
                  <tbody>
                    {folder.targets.map((t) => (
                      <tr key={t.path}>
                        <td className="mono">{t.path}</td>
                        <td>{t.enabled ? <span className="badge ok">En línea</span> : <span className="badge warn">Deshabilitado</span>}</td>
                        <td>{t.priorityClass !== undefined ? `${t.priorityClass}/${t.priorityRank ?? 0}` : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )
      }

      case 'groups':
        return (
          <DetailList
            rows={groups}
            rowKey={(g) => g.dn}
            rowKind={() => 'dfsrGroup'}
            onOpen={(g) => { setSelection({ kind: 'group', group: g }); setSelectedId(g.dn) }}
            empty="No hay grupos de replicación"
            columns={[
              { id: 'name', label: 'Grupo de replicación', width: '30%', render: (g) => g.name, sortValue: (g) => g.name },
              { id: 'type', label: 'Tipo', width: 130, render: (g) => (g.isSysvol ? <span className="badge accent">SYSVOL</span> : 'Datos') },
              { id: 'members', label: 'Miembros', width: 110, render: (g) => g.members.length, sortValue: (g) => g.members.length },
              { id: 'conns', label: 'Conexiones', width: 120, render: (g) => g.connections.length, sortValue: (g) => g.connections.length },
              { id: 'content', label: 'Contenido replicado', render: (g) => g.contentSets.map((c) => c.name).join(', ') }
            ]}
          />
        )

      case 'group': {
        const g = selection.group
        return (
          <>
            <div className="list-head">
              <div className="crumbs"><span className="crumb last">{g.name}</span></div>
            </div>
            <div style={{ padding: 16, overflow: 'auto' }}>
              <div className="kv" style={{ marginBottom: 16 }}>
                <span className="k">Tipo</span>
                <span className="v">{g.isSysvol ? 'SYSVOL (replicación del recurso del sistema)' : 'Datos'}</span>
                <span className="k">Descripción</span>
                <span className="v">{g.description ?? '—'}</span>
                <span className="k">Contenido replicado</span>
                <span className="v">{g.contentSets.map((c) => c.name).join(', ') || '—'}</span>
                <span className="k">Programación del grupo</span>
                <span className="v">
                  {g.schedule ? `${g.schedule.filter(Boolean).length} h/semana` : 'Siempre'}
                  <button
                    className="btn sm ghost"
                    style={{ marginLeft: 8 }}
                    onClick={() => setDialog({
                      t: 'schedule',
                      title: `Programación — ${g.name}`,
                      initial: g.schedule,
                      save: async (s) => {
                        const res = await window.adeep.dfs.setSchedule(g.dn, s)
                        setDialog(null)
                        if (report(res, 'Programación guardada') !== undefined) await load()
                      }
                    })}
                  >
                    <CalendarClock size={13} /> Editar
                  </button>
                </span>
              </div>

              <div className="lbl" style={{ marginBottom: 6 }}>Miembros ({g.members.length})</div>
              <div className="mini-table-wrap" style={{ marginBottom: 16 }}>
                <table className="mini">
                  <thead>
                    <tr>
                      <th style={{ width: '20%' }}>Servidor</th>
                      <th style={{ width: '30%' }}>Carpeta replicada</th>
                      <th style={{ width: '25%' }}>Staging</th>
                      <th style={{ width: 110 }}>Estado</th>
                      <th style={{ width: 110 }}>Sólo lectura</th>
                    </tr>
                  </thead>
                  <tbody>
                    {g.members.map((m) => (
                      <tr key={m.dn}>
                        <td>{m.name}</td>
                        <td className="mono">{m.contentPath ?? '—'}</td>
                        <td className="mono">{m.stagingPath ?? '—'}</td>
                        <td>{m.enabled ? <span className="badge ok">Activo</span> : <span className="badge warn">Deshabilitado</span>}</td>
                        <td>{m.readOnly ? 'Sí' : 'No'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="lbl" style={{ marginBottom: 6 }}>Conexiones ({g.connections.length})</div>
              <div className="mini-table-wrap">
                <table className="mini">
                  <thead>
                    <tr>
                      <th style={{ width: '25%' }}>Origen</th>
                      <th style={{ width: '25%' }}>Destino</th>
                      <th style={{ width: 110 }}>Estado</th>
                      <th style={{ width: 90 }}>RDC</th>
                      <th style={{ width: 140 }}>Programación</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {g.connections.map((c) => (
                      <tr key={c.dn}>
                        <td>{c.fromMemberName}</td>
                        <td>{c.toMemberName}</td>
                        <td>{c.enabled ? <span className="badge ok">Habilitada</span> : <span className="badge warn">Deshabilitada</span>}</td>
                        <td>{c.rdc ? 'Sí' : 'No'}</td>
                        <td>{c.schedule ? `${c.schedule.filter(Boolean).length} h/semana` : 'Siempre'}</td>
                        <td style={{ textAlign: 'right' }}>
                          <button
                            className="btn sm ghost"
                            onClick={() => setDialog({
                              t: 'schedule',
                              title: `Programación — ${c.fromMemberName} → ${c.toMemberName}`,
                              initial: c.schedule,
                              save: async (s) => {
                                const res = await window.adeep.dfs.setSchedule(c.dn, s)
                                setDialog(null)
                                if (report(res, 'Programación guardada') !== undefined) await load()
                              }
                            })}
                          >
                            <CalendarClock size={13} />
                          </button>
                          <button
                            className="btn sm ghost"
                            onClick={() => void (async () => {
                              const res = await window.adeep.dfs.setConnectionEnabled(c.dn, !c.enabled)
                              if (report(res, 'Conexión actualizada') !== undefined) await load()
                            })()}
                          >
                            {c.enabled ? 'Deshabilitar' : 'Habilitar'}
                          </button>
                        </td>
                      </tr>
                    ))}
                    {!g.connections.length && (
                      <tr>
                        <td colSpan={6} className="hint">
                          Sin objetos de conexión.
                          {g.isSysvol ? ' En SYSVOL la topología la administra el propio servicio.' : ''}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )
      }
    }
  })()

  const statusText = ((): string => {
    switch (selection.kind) {
      case 'namespaces': return `${namespaces.length} espacio(s) de nombres`
      case 'namespace': return `${selection.ns.folders.length} carpeta(s), ${selection.ns.rootTargets.length} destino(s) de raíz`
      case 'folder': return `${selection.folder.targets.length} destino(s)`
      case 'groups': return `${groups.length} grupo(s) de replicación`
      case 'group': return `${selection.group.members.length} miembro(s), ${selection.group.connections.length} conexión(es)`
    }
  })()

  return (
    <>
      <ConsoleShell
        title="ADeep — Administración de DFS"
        icon={<Share2 size={17} />}
        treeTitle="DFS"
        loading={loading}
        onRefresh={() => void load()}
        onSession={onSession}
        menus={{
          Acción: [
            {
              id: 'newfolder', label: 'Nueva carpeta…', icon: <Plus size={15} />,
              disabled: !namespaces.some((n) => n.version === 2),
              onSelect: () => toast('info', 'Elegí un espacio de nombres en modo Windows 2008 para agregarle carpetas.')
            },
            { id: 's1', separator: true },
            {
              id: 'help', label: 'Por qué algunos cambios no están disponibles', icon: <AlertTriangle size={15} />,
              onSelect: () => void confirm({
                title: 'Alcance de la consola DFS',
                message: 'ADeep administra lo que DFS guarda en Active Directory.',
                detail:
                  'Crear un espacio de nombres nuevo o agregarle destinos de raíz se hace por RPC ' +
                  '(MS-DFSNM) contra el servidor, no por LDAP.\n\n' +
                  'Los espacios de nombres en modo Windows 2000 guardan sus vínculos en el blob ' +
                  'binario pKT: se muestran en sólo lectura.\n\n' +
                  'Los servidores releen la configuración de AD por sondeo, así que un cambio puede ' +
                  'tardar hasta una hora en verse.',
                confirmLabel: 'Entendido'
              })
            }
          ]
        }}
        toolbar={
          <span className="hint" style={{ paddingLeft: 4 }}>
            <RefreshCcw size={13} style={{ verticalAlign: -2 }} /> {groups.length} grupos de replicación
          </span>
        }
        tree={
          <SimpleTree
            items={tree}
            selectedId={selectedId}
            onSelect={onSelect}
            defaultExpanded={['namespaces', 'groups']}
            onContextMenu={(item, x, y) => {
              if (!item.id.includes('::')) return
              const [dn, path] = item.id.split('::')
              const ns = namespaces.find((n) => n.dn === dn)
              const folder = ns?.folders.find((f) => f.path === path)
              if (ns && folder) setCtx({ items: folderMenu(ns, folder), x, y })
            }}
          />
        }
        main={main}
        status={<span className="seg">{statusText}</span>}
      />

      {ctx && <MenuPopup items={ctx.items} x={ctx.x} y={ctx.y} onClose={() => setCtx(null)} />}

      {dialog?.t === 'folder' && (
        <FolderDialog
          ns={dialog.ns}
          folder={dialog.folder}
          onClose={() => setDialog(null)}
          onSaved={() => { setDialog(null); void load() }}
        />
      )}

      {dialog?.t === 'schedule' && (
        <ScheduleEditor
          title={dialog.title}
          initial={dialog.initial}
          onCancel={() => setDialog(null)}
          onSave={dialog.save}
        />
      )}
    </>
  )
}

function FolderDialog({
  ns, folder, onClose, onSaved
}: {
  ns: DfsNamespace
  folder: DfsFolder
  onClose: () => void
  onSaved: () => void
}): JSX.Element {
  const [targets, setTargets] = useState<DfsTarget[]>(folder.targets)
  const [comment, setComment] = useState(folder.comment ?? '')
  const [newTarget, setNewTarget] = useState('')
  const [busy, setBusy] = useState(false)

  const add = (): void => {
    const path = newTarget.trim()
    if (!path.startsWith('\\\\')) return
    const parts = path.replace(/^\\\\/, '').split('\\')
    setTargets([...targets, { path, server: parts[0] ?? '', share: parts.slice(1).join('\\'), enabled: true }])
    setNewTarget('')
  }

  const save = async (): Promise<void> => {
    if (!folder.dn) return
    setBusy(true)
    const res = await window.adeep.dfs.setFolderTargets(folder.dn, targets)
    if (res.ok && comment !== (folder.comment ?? '')) {
      await window.adeep.dfs.setFolderComment(folder.dn, comment)
    }
    setBusy(false)
    if (report(res, 'Carpeta actualizada') !== undefined) onSaved()
  }

  return (
    <Modal
      title={folder.path}
      subtitle={`${ns.path}\\${folder.path}`}
      icon={<FolderSymlink size={18} color="var(--accent)" />}
      size="wide"
      onClose={onClose}
      footer={
        <>
          <div className="spacer" style={{ flex: 1 }} />
          <button className="btn" onClick={onClose}>Cancelar</button>
          <button className="btn primary" disabled={busy || !targets.length} onClick={() => void save()}>
            Guardar
          </button>
        </>
      }
    >
      <div className="col" style={{ gap: 10 }}>
        <Text label="Comentario" value={comment} onChange={setComment} />
        <div className="lbl">Destinos de la carpeta</div>
        <div className="mini-table-wrap" style={{ maxHeight: 220, overflow: 'auto' }}>
          <table className="mini">
            <tbody>
              {targets.map((t, i) => (
                <tr key={t.path}>
                  <td className="mono">{t.path}</td>
                  <td style={{ width: 130 }}>
                    <Check2
                      label="Habilitado"
                      checked={t.enabled}
                      onChange={(v) => setTargets(targets.map((x, j) => (j === i ? { ...x, enabled: v } : x)))}
                    />
                  </td>
                  <td style={{ width: 50, textAlign: 'right' }}>
                    <button className="btn sm ghost icon" onClick={() => setTargets(targets.filter((_, j) => j !== i))}>
                      <Trash2 size={13} />
                    </button>
                  </td>
                </tr>
              ))}
              {!targets.length && <tr><td className="hint">La carpeta necesita al menos un destino.</td></tr>}
            </tbody>
          </table>
        </div>
        <div className="row" style={{ gap: 8, alignItems: 'flex-end' }}>
          <Field label="Nuevo destino" style={{ flex: 1 }}>
            <input
              type="text"
              value={newTarget}
              placeholder="\\\\servidor\\recurso"
              onChange={(e) => setNewTarget(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') add() }}
            />
          </Field>
          <button className="btn" onClick={add} disabled={!newTarget.trim().startsWith('\\\\')}>Agregar</button>
        </div>
      </div>
    </Modal>
  )
}
