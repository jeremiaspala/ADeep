import { useEffect, useState, type JSX } from 'react'
import { Search, Play, Save, ListFilter, Trash2 } from 'lucide-react'
import type { DirEntry, SavedQuery, SearchResult } from '@shared/types'
import { Check2, Field, Modal, Spinner, Tabs, Text } from './ui'
import { KindIcon } from '../lib/icons'
import { useApp, report } from '../store'
import { applyListFilter, revealDN, revealObject, showResults } from '../lib/treeActions'
import { dnToCanonical, escapeFilter } from '../lib/format'

type Kind = 'all' | 'user' | 'group' | 'computer' | 'ou' | 'contact' | 'printer'

const KIND_FILTER: Record<Kind, string> = {
  all: '(objectClass=*)',
  user: '(&(objectCategory=person)(objectClass=user)(!(objectClass=computer)))',
  group: '(objectCategory=group)',
  computer: '(objectCategory=computer)',
  ou: '(objectCategory=organizationalUnit)',
  contact: '(objectCategory=contact)',
  printer: '(objectCategory=printQueue)'
}

const PRESETS: { id: string; label: string; filter: string }[] = [
  { id: 'disabled', label: 'Cuentas deshabilitadas', filter: '(&(objectCategory=person)(objectClass=user)(userAccountControl:1.2.840.113556.1.4.803:=2))' },
  { id: 'locked', label: 'Cuentas bloqueadas', filter: '(&(objectCategory=person)(objectClass=user)(lockoutTime>=1))' },
  { id: 'neverexp', label: 'Contraseña que nunca expira', filter: '(&(objectCategory=person)(objectClass=user)(userAccountControl:1.2.840.113556.1.4.803:=65536))' },
  { id: 'pwdnotreq', label: 'No requieren contraseña', filter: '(&(objectCategory=person)(objectClass=user)(userAccountControl:1.2.840.113556.1.4.803:=32))' },
  { id: 'mustchange', label: 'Deben cambiar la contraseña', filter: '(&(objectCategory=person)(objectClass=user)(pwdLastSet=0))' },
  { id: 'emptygroups', label: 'Grupos vacíos', filter: '(&(objectCategory=group)(!(member=*)))' },
  { id: 'nologon', label: 'Sin inicio de sesión registrado', filter: '(&(objectCategory=person)(objectClass=user)(!(lastLogonTimestamp=*)))' },
  { id: 'spn', label: 'Cuentas con SPN (kerberoasteables)', filter: '(&(objectCategory=person)(objectClass=user)(servicePrincipalName=*))' },
  { id: 'noPreauth', label: 'Sin preautenticación Kerberos', filter: '(&(objectCategory=person)(objectClass=user)(userAccountControl:1.2.840.113556.1.4.803:=4194304))' },
  { id: 'oldcomputers', label: 'Equipos con SO antiguo', filter: '(&(objectCategory=computer)(|(operatingSystem=*XP*)(operatingSystem=*2003*)(operatingSystem=*2008*)(operatingSystem=*Windows 7*)))' }
]

export default function FindDialog({
  onClose,
  onOpenProps
}: {
  onClose: () => void
  onOpenProps: (dn: string) => void
}): JSX.Element {
  const session = useApp((s) => s.session)
  const selectedDN = useApp((s) => s.selectedDN)
  const queries = useApp((s) => s.queries)
  const set = useApp((s) => s.set)

  const baseDefault = session.rootDSE?.defaultNamingContext ?? ''
  const [tab, setTab] = useState('simple')
  const [kind, setKind] = useState<Kind>('user')
  const [name, setName] = useState('')
  const [desc, setDesc] = useState('')
  const [baseDN, setBaseDN] = useState(selectedDN || baseDefault)
  const [subtree, setSubtree] = useState(true)
  const [custom, setCustom] = useState('(objectClass=*)')
  const [includeDeleted, setIncludeDeleted] = useState(false)
  const [results, setResults] = useState<DirEntry[]>([])
  const [info, setInfo] = useState<SearchResult>()
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    void (async () => {
      const q = await window.adeep.store.queries()
      if (q.ok) set({ queries: q.data ?? [] })
    })()
  }, [set])

  const buildFilter = (): string => {
    if (tab === 'custom') return custom.trim() || '(objectClass=*)'
    const parts = [KIND_FILTER[kind]]
    if (name.trim()) {
      const q = escapeFilter(name.trim())
      parts.push(`(|(cn=*${q}*)(name=*${q}*)(displayName=*${q}*)(sAMAccountName=*${q}*)(userPrincipalName=*${q}*)(mail=*${q}*))`)
    }
    if (desc.trim()) parts.push(`(description=*${escapeFilter(desc.trim())}*)`)
    return parts.length > 1 ? `(&${parts.join('')})` : parts[0]
  }

  const run = async (filterOverride?: string): Promise<void> => {
    setBusy(true)
    const filter = filterOverride ?? buildFilter()
    const res = await window.adeep.search.run({
      baseDN: baseDN || baseDefault,
      scope: subtree ? 'sub' : 'one',
      filter,
      sizeLimit: 5000,
      pageSize: 500,
      includeDeleted
    })
    setBusy(false)
    const data = report(res)
    if (!data) return
    setInfo(data)
    setResults(data.entries)
  }

  const saveQuery = async (): Promise<void> => {
    const id = await window.adeep.store.newId()
    const q: SavedQuery = {
      id: id.data ?? String(Date.now()),
      name: (tab === 'custom' ? 'Consulta LDAP' : name.trim() || 'Consulta') + ` (${new Date().toLocaleDateString('es-AR')})`,
      baseDN: baseDN || baseDefault,
      scope: subtree ? 'sub' : 'one',
      filter: buildFilter()
    }
    const res = await window.adeep.store.saveQuery(q)
    const data = report(res, 'Consulta guardada')
    if (data) set({ queries: data })
  }

  const deleteQuery = async (id: string): Promise<void> => {
    const res = await window.adeep.store.deleteQuery(id)
    const data = report(res)
    if (data) set({ queries: data })
  }

  const useSaved = (q: SavedQuery): void => {
    setTab('custom')
    setCustom(q.filter)
    setBaseDN(q.baseDN)
    setSubtree(q.scope !== 'one')
    void run(q.filter)
  }

  return (
    <Modal
      title="Buscar en el directorio"
      subtitle={info ? `${results.length} resultado(s) en ${info.took} ms` : undefined}
      icon={<Search size={18} color="var(--accent)" />}
      size="xwide"
      tall
      bodyFlush
      onClose={onClose}
      footer={
        <>
          <button className="btn ghost" onClick={() => void saveQuery()}>
            <Save size={15} /> Guardar consulta
          </button>
          <button
            className="btn ghost"
            onClick={() => { applyListFilter(buildFilter()); onClose() }}
            title="Aplica el filtro al contenedor seleccionado"
          >
            <ListFilter size={15} /> Filtrar la lista
          </button>
          <div className="spacer" style={{ flex: 1 }} />
          <button
            className="btn"
            disabled={!results.length}
            onClick={() => { showResults('Resultados de la búsqueda', results); onClose() }}
          >
            Mostrar en la lista
          </button>
          <button className="btn primary" disabled={busy} onClick={() => void run()}>
            {busy ? <Spinner size={14} /> : <Play size={15} />} Buscar
          </button>
        </>
      }
    >
      <Tabs
        tabs={[
          { id: 'simple', label: 'Búsqueda' },
          { id: 'custom', label: 'Consulta LDAP' },
          { id: 'saved', label: `Guardadas (${queries.length})` }
        ]}
        active={tab}
        onChange={setTab}
      />

      <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12, minHeight: 0 }}>
        {tab === 'simple' && (
          <>
            <div className="grid-3">
              <Field label="Buscar">
                <select value={kind} onChange={(e) => setKind(e.target.value as Kind)}>
                  <option value="user">Usuarios</option>
                  <option value="group">Grupos</option>
                  <option value="computer">Equipos</option>
                  <option value="ou">Unidades organizativas</option>
                  <option value="contact">Contactos</option>
                  <option value="printer">Impresoras</option>
                  <option value="all">Todo</option>
                </select>
              </Field>
              <Text label="Nombre contiene" value={name} onChange={setName} onEnter={() => void run()} autoFocus />
              <Text label="Descripción contiene" value={desc} onChange={setDesc} onEnter={() => void run()} />
            </div>
            <div className="row" style={{ gap: 12, flexWrap: 'wrap' }}>
              {PRESETS.map((p) => (
                <button key={p.id} className="btn sm" onClick={() => { setTab('custom'); setCustom(p.filter); void run(p.filter) }}>
                  {p.label}
                </button>
              ))}
            </div>
          </>
        )}

        {tab === 'custom' && (
          <>
            <Field label="Filtro LDAP" hint="Sintaxis RFC 4515. Ejemplo: (&(objectClass=user)(department=Sistemas))">
              <textarea rows={3} value={custom} onChange={(e) => setCustom(e.target.value)} />
            </Field>
            <Check2 label="Incluir objetos eliminados (tombstones)" checked={includeDeleted} onChange={setIncludeDeleted} />
          </>
        )}

        {tab === 'saved' && (
          <div className="mini-table-wrap" style={{ maxHeight: 180, overflow: 'auto' }}>
            <table className="mini">
              <tbody>
                {queries.map((q) => (
                  <tr key={q.id} onDoubleClick={() => useSaved(q)}>
                    <td style={{ width: '30%' }}>{q.name}</td>
                    <td className="mono" title={q.filter}>{q.filter}</td>
                    <td style={{ width: 120, textAlign: 'right' }}>
                      <button className="btn sm ghost" onClick={() => useSaved(q)}>Ejecutar</button>
                      <button className="btn sm ghost icon" onClick={() => void deleteQuery(q.id)} title="Eliminar">
                        <Trash2 size={13} />
                      </button>
                    </td>
                  </tr>
                ))}
                {!queries.length && (
                  <tr><td className="hint">No hay consultas guardadas.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}

        {tab !== 'saved' && (
          <div className="grid-2">
            <Text label="Base de búsqueda" value={baseDN} onChange={setBaseDN} hint="Vacío = raíz del dominio" />
            <div className="col" style={{ justifyContent: 'flex-end', paddingBottom: 4 }}>
              <Check2 label="Incluir subcontenedores" checked={subtree} onChange={setSubtree} />
            </div>
          </div>
        )}

        <div className="mini-table-wrap" style={{ flex: 1, minHeight: 220, overflow: 'auto' }}>
          <table className="mini">
            <thead>
              <tr>
                <th style={{ width: '28%' }}>Nombre</th>
                <th style={{ width: '18%' }}>Cuenta</th>
                <th>Ubicación</th>
                <th style={{ width: 150 }}></th>
              </tr>
            </thead>
            <tbody>
              {results.map((r) => (
                <tr key={r.dn} onDoubleClick={() => onOpenProps(r.dn)}>
                  <td>
                    <span className="row" style={{ gap: 6 }}>
                      <KindIcon kind={r.kind} size={14} />
                      {r.name}
                      {r.disabled && <span className="badge danger">Deshabilitada</span>}
                      {r.locked && <span className="badge warn">Bloqueada</span>}
                    </span>
                  </td>
                  <td>{r.attrs?.sAMAccountName?.[0] ?? ''}</td>
                  <td title={r.dn}>{dnToCanonical(r.dn)}</td>
                  <td style={{ textAlign: 'right' }}>
                    <button className="btn sm ghost" onClick={() => { void (r.isContainer ? revealDN(r.dn) : revealObject(r.dn)); onClose() }}>Ir a</button>
                    <button className="btn sm ghost" onClick={() => onOpenProps(r.dn)}>Propiedades</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {busy && <div className="row" style={{ gap: 8, padding: 12 }}><Spinner /> Buscando…</div>}
          {!busy && !results.length && (
            <div className="empty-state" style={{ height: 180 }}>
              <div className="title">Sin resultados</div>
              <div>Ajustá los criterios y volvé a buscar.</div>
            </div>
          )}
        </div>
      </div>
    </Modal>
  )
}
