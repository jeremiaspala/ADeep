import type { JSX } from 'react'
import {
  Building2, Boxes, FolderTree, Folder, FolderCog, User, UserRound, Users,
  Monitor, Contact, Printer, HardDrive, Bot, ShieldQuestion, Trash2, FileQuestion,
  Network, Globe, Link2, Server, Cpu, Cable, Handshake, TreePine, Share2,
  FolderSymlink, HardDriveDownload, RefreshCcw, GitBranch, Waypoints
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
  sitesRoot: 'Sitios',
  site: 'Sitio',
  subnetsRoot: 'Subredes',
  subnet: 'Subred',
  transportsRoot: 'Transportes entre sitios',
  transport: 'Transporte',
  siteLink: 'Vínculo de sitios',
  siteLinkBridge: 'Puente de vínculos',
  serversRoot: 'Servidores',
  server: 'Servidor',
  ntdsSettings: 'NTDS Settings',
  connection: 'Conexión',
  forest: 'Bosque',
  partition: 'Partición',
  trust: 'Relación de confianza',
  dfsRoot: 'Espacios de nombres',
  dfsNamespace: 'Espacio de nombres',
  dfsFolder: 'Carpeta DFS',
  dfsTarget: 'Destino',
  dfsrRoot: 'Replicación DFS',
  dfsrGroup: 'Grupo de replicación',
  dfsrContent: 'Contenido replicado',
  dfsrMember: 'Miembro',
  dfsrConnection: 'Conexión de replicación',
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
  sitesRoot: 'var(--accent)',
  site: '#5cc2a0',
  subnetsRoot: '#e0a53f',
  subnet: '#e0a53f',
  transportsRoot: '#b57ce0',
  transport: '#b57ce0',
  siteLink: '#b57ce0',
  siteLinkBridge: '#b57ce0',
  serversRoot: '#c8a24a',
  server: '#4f8cff',
  ntdsSettings: '#8b95a3',
  connection: '#7cc0e0',
  forest: '#5cc2a0',
  partition: '#c8a24a',
  trust: '#e0a53f',
  dfsRoot: 'var(--accent)',
  dfsNamespace: '#5cc2a0',
  dfsFolder: '#e0a53f',
  dfsTarget: '#7cc0e0',
  dfsrRoot: '#b57ce0',
  dfsrGroup: '#b57ce0',
  dfsrContent: '#c8a24a',
  dfsrMember: '#4f8cff',
  dfsrConnection: '#7cc0e0',
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
    case 'sitesRoot': return <Network {...props} />
    case 'site': return <Building2 {...props} />
    case 'subnetsRoot':
    case 'subnet': return <Globe {...props} />
    case 'transportsRoot':
    case 'transport': return <Waypoints {...props} />
    case 'siteLink':
    case 'siteLinkBridge': return <Link2 {...props} />
    case 'serversRoot': return <Folder {...props} />
    case 'server': return <Server {...props} />
    case 'ntdsSettings': return <Cpu {...props} />
    case 'connection': return <Cable {...props} />
    case 'forest': return <TreePine {...props} />
    case 'partition': return <GitBranch {...props} />
    case 'trust': return <Handshake {...props} />
    case 'dfsRoot': return <Share2 {...props} />
    case 'dfsNamespace': return <Share2 {...props} />
    case 'dfsFolder': return <FolderSymlink {...props} />
    case 'dfsTarget': return <HardDriveDownload {...props} />
    case 'dfsrRoot':
    case 'dfsrGroup': return <RefreshCcw {...props} />
    case 'dfsrContent': return <Folder {...props} />
    case 'dfsrMember': return <Server {...props} />
    case 'dfsrConnection': return <Cable {...props} />
    default: return <FileQuestion {...props} />
  }
}

export { Boxes, Network }
