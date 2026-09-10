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

  const { EqualityFilter } = await import('ldapts')
  const r = await conn.searchRaw(conn.baseDN, {
    scope: 'sub',
    filter: new EqualityFilter({ attribute: 'sAMAccountName', value: 'admin' }),
    attributes: ['distinguishedName', 'cn', 'name', 'displayName', 'givenName', 'sn', 'initials',
                 'sAMAccountName', 'userPrincipalName', 'description', 'whenChanged', 'uSNChanged']
  })
  for (const e of r) {
    console.log('DN:', e.dn)
    for (const [k, v] of Object.entries(e.attrs)) {
      console.log(`   ${k.padEnd(20)} = ${v.map(x => Buffer.isBuffer(x) ? '<bin>' : String(x)).join(' | ')}`)
    }
  }
  await conn.disconnect()
  app.exit(0)
}
main().catch(e => { console.error('FATAL', e); app.exit(1) })
