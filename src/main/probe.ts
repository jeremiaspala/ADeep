import { app } from 'electron'
import { join } from 'node:path'
import { AdConnection } from './ldap/connection'
import * as store from './store'

async function main(): Promise<void> {
  app.setName('adeep')
  app.setPath('userData', join(app.getPath('appData'), 'adeep'))
  app.disableHardwareAcceleration()
  await app.whenReady()
  const p = (await store.getProfiles())[0]
  const conn = await AdConnection.connect(p, (await store.getSecret(p.id))!)
  const base = conn.baseDN, cfg = conn.configDN

  const show = async (label: string, dn: string, filter: string, attrs: string[], limit = 6): Promise<void> => {
    try {
      const r = await conn.searchRaw(dn, { scope: 'sub', filter, attributes: attrs, sizeLimit: 300 })
      console.log(`\n### ${label}: ${r.length}`)
      for (const e of r.slice(0, limit)) {
        console.log('  •', e.dn.split(',').slice(0, 2).join(','))
        for (const a of attrs) {
          const key = Object.keys(e.attrs).find(k => k.toLowerCase() === a.toLowerCase())
          if (!key) continue
          const v = e.attrs[key].map(x => Buffer.isBuffer(x) ? `<${x.length}B ${x.subarray(0,12).toString('hex')}>` : String(x)).join(' | ')
          if (v) console.log(`      ${a} = ${v.slice(0, 150)}`)
        }
      }
    } catch (e) { console.log(`\n### ${label}: ERROR ${(e as Error).message}`) }
  }

  console.log('### namingContexts'); for (const nc of conn.rootDSE.namingContexts) console.log('   ', nc)

  await show('GPOs', `CN=Policies,CN=System,${base}`, '(objectClass=groupPolicyContainer)',
    ['displayName', 'gPCFileSysPath', 'versionNumber', 'flags', 'gPCMachineExtensionNames', 'whenChanged'], 8)
  await show('Vínculos gPLink', base, '(gPLink=*)', ['name', 'gPLink', 'gPOptions'], 10)
  await show('Filtros WMI', `CN=SOM,CN=WMIPolicy,CN=System,${base}`, '(objectClass=msWMI-Som)', ['msWMI-Name', 'msWMI-Parm2'], 4)
  await show('Plantillas de certificado', `CN=Certificate Templates,CN=Public Key Services,CN=Services,${cfg}`,
    '(objectClass=pKICertificateTemplate)',
    ['displayName', 'msPKI-Certificate-Name-Flag', 'msPKI-Enrollment-Flag', 'pKIExtendedKeyUsage', 'msPKI-RA-Signature', 'msPKI-Template-Schema-Version', 'revision'], 6)
  await show('Entidades emisoras', `CN=Enrollment Services,CN=Public Key Services,CN=Services,${cfg}`,
    '(objectClass=pKIEnrollmentService)', ['displayName', 'dNSHostName', 'certificateTemplates', 'cACertificateDN'], 4)
  await show('CAs raíz', `CN=Certification Authorities,CN=Public Key Services,CN=Services,${cfg}`,
    '(objectClass=certificationAuthority)', ['cn', 'cACertificate'], 4)
  await show('NTAuth', `CN=Public Key Services,CN=Services,${cfg}`, '(cn=NTAuthCertificates)', ['cn', 'cACertificate'], 2)

  await conn.disconnect()
  app.exit(0)
}
main().catch(e => { console.error('FATAL', e); app.exit(1) })
