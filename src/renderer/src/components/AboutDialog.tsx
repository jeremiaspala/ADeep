import type { JSX } from 'react'
import { ExternalLink } from 'lucide-react'
import { Modal } from './ui'
import { useApp } from '../store'
import { functionalLevel } from '../lib/format'

/** Isotipo de Fundamenta, inline: la CSP del renderer no permite imágenes remotas. */
function FundamentaLogo({ size = 34 }: { size?: number }): JSX.Element {
  return (
    <svg viewBox="0 0 64 64" width={size} height={size} aria-label="Fundamenta">
      <path d="M32 4 L59 17.5 L32 31 L5 17.5 Z" fill="#1e293b" />
      <path d="M5 28 L32 41.5 L59 28 L59 35.8 L32 49.3 L5 35.8 Z" fill="#64748b" />
      <path d="M5 40 L32 53.5 L59 40 L59 47.8 L32 61.3 L5 47.8 Z" fill="#e01e2e" />
    </svg>
  )
}

function Enlace({ href, children }: { href: string; children: string }): JSX.Element {
  return (
    <button
      className="btn ghost sm"
      style={{ padding: '0 4px', height: 22, color: 'var(--accent-text)' }}
      onClick={() => void window.adeep.app.openExternal(href)}
    >
      {children}
      <ExternalLink size={12} />
    </button>
  )
}

export default function AboutDialog({ onClose }: { onClose: () => void }): JSX.Element {
  const session = useApp((s) => s.session)

  return (
    <Modal
      title="ADeep"
      subtitle="Administración de Active Directory para Linux"
      icon={<FundamentaLogo size={20} />}
      onClose={onClose}
      footer={
        <>
          <div className="spacer" style={{ flex: 1 }} />
          <button className="btn primary" onClick={onClose}>Cerrar</button>
        </>
      }
    >
      <div className="row" style={{ gap: 14, alignItems: 'center', marginBottom: 16 }}>
        <FundamentaLogo size={52} />
        <div>
          <div style={{ fontSize: 15, fontWeight: 700, letterSpacing: '-0.01em' }}>Fundamenta</div>
          <div className="hint" style={{ marginTop: 2 }}>NOC 24/7 y soporte IT para empresas</div>
          <div className="row" style={{ gap: 2, marginTop: 4, marginLeft: -4 }}>
            <Enlace href="https://fundamenta.ar">fundamenta.ar</Enlace>
            <span className="hint">·</span>
            <Enlace href="https://nerdadas.com">nerdadas.com</Enlace>
          </div>
        </div>
      </div>

      <div className="kv">
        <span className="k">Versión</span>
        <span className="v">0.4.0</span>
        <span className="k">Autor</span>
        <span className="v">Jeremías Palazzesi</span>
        <span className="k">Blog</span>
        <span className="v">nerdadas.com</span>
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
        Cliente LDAP nativo para administrar Active Directory sin Windows: usuarios y equipos,
        sitios y servicios, dominios y confianzas, DFS, DNS y DHCP.
      </p>
    </Modal>
  )
}
