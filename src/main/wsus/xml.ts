/**
 * Lo mínimo de XML para SOAP: un parser de árbol que descarta los prefijos de
 * espacio de nombres (las respuestas de WSUS no repiten nombres locales entre
 * espacios distintos) y un escape para armar los sobres.
 */

export interface XmlNode {
  name: string
  attrs: Record<string, string>
  children: XmlNode[]
  text: string
}

const ENTITIES: Record<string, string> = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" }

function decode(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === '#') {
      const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)
      return Number.isFinite(code) ? String.fromCodePoint(code) : m
    }
    return ENTITIES[e.toLowerCase()] ?? m
  })
}

export function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    // Controles fuera de los permitidos por XML 1.0: el servidor rechaza el sobre entero.
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '')
}

const local = (n: string): string => n.slice(n.indexOf(':') + 1)

export function parseXml(src: string): XmlNode {
  const root: XmlNode = { name: '#document', attrs: {}, children: [], text: '' }
  const stack: XmlNode[] = [root]
  let i = 0
  const n = src.length

  while (i < n) {
    const lt = src.indexOf('<', i)
    if (lt < 0) break
    if (lt > i) stack[stack.length - 1].text += decode(src.slice(i, lt))

    if (src.startsWith('<!--', lt)) {
      i = src.indexOf('-->', lt) + 3
      if (i < 3) break
      continue
    }
    if (src.startsWith('<![CDATA[', lt)) {
      const end = src.indexOf(']]>', lt)
      stack[stack.length - 1].text += src.slice(lt + 9, end)
      i = end + 3
      continue
    }
    if (src[lt + 1] === '?' || src[lt + 1] === '!') {
      i = src.indexOf('>', lt) + 1
      continue
    }

    const gt = findTagEnd(src, lt)
    const raw = src.slice(lt + 1, gt)
    i = gt + 1

    if (raw[0] === '/') {
      if (stack.length > 1) stack.pop()
      continue
    }

    const selfClosing = raw.endsWith('/')
    const body = selfClosing ? raw.slice(0, -1) : raw
    const m = /^\s*([^\s/>]+)/.exec(body)
    if (!m) continue
    const node: XmlNode = { name: local(m[1]), attrs: {}, children: [], text: '' }
    const attrRe = /([^\s=]+)\s*=\s*("([^"]*)"|'([^']*)')/g
    let a: RegExpExecArray | null
    const rest = body.slice(m[0].length)
    while ((a = attrRe.exec(rest))) node.attrs[local(a[1])] = decode(a[3] ?? a[4] ?? '')

    stack[stack.length - 1].children.push(node)
    if (!selfClosing) stack.push(node)
  }
  return root
}

function findTagEnd(src: string, from: number): number {
  let quote: string | null = null
  for (let j = from + 1; j < src.length; j++) {
    const c = src[j]
    if (quote) { if (c === quote) quote = null }
    else if (c === '"' || c === "'") quote = c
    else if (c === '>') return j
  }
  return src.length - 1
}

export function child(node: XmlNode | undefined, name: string): XmlNode | undefined {
  return node?.children.find((c) => c.name === name)
}

export function children(node: XmlNode | undefined, name: string): XmlNode[] {
  return node?.children.filter((c) => c.name === name) ?? []
}

/** Primer descendiente con ese nombre, en profundidad. */
export function find(node: XmlNode | undefined, name: string): XmlNode | undefined {
  if (!node) return undefined
  for (const c of node.children) {
    if (c.name === name) return c
    const f = find(c, name)
    if (f) return f
  }
  return undefined
}

export function textOf(node: XmlNode | undefined, name?: string): string | undefined {
  const n = name ? child(node, name) : node
  if (!n) return undefined
  if (n.attrs.nil === 'true') return undefined
  return n.text
}
