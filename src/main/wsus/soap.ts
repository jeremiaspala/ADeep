/**
 * Cliente SOAP de MS-WSUSAR: el servicio ApiRemoting30 que usa la consola de WSUS
 * para administrar el servidor a distancia. Casi todo es «ExecuteSP*»: el
 * servicio corre un procedimiento almacenado de SUSDB y devuelve las filas como
 * arreglos de valores posicionales (GenericReadableRow).
 */
import { NtlmHttpClient, HttpError, type HttpTarget } from './http'
import type { NtlmCredentials } from './ntlm'
import { child, children, escapeXml, find, parseXml, type XmlNode } from './xml'

export const NS = 'http://www.microsoft.com/SoftwareDistribution/Server/ApiRemotingWebService'
const PATH = '/ApiRemoting30/WebService.asmx'

export type Cell = string | number | boolean | null
export type Row = Cell[]

/** Valor de un parámetro: los arreglos se serializan con el nombre de elemento indicado. */
export type Param =
  | string | number | boolean | null | undefined | Date
  | { items: (string | number)[]; tag: string }
  | { xml: string }

export class SoapFault extends Error {}

export class WsusSoapClient {
  private http: NtlmHttpClient

  constructor(readonly target: HttpTarget, cred: NtlmCredentials) {
    this.http = new NtlmHttpClient(target, cred)
  }

  close(): void {
    this.http.close()
  }

  async call(method: string, params: [string, Param][] = []): Promise<XmlNode | undefined> {
    const body = params.map(([k, v]) => serialize(k, v)).join('')
    const envelope =
      '<?xml version="1.0" encoding="utf-8"?>' +
      '<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/" ' +
      'xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema">' +
      `<soap:Body><${method} xmlns="${NS}">${body}</${method}></soap:Body></soap:Envelope>`

    const res = await this.http.request('POST', PATH, {
      'Content-Type': 'text/xml; charset=utf-8',
      SOAPAction: `"${NS}/${method}"`
    }, Buffer.from(envelope, 'utf8'))

    const text = res.body.toString('utf8')
    const doc = text.trimStart().startsWith('<') ? parseXml(text) : undefined
    const fault = find(doc, 'Fault')
    if (fault) throw new SoapFault(faultMessage(fault, method))
    if (res.status >= 400) {
      if (res.status === 403) throw new HttpError('El usuario no tiene permiso para administrar este servidor WSUS.', 403)
      throw new HttpError(`${method}: HTTP ${res.status}`, res.status)
    }
    const resp = find(doc, `${method}Response`)
    return resp ? resp.children.find((c) => c.name === `${method}Result`) ?? resp : undefined
  }

  /** Resultado escalar (string, int, bool). */
  async scalar(method: string, params: [string, Param][] = []): Promise<string | undefined> {
    const r = await this.call(method, params)
    return r && r.attrs.nil !== 'true' ? r.text : undefined
  }

  /** ArrayOfGenericReadableRow → filas. */
  async rows(method: string, params: [string, Param][] = []): Promise<Row[]> {
    return readRows(await this.call(method, params))
  }

  /** ArrayOfArrayOfGenericReadableRow → varios conjuntos de filas. */
  async rowSets(method: string, params: [string, Param][] = []): Promise<Row[][]> {
    const r = await this.call(method, params)
    return children(r, 'ArrayOfGenericReadableRow').map(readRows)
  }
}

export function readRows(node: XmlNode | undefined): Row[] {
  return children(node, 'GenericReadableRow').map((row) =>
    children(child(row, 'Values'), 'anyType').map(cell)
  )
}

/** Un GenericReadableRow suelto (los Deploy* y CreateTargetGroup* devuelven uno solo). */
export function readRow(node: XmlNode | undefined): Row {
  return children(child(node, 'Values'), 'anyType').map(cell)
}

function cell(n: XmlNode): Cell {
  if (n.attrs.nil === 'true') return null
  const type = (n.attrs.type ?? '').replace(/^.*:/, '')
  switch (type) {
    case 'int': case 'long': case 'short': case 'unsignedByte': case 'byte':
    case 'double': case 'float': case 'decimal': case 'unsignedInt':
      return Number(n.text)
    case 'boolean':
      return n.text === 'true'
    default:
      return n.text
  }
}

function serialize(name: string, v: Param): string {
  if (v === undefined) return ''
  if (v === null) return `<${name} xsi:nil="true"/>`
  if (v instanceof Date) return `<${name}>${v.toISOString()}</${name}>`
  if (typeof v === 'object') {
    if ('xml' in v) return `<${name}>${v.xml}</${name}>`
    return `<${name}>${v.items.map((i) => `<${v.tag}>${escapeXml(String(i))}</${v.tag}>`).join('')}</${name}>`
  }
  return `<${name}>${escapeXml(String(v))}</${name}>`
}

function faultMessage(fault: XmlNode, method: string): string {
  const s = (find(fault, 'faultstring')?.text ?? find(fault, 'Text')?.text ?? '').trim()
  // El servicio envuelve la excepción de .NET: el mensaje útil va después de la última «--->».
  const inner = s.split('--->').pop()?.trim() ?? s
  const clean = inner.replace(/^System\.[\w.]+Exception:\s*/, '').split('\n')[0].trim()
  if (/UnauthorizedAccess|Access is denied|acceso denegado/i.test(s)) {
    return 'El usuario no tiene permiso para esta operación en el servidor WSUS.'
  }
  return clean ? `${method}: ${clean}` : `${method}: el servidor devolvió un error.`
}
