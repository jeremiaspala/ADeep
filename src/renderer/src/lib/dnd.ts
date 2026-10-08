import type { DirEntry } from '@shared/types'
import { isDescendant, parentDN, rdnValue } from './format'

// dataTransfer.getData no se puede leer durante dragover; el arrastre en curso vive acá.
let dragging: string[] | null = null

const MIME = 'application/x-adeep-dns'

export function startDrag(e: React.DragEvent, dns: string[]): void {
  dragging = dns
  e.dataTransfer.effectAllowed = 'move'
  e.dataTransfer.setData(MIME, JSON.stringify(dns))
  e.dataTransfer.setData('text/plain', dns.join('\n'))

  const ghost = document.createElement('div')
  ghost.className = 'drag-ghost'
  ghost.textContent = dns.length === 1 ? rdnValue(dns[0]) : `${dns.length} objetos`
  document.body.appendChild(ghost)
  e.dataTransfer.setDragImage(ghost, -12, -4)
  setTimeout(() => ghost.remove(), 0)
}

export function endDrag(): void {
  dragging = null
}

export function draggedDNs(): string[] | null {
  return dragging
}

export function canDropOn(target: DirEntry): boolean {
  if (!dragging?.length || !target.isContainer) return false
  if (dragging.some((d) => isDescendant(target.dn, d))) return false
  const t = target.dn.toLowerCase()
  return dragging.some((d) => parentDN(d).toLowerCase() !== t)
}

/** Handlers de destino para una fila contenedora; `setOver` pinta el resaltado. */
export function dropHandlers(
  target: DirEntry,
  setOver: (dn: string | null) => void,
  onDrop: (dns: string[], target: DirEntry) => void,
  onHover?: () => void
): Pick<React.HTMLAttributes<HTMLElement>, 'onDragOver' | 'onDragEnter' | 'onDragLeave' | 'onDrop'> {
  return {
    onDragEnter: (e) => {
      if (!canDropOn(target)) return
      e.preventDefault()
      setOver(target.dn)
      onHover?.()
    },
    onDragOver: (e) => {
      if (!canDropOn(target)) return
      e.preventDefault()
      e.dataTransfer.dropEffect = 'move'
    },
    onDragLeave: (e) => {
      if ((e.currentTarget as HTMLElement).contains(e.relatedTarget as Node | null)) return
      setOver(null)
    },
    onDrop: (e) => {
      setOver(null)
      const dns = dragging
      if (!dns || !canDropOn(target)) return
      e.preventDefault()
      endDrag()
      onDrop(dns, target)
    }
  }
}
