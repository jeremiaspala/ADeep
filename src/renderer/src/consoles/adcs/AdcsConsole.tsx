import { useCallback, useMemo, useState, type JSX } from 'react'
import { FileBadge, ShieldAlert, ShieldCheck, Server, Settings2, Info } from 'lucide-react'
import type { CertificateAuthority, CertificateTemplate, SessionInfo } from '@shared/types'
import ConsoleShell from '../../shell/ConsoleShell'
import SimpleTree, { type TreeItem } from '../../shell/SimpleTree'
import DetailList from '../../shell/DetailList'
import { Modal, MenuPopup, useConfirm, type MenuItemDef } from '../../components/ui'
import SecurityTab from '../../components/SecurityTab'
import { report, useApp } from '../../store'

type Vista = 'cas' | 'plantillas' | 'riesgos' | 'almacenes'

export default function AdcsConsole(): JSX.Element {
  const confirm = useConfirm()
  const session = useApp((s) => s.session)
  const toast = useApp((s) => s.toast)
  const [templates, setTemplates] = useState<CertificateTemplate[]>([])
  const [cas, setCas] = useState<CertificateAuthority[]>([])
  const [stores, setStores] = useState<{ store: string; label: string; certificates: number; dn: string }[]>([])
  const [loading, setLoading] = useState(false)
  const [vista, setVista] = useState<Vista>('plantillas')
  const [ctx, setCtx] = useState<{ items: MenuItemDef[]; x: number; y: number } | null>(null)
  const [dialog, setDialog] = useState<null | { t: 'plantilla'; template: CertificateTemplate }>(null)

  const cargar = useCallback(async (): Promise<void> => {
    setLoading(true)
    const [t, c, s] = await Promise.all([
      window.adeep.adcs.templates(),
      window.adeep.adcs.authorities(),
      window.adeep.adcs.stores()
    ])
    setLoading(false)
    if (report(t) !== undefined) setTemplates(t.data ?? [])
    if (c.ok) setCas(c.data ?? [])
    if (s.ok) setStores(s.data ?? [])
  }, [])

  const onSession = useCallback((_i: SessionInfo) => { void cargar() }, [cargar])

  /**
   * Fija las CAs del dominio en el perfil de conexión. Después de esto se puede
   * destildar «No verificar el certificado del servidor» sin que falle LDAPS.
   */
  const confiarEnLaCa = useCallback(async (): Promise<void> => {
    const perfil = session.profile
    if (!perfil) return
    const res = await window.adeep.adcs.caCertificates()
    const certs = report(res)
    if (!certs?.length) {
      toast('warn', 'No hay certificados de CA publicados en el directorio.')
      return
    }

    const ok = await confirm({
      title: 'Confiar en la CA del dominio',
      message:
        `Se van a guardar ${certs.length} certificado(s) de entidad emisora en el perfil ` +
        `"${perfil.name}" y se va a activar la validación del certificado del DC.`,
      detail:
        certs.map((c) => `• ${c.name} (${c.store})`).join('\n') +
        '\n\nSi el certificado LDAPS del controlador no lo firmó ninguna de estas CAs, ' +
        'la próxima conexión va a fallar. Se revierte destildando la validación en el diálogo de conexión.',
      confirmLabel: 'Confiar y validar'
    })
    if (!ok) return

    const guardado = await window.adeep.store.saveProfile({
      ...perfil,
      caCertificates: certs.map((c) => c.pem),
      insecureTLS: false
    })
    if (report(guardado) !== undefined) {
      toast(
        'ok',
        `${certs.length} certificado(s) de CA guardados en el perfil. La próxima conexión valida el certificado del DC.`
      )
    }
  }, [session.profile, toast, confirm])

  const conRiesgo = useMemo(
    () => templates.filter((t) => t.risks.some((r) => r.severity !== 'baja')),
    [templates]
  )
  const publicadas = useMemo(() => templates.filter((t) => t.publishedBy.length), [templates])

  const tree = useMemo<TreeItem[]>(() => [
    {
      id: 'raiz',
      label: 'Servicios de certificados',
      kind: 'container',
      children: [
        { id: 'cas', label: 'Entidades emisoras', kind: 'server', badge: String(cas.length) },
        { id: 'plantillas', label: 'Plantillas', kind: 'container', badge: `${publicadas.length}/${templates.length}` },
        { id: 'riesgos', label: 'Revisión de seguridad', kind: 'unknown', badge: String(conRiesgo.length) },
        { id: 'almacenes', label: 'Almacenes de confianza', kind: 'container', badge: String(stores.length) }
      ]
    }
  ], [cas, templates, publicadas, conRiesgo, stores])

  const severidad = (t: CertificateTemplate): JSX.Element => {
    const alta = t.risks.some((r) => r.severity === 'alta')
    const media = t.risks.some((r) => r.severity === 'media')
    if (alta) return <span className="badge danger">Revisar</span>
    if (media) return <span className="badge warn">Atención</span>
    if (t.risks.length) return <span className="badge neutral">Menor</span>
    return <span className="hint">—</span>
  }

  const main = ((): JSX.Element => {
    switch (vista) {
      case 'cas':
        return (
          <DetailList
            rows={cas}
            rowKey={(c) => c.dn}
            rowKind={() => 'server'}
            empty="No hay entidades emisoras registradas en el directorio"
            columns={[
              { id: 'name', label: 'Entidad emisora', width: '28%', render: (c) => c.name, sortValue: (c) => c.name },
              { id: 'host', label: 'Servidor', width: '28%', render: (c) => c.host },
              { id: 'tpl', label: 'Plantillas publicadas', width: 180, render: (c) => c.templates.length, sortValue: (c) => c.templates.length },
              { id: 'subject', label: 'Sujeto', render: (c) => <span className="mono">{c.subject}</span> }
            ]}
          />
        )

      case 'plantillas':
      case 'riesgos': {
        const filas = vista === 'riesgos' ? conRiesgo : templates
        return (
          <>
            {vista === 'riesgos' && (
              <div style={{ padding: '10px 16px', background: 'var(--warn-soft)', fontSize: 12.5 }}>
                Combinaciones que en la práctica permiten pedir un certificado a nombre de otro.
                Las plantillas que ninguna entidad emisora publica aparecen igual, pero como menores:
                no son solicitables hasta que alguien las publique.
              </div>
            )}
            <DetailList
              rows={filas}
              rowKey={(t) => t.dn}
              rowKind={() => 'container'}
              onOpen={(t) => setDialog({ t: 'plantilla', template: t })}
              onContextMenu={(t, x, y) => setCtx({
                items: [
                  { id: 'props', label: 'Detalle…', icon: <Settings2 size={15} />, onSelect: () => setDialog({ t: 'plantilla', template: t }) }
                ], x, y
              })}
              empty={vista === 'riesgos' ? 'Ninguna plantilla tiene observaciones' : 'No hay plantillas'}
              columns={[
                { id: 'name', label: 'Plantilla', width: '26%', render: (t) => t.name, sortValue: (t) => t.name },
                {
                  id: 'pub', label: 'Publicada por', width: '20%',
                  render: (t) => (t.publishedBy.length ? t.publishedBy.join(', ') : <span className="hint">sin publicar</span>),
                  sortValue: (t) => t.publishedBy.length
                },
                { id: 'eku', label: 'Uso', width: '24%', render: (t) => t.ekuNames.join(', ') },
                {
                  id: 'ctrl', label: 'Controles', width: 190,
                  render: (t) => [
                    t.requiresApproval ? 'aprobación' : '',
                    t.raSignatures ? `${t.raSignatures} firma(s)` : '',
                    t.autoEnroll ? 'autoinscripción' : ''
                  ].filter(Boolean).join(' · ') || '—'
                },
                { id: 'risk', label: 'Seguridad', width: 120, render: severidad, sortValue: (t) => (t.risks.some((r) => r.severity === 'alta') ? 0 : 1) }
              ]}
            />
          </>
        )
      }

      case 'almacenes':
        return (
          <>
            <DetailList
              rows={stores}
              rowKey={(s) => s.dn}
              rowKind={() => 'container'}
              empty="Sin almacenes"
              columns={[
                { id: 'label', label: 'Almacén', width: '45%', render: (s) => s.label },
                { id: 'count', label: 'Certificados', width: 140, render: (s) => s.certificates, sortValue: (s) => s.certificates },
                { id: 'dn', label: 'Ubicación', render: (s) => <span className="mono">{s.dn.split(',').slice(0, 2).join(',')}</span> }
              ]}
            />
            <div style={{ padding: 16, borderTop: '1px solid var(--border)' }}>
              <div className="row" style={{ gap: 8, alignItems: 'flex-start', fontSize: 12.5, color: 'var(--text-dim)' }}>
                <Info size={16} />
                <span>
                  NTAuth es el almacén que decide qué entidades emisoras pueden emitir certificados
                  válidos para iniciar sesión en el dominio. Cualquier CA que entre acá puede
                  autenticar usuarios: es de los contenedores más sensibles del directorio.
                </span>
              </div>
              {session.profile?.insecureTLS && (
                <div className="row" style={{ gap: 8, marginTop: 12, alignItems: 'flex-start', fontSize: 12.5 }}>
                  <ShieldAlert size={16} color="var(--warn)" />
                  <span>
                    Esta sesión no está validando el certificado del controlador de dominio.
                    <button className="btn sm" style={{ marginLeft: 8 }} onClick={() => void confiarEnLaCa()}>
                      Confiar en la CA del dominio
                    </button>
                  </span>
                </div>
              )}
            </div>
          </>
        )
    }
  })()

  return (
    <>
      <ConsoleShell
        title="ADeep — Certificados"
        icon={<FileBadge size={17} />}
        treeTitle="Certificados"
        loading={loading}
        onRefresh={() => void cargar()}
        onSession={onSession}
        menus={{
          Acción: [
            {
              id: 'riesgos', label: 'Revisión de seguridad', icon: <ShieldAlert size={15} />,
              onSelect: () => setVista('riesgos')
            },
            { id: 's1', separator: true },
            {
              id: 'trust', label: 'Confiar en la CA del dominio para LDAPS…', icon: <ShieldCheck size={15} />,
              disabled: !session.connected,
              onSelect: () => void confiarEnLaCa()
            }
          ]
        }}
        toolbar={
          <span className="hint" style={{ paddingLeft: 4 }}>
            <Server size={13} style={{ verticalAlign: -2 }} /> {cas.length} entidad(es) ·{' '}
            {publicadas.length} plantilla(s) publicada(s)
            {conRiesgo.length ? ` · ${conRiesgo.length} para revisar` : ''}
          </span>
        }
        tree={
          <SimpleTree
            items={tree}
            selectedId={vista}
            defaultExpanded={['raiz']}
            onSelect={(item) => {
              if (['cas', 'plantillas', 'riesgos', 'almacenes'].includes(item.id)) setVista(item.id as Vista)
            }}
          />
        }
        main={main}
        status={
          <span className="seg">
            {templates.length} plantilla(s), {publicadas.length} publicada(s)
            {conRiesgo.length ? ` · ${conRiesgo.length} con observaciones` : ''}
          </span>
        }
      />

      {ctx && <MenuPopup items={ctx.items} x={ctx.x} y={ctx.y} onClose={() => setCtx(null)} />}

      {dialog?.t === 'plantilla' && (
        <PlantillaDialog template={dialog.template} onClose={() => setDialog(null)} />
      )}
    </>
  )
}

function PlantillaDialog({
  template, onClose
}: {
  template: CertificateTemplate
  onClose: () => void
}): JSX.Element {
  const [tab, setTab] = useState<'general' | 'seguridad'>('general')

  return (
    <Modal
      title={template.name}
      subtitle={`Plantilla de certificado · esquema v${template.schemaVersion} · revisión ${template.revision}`}
      icon={<FileBadge size={18} color="var(--accent)" />}
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
      <div className="tabs">
        <button className={`tab ${tab === 'general' ? 'on' : ''}`} onClick={() => setTab('general')}>General</button>
        <button className={`tab ${tab === 'seguridad' ? 'on' : ''}`} onClick={() => setTab('seguridad')}>
          Quién puede inscribirse
        </button>
      </div>

      <div style={{ overflow: 'auto', minHeight: 0, flex: 1 }}>
        {tab === 'general' ? (
          <div style={{ padding: 16 }}>
            {template.risks.length > 0 && (
              <div style={{ marginBottom: 16 }}>
                {template.risks.map((r) => (
                  <div
                    key={r.id + r.label}
                    className="row"
                    style={{
                      gap: 10, alignItems: 'flex-start', padding: 12, marginBottom: 8,
                      borderRadius: 'var(--r-sm)',
                      background: r.severity === 'alta' ? 'var(--danger-soft)' : r.severity === 'media' ? 'var(--warn-soft)' : 'var(--bg-sunken)'
                    }}
                  >
                    <ShieldAlert size={17} color={r.severity === 'alta' ? 'var(--danger)' : 'var(--warn)'} />
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontWeight: 600, fontSize: 13 }}>
                        [{r.id}] {r.label}
                      </div>
                      <div className="hint" style={{ marginTop: 3 }}>{r.detail}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div className="kv">
              <span className="k">Nombre interno</span>
              <span className="v mono">{template.cn}</span>
              <span className="k">Publicada por</span>
              <span className="v">{template.publishedBy.join(', ') || 'ninguna entidad emisora'}</span>
              <span className="k">Uso extendido de clave</span>
              <span className="v">{template.ekuNames.join(', ')}</span>
              <span className="k">Vigencia</span>
              <span className="v">{template.validity}</span>
              <span className="k">Tamaño mínimo de clave</span>
              <span className="v">{template.minimalKeySize || '—'}</span>
              <span className="k">El solicitante elige el sujeto</span>
              <span className="v">{template.suppliesSubject ? 'Sí' : 'No'}</span>
              <span className="k">Requiere aprobación</span>
              <span className="v">{template.requiresApproval ? 'Sí' : 'No'}</span>
              <span className="k">Firmas de agente requeridas</span>
              <span className="v">{template.raSignatures}</span>
              <span className="k">Autoinscripción</span>
              <span className="v">{template.autoEnroll ? 'Sí' : 'No'}</span>
              <span className="k">Publica en el directorio</span>
              <span className="v">{template.publishToDs ? 'Sí' : 'No'}</span>
              <span className="k">Extensión de seguridad (SID)</span>
              <span className="v">{template.noSecurityExtension ? 'No incluida' : 'Incluida'}</span>
              <span className="k">msPKI-Certificate-Name-Flag</span>
              <span className="v mono">0x{(template.nameFlags >>> 0).toString(16)}</span>
              <span className="k">msPKI-Enrollment-Flag</span>
              <span className="v mono">0x{(template.enrollmentFlags >>> 0).toString(16)}</span>
              <span className="k">DN</span>
              <span className="v mono">{template.dn}</span>
            </div>
          </div>
        ) : (
          <SecurityTab dn={template.dn} onDirty={() => undefined} />
        )}
      </div>
    </Modal>
  )
}
