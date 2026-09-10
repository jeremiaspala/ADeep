/**
 * Parser del blob `pKT` de los espacios de nombres DFS v1 (fTDfs).
 *
 * En v1 los vínculos no son objetos de AD: están todos dentro de un blob binario.
 * Layout (MS-DFSNM 2.3.3, verificado contra un dominio real):
 *
 *   DWORD  version
 *   DWORD  elementCount
 *   por elemento:
 *     USHORT nameLen        (bytes, UTF-16LE)  — "\domainroot" o "\domainroot\<guid>"
 *     BYTE   name[nameLen]
 *     DWORD  dataLen
 *     BYTE   data[dataLen]:
 *       BYTE   guid[16]
 *       USHORT prefixLen;      BYTE prefix[]        — "\DOMINIO\Namespace\Carpeta"
 *       USHORT shortPrefixLen; BYTE shortPrefix[]
 *       DWORD  type
 *       DWORD  state
 *       BYTE   timestamps[24]  (prefix, state, comment)
 *       DWORD  version
 *       DWORD  targetListSize
 *       DWORD  targetCount
 *       por destino:
 *         DWORD  entrySize (sin contarse a sí mismo)
 *         BYTE   reserved[8]
 *         DWORD  state          (2 = en línea)
 *         DWORD  type
 *         USHORT serverLen; BYTE server[]
 *         USHORT shareLen;  BYTE share[]
 *
 * Ante cualquier inconsistencia se devuelve lo interpretado hasta ahí con
 * `partial: true`: preferimos mostrar de menos antes que inventar datos.
 */
import { guidToString } from '../ldap/encoding'
import type { DfsTarget } from '../../shared/types'

export interface PktElement {
  /** Nombre interno del elemento: `\domainroot` para la raíz. */
  key: string
  guid?: string
  /** Ruta completa: \DOMINIO\Namespace\Carpeta */
  prefix: string
  shortPrefix: string
  comment?: string
  type: number
  state: number
  targets: DfsTarget[]
  isRoot: boolean
}

export interface PktBlob {
  version: number
  elements: PktElement[]
  partial: boolean
  /** Elementos del blob que no son raíz ni vínculo (p. ej. la tabla de sitios). */
  skipped?: string[]
}

/** `\domainroot` es la raíz; `\domainroot\<guid>` es cada vínculo. */
function isLinkKey(key: string): boolean {
  return key.toLowerCase().startsWith('\\domainroot')
}

const MAX_ELEMENTS = 5000
const MAX_TARGETS = 500

export function parsePkt(buf?: Buffer): PktBlob {
  const result: PktBlob = { version: 0, elements: [], partial: false }
  if (!buf || buf.length < 8) {
    result.partial = !!buf?.length
    return result
  }

  try {
    result.version = buf.readUInt32LE(0)
    const count = buf.readUInt32LE(4)
    if (count > MAX_ELEMENTS) { result.partial = true; return result }

    const skipped: string[] = []
    let p = 8
    for (let i = 0; i < count; i++) {
      if (p + 2 > buf.length) { result.partial = true; break }
      const nameLen = buf.readUInt16LE(p)
      p += 2
      if (p + nameLen + 4 > buf.length) { result.partial = true; break }
      const key = buf.subarray(p, p + nameLen).toString('utf16le')
      p += nameLen

      const dataLen = buf.readUInt32LE(p)
      p += 4
      if (p + dataLen > buf.length) { result.partial = true; break }
      const data = buf.subarray(p, p + dataLen)
      p += dataLen

      const element = parseElement(key, data)
      if (element) result.elements.push(element)
      else if (isLinkKey(key)) result.partial = true
      else skipped.push(key)
    }
    result.skipped = skipped
  } catch (err) {
    if (process.env.ADEEP_DEBUG_PKT) console.error('parsePkt:', err)
    result.partial = true
  }
  return result
}

function parseElement(key: string, d: Buffer): PktElement | null {
  if (d.length < 24) return null
  let q = 0

  const guid = d.length >= 16 ? guidToString(d.subarray(0, 16)) : undefined
  q = 16

  const prefix = readShortString(d, q)
  if (!prefix) return null
  q = prefix.next

  const shortPrefix = readShortString(d, q)
  if (!shortPrefix) return null
  q = shortPrefix.next

  if (q + 8 > d.length) return null
  const type = d.readUInt32LE(q)
  const state = d.readUInt32LE(q + 4)
  q += 8

  const comment = readShortString(d, q)
  if (!comment) return null
  q = comment.next

  // 3 FILETIME (prefix, state, comment) + versión del elemento
  q += 24 + 4
  if (q + 8 > d.length) return null
  const targetListSize = d.readUInt32LE(q)
  q += 4
  if (targetListSize > d.length) return null

  const targets: DfsTarget[] = []
  if (q + 4 <= d.length) {
    const targetCount = d.readUInt32LE(q)
    q += 4
    if (targetCount <= MAX_TARGETS) {
      for (let i = 0; i < targetCount; i++) {
        if (q + 4 > d.length) break
        const entrySize = d.readUInt32LE(q)
        const bodyStart = q + 4
        if (entrySize < 20 || bodyStart + entrySize > d.length) break

        const targetState = d.readUInt32LE(bodyStart + 8)
        const server = readShortString(d, bodyStart + 16)
        const share = server && readShortString(d, server.next)
        if (server && share) {
          targets.push({
            path: `\\\\${server.value}\\${share.value}`,
            server: server.value,
            share: share.value,
            // El estado 2 (DFS_STORAGE_STATE_ONLINE) es el destino habilitado.
            enabled: (targetState & 0x2) !== 0
          })
        }
        q = bodyStart + entrySize
      }
    }
  }

  return {
    key,
    guid,
    prefix: prefix.value,
    shortPrefix: shortPrefix.value,
    comment: comment.value || undefined,
    type,
    state,
    targets,
    isRoot: key.toLowerCase() === '\\domainroot'
  }
}

function readShortString(buf: Buffer, offset: number): { value: string; next: number } | null {
  if (offset + 2 > buf.length) return null
  const len = buf.readUInt16LE(offset)
  const start = offset + 2
  if (len % 2 !== 0 || start + len > buf.length) return null
  return { value: buf.subarray(start, start + len).toString('utf16le'), next: start + len }
}
