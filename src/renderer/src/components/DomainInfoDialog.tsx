import { useEffect, useState, type JSX } from 'react'
import { Building2 } from 'lucide-react'
import type { DomainControllerInfo, FsmoRoles, PasswordPolicy } from '@shared/types'
import { Modal, Spinner, Tabs } from './ui'
import { useApp } from '../store'
import { dnToDomain, functionalLevel } from '../lib/format'

export default function DomainInfoDialog({ onClose }: { onClose: () => void }): JSX.Element {
  const session = useApp((s) => s.session)
  const [tab, setTab] = useState('general')
  const [fsmo, setFsmo] = useState<FsmoRoles>()
  const [dcs, setDcs] = useState<DomainControllerInfo[]>()
  const [policy, setPolicy] = useState<PasswordPolicy>()
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    void (async () => {
      const [f, d, p] = await Promise.all([
        window.adeep.session.fsmo(),
        window.adeep.session.domainControllers(),
        window.adeep.session.passwordPolicy()
      ])
      if (f.ok) setFsmo(f.data)
      if (d.ok) setDcs(d.data)
      if (p.ok) setPolicy(p.data)
      setLoading(false)
    })()
  }, [])

  const root = session.rootDSE

  return (
    <Modal
      title="Información del dominio"
      subtitle={dnToDomain(root?.defaultNamingContext ?? '')}
      icon={<Building2 size={18} color="var(--accent)" />}
      size="wide"
      tall
      onClose={onClose}
      bodyFlush
      footer={
        <>
          <div className="spacer" style={{ flex: 1 }} />
          <button className="btn primary" onClick={onClose}>Cerrar</button>
        </>
      }
    >
      <Tabs
        tabs={[
          { id: 'general', label: 'General' },
          { id: 'fsmo', label: 'Roles FSMO' },
          { id: 'dcs', label: 'Controladores' },
          { id: 'policy', label: 'Directiva de contraseñas' }
        ]}
        active={tab}
        onChange={setTab}
      />
      <div style={{ padding: 16, overflow: 'auto' }}>
        {loading && tab !== 'general' && <div className="row" style={{ gap: 8 }}><Spinner /> Consultando…</div>}

        {tab === 'general' && (
          <div className="kv">
            <span className="k">Dominio</span>
            <span className="v">{dnToDomain(root?.defaultNamingContext ?? '')}</span>
            <span className="k">NetBIOS</span>
            <span className="v">{session.netbiosName ?? '—'}</span>
            <span className="k">SID del dominio</span>
            <span className="v mono">{session.domainSID ?? '—'}</span>
            <span className="k">Servidor conectado</span>
            <span className="v">{root?.dnsHostName ?? '—'}</span>
            <span className="k">Sesión iniciada como</span>
            <span className="v">{session.whoami ?? session.profile?.bindDN ?? '—'}</span>
            <span className="k">Nivel funcional del dominio</span>
            <span className="v">{functionalLevel(root?.domainFunctionality)}</span>
            <span className="k">Nivel funcional del bosque</span>
            <span className="v">{functionalLevel(root?.forestFunctionality)}</span>
            <span className="k">Contexto raíz del bosque</span>
            <span className="v mono">{root?.rootDomainNamingContext ?? '—'}</span>
            <span className="k">Contexto de configuración</span>
            <span className="v mono">{root?.configurationNamingContext ?? '—'}</span>
            <span className="k">Esquema</span>
            <span className="v mono">{root?.schemaNamingContext ?? '—'}</span>
            <span className="k">Catálogo global</span>
            <span className="v">{root?.isGlobalCatalogReady ? 'Sí' : 'No'}</span>
            <span className="k">Cuota de equipos por usuario</span>
            <span className="v">{session.machineAccountQuota ?? '—'}</span>
            <span className="k">SASL soportado</span>
            <span className="v">{root?.supportedSASLMechanisms?.join(', ') || '—'}</span>
          </div>
        )}

        {tab === 'fsmo' && fsmo && (
          <div className="kv">
            <span className="k">Maestro de esquema</span>
            <span className="v">{holder(fsmo.schemaMaster)}</span>
            <span className="k">Maestro de nombres de dominio</span>
            <span className="v">{holder(fsmo.domainNamingMaster)}</span>
            <span className="k">Emulador PDC</span>
            <span className="v">{holder(fsmo.pdcEmulator)}</span>
            <span className="k">Maestro RID</span>
            <span className="v">{holder(fsmo.ridMaster)}</span>
            <span className="k">Maestro de infraestructura</span>
            <span className="v">{holder(fsmo.infrastructureMaster)}</span>
          </div>
        )}

        {tab === 'dcs' && dcs && (
          <div className="mini-table-wrap">
            <table className="mini">
              <thead>
                <tr>
                  <th>Nombre</th>
                  <th>DNS</th>
                  <th>Sitio</th>
                  <th>Sistema operativo</th>
                  <th style={{ width: 50 }}>GC</th>
                </tr>
              </thead>
              <tbody>
                {dcs.map((d) => (
                  <tr key={d.dn}>
                    <td>{d.name}</td>
                    <td>{d.dnsHostName}</td>
                    <td>{d.site}</td>
                    <td title={d.osVersion}>{d.os}</td>
                    <td>{d.isGC ? 'Sí' : 'No'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {tab === 'policy' && policy && (
          <div className="kv">
            <span className="k">Longitud mínima</span>
            <span className="v">{policy.minPwdLength} caracteres</span>
            <span className="k">Complejidad</span>
            <span className="v">{policy.complexityEnabled ? 'Activada' : 'Desactivada'}</span>
            <span className="k">Historial</span>
            <span className="v">{policy.pwdHistoryLength} contraseñas</span>
            <span className="k">Vigencia máxima</span>
            <span className="v">{policy.maxPwdAgeDays > 0 ? `${policy.maxPwdAgeDays} días` : 'Sin vencimiento'}</span>
            <span className="k">Vigencia mínima</span>
            <span className="v">{policy.minPwdAgeDays} días</span>
            <span className="k">Umbral de bloqueo</span>
            <span className="v">{policy.lockoutThreshold || 'Sin bloqueo'}</span>
            <span className="k">Duración del bloqueo</span>
            <span className="v">{policy.lockoutDurationMin} min</span>
            <span className="k">Ventana de observación</span>
            <span className="v">{policy.lockoutObservationMin} min</span>
            <span className="k">Cifrado reversible</span>
            <span className="v">{policy.reversibleEncryption ? 'Sí' : 'No'}</span>
          </div>
        )}
      </div>
    </Modal>
  )
}

function holder(host?: string): string {
  return host || '—'
}
