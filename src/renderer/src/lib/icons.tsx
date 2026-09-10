import type { JSX } from 'react'
import {
  Building2, Boxes, FolderTree, Folder, FolderCog, User, UserRound, Users,
  Monitor, Contact, Printer, HardDrive, Bot, ShieldQuestion, Trash2, FileQuestion,
  Network
} from 'lucide-react'
import type { NodeKind } from '@shared/types'

export const KIND_LABEL: Record<NodeKind, string> = {
  domain: 'Dominio',
  ou: 'Unidad organizativa',
  container: 'Contenedor',
  builtin: 'builtinDomain',
  user: 'Usuario',
  computer: 'Equipo',
  group: 'Grupo',
  contact: 'Contacto',
  printer: 'Impresora compartida',
  volume: 'Carpeta compartida',
  gmsa: 'Cuenta de servicio administrada de grupo',
  msa: 'Cuenta de servicio administrada',
  inetOrgPerson: 'InetOrgPerson',
  foreignSecurityPrincipal: 'Entidad de seguridad externa',
  lostAndFound: 'lostAndFound',
  unknown: 'Objeto'
}

const COLORS: Record<NodeKind, string> = {
  domain: 'var(--accent)',
  ou: '#e0a53f',
  container: '#c8a24a',
  builtin: '#c8a24a',
  user: '#4f8cff',
  computer: '#5cc2a0',
  group: '#b57ce0',
  contact: '#7cc0e0',
  printer: '#8b95a3',
  volume: '#8b95a3',
  gmsa: '#e07c9e',
  msa: '#e07c9e',
  inetOrgPerson: '#4f8cff',
  foreignSecurityPrincipal: '#8b95a3',
  lostAndFound: '#8b95a3',
  unknown: '#8b95a3'
}

export function KindIcon({
  kind,
  size = 15,
  className
}: {
  kind: NodeKind
  size?: number
  className?: string
}): JSX.Element {
  const props = { size, strokeWidth: 1.9, color: COLORS[kind], className: className ?? 'ico' }
  switch (kind) {
    case 'domain': return <Building2 {...props} />
    case 'ou': return <FolderTree {...props} />
    case 'builtin': return <FolderCog {...props} />
    case 'container': return <Folder {...props} />
    case 'lostAndFound': return <Trash2 {...props} />
    case 'user': return <User {...props} />
    case 'inetOrgPerson': return <UserRound {...props} />
    case 'group': return <Users {...props} />
    case 'computer': return <Monitor {...props} />
    case 'contact': return <Contact {...props} />
    case 'printer': return <Printer {...props} />
    case 'volume': return <HardDrive {...props} />
    case 'gmsa':
    case 'msa': return <Bot {...props} />
    case 'foreignSecurityPrincipal': return <ShieldQuestion {...props} />
    default: return <FileQuestion {...props} />
  }
}

export { Boxes, Network }
