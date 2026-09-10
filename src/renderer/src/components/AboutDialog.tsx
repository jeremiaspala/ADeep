import type { JSX } from 'react'
import { Boxes } from 'lucide-react'
import { Modal } from './ui'
import { useApp } from '../store'
import { functionalLevel } from '../lib/format'

export default function AboutDialog({ onClose }: { onClose: () => void }): JSX.Element {
  const session = useApp((s) => s.session)

  return (
    <Modal
      title="ADeep"
      subtitle="Active Directory Users and Computers para Linux"
      icon={<Boxes size={18} color="var(--accent)" />}
      onClose={onClose}
      footer={
        <>
          <div className="spacer" style={{ flex: 1 }} />
          <button className="btn primary" onClick={onClose}>Cerrar</button>
        </>
      }
    >
      <div className="kv">
        <span className="k">Versión</span>
        <span className="v">0.2.0</span>
        <span className="k">Autor</span>
        <span className="v">Jeremías Palazzesi</span>
        <span className="k">Licencia</span>
        <span className="v">MIT</span>
        {session.connected && (
          <>
            <span className="k">Servidor</span>
            <span className="v mono">{session.rootDSE?.dnsHostName ?? '—'}</span>
            <span className="k">Nivel funcional del dominio</span>
            <span className="v">{functionalLevel(session.rootDSE?.domainFunctionality)}</span>
          </>
        )}
      </div>
      <p className="hint" style={{ marginTop: 14 }}>
        Cliente LDAP nativo para administrar usuarios, grupos, equipos y unidades organizativas
        de Active Directory sin Windows.
      </p>
    </Modal>
  )
}
