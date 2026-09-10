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

  const zoneDN = `DC=ejemplo.local,CN=MicrosoftDNS,DC=DomainDnsZones,${base}`
  const z = await conn.searchOne(zoneDN, ['dNSProperty'])
  console.log('### dNSProperty de la zona principal')
  for (const v of z?.attrs.dNSProperty ?? []) {
    if (!Buffer.isBuffer(v)) { console.log('   (no es buffer)'); continue }
    console.log(`   len=${v.length} dataLength=${v.readUInt32LE(0)} id=0x${v.readUInt32LE(16).toString(16)} valor=${v.length >= 24 ? v.readUInt32LE(20) : '-'} hex=${v.toString('hex')}`)
  }
  void cfg
  await conn.disconnect()
  app.exit(0)
}
main().catch(e => { console.error('FATAL', e); app.exit(1) })
