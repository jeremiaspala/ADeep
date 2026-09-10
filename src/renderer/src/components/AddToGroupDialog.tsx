import { useState, type JSX } from 'react'
import type { DirEntry } from '@shared/types'
import Picker from './Picker'
import { useApp } from '../store'
import { refresh } from '../lib/treeActions'

const KINDS = ['group'] as const

export default function AddToGroupDialog({
  dns,
  onClose
}: {
  dns: string[]
  onClose: () => void
}): JSX.Element {
  const toast = useApp((s) => s.toast)
  const [busy, setBusy] = useState(false)

  const add = async (groups: DirEntry[]): Promise<void> => {
    if (busy) return
    setBusy(true)
    const groupDNs = groups.map((g) => g.dn)
    let ok = 0
    let lastError = ''
    for (const dn of dns) {
      const res = await window.adeep.group.addTo(dn, groupDNs)
      if (res.ok) ok++
      else lastError = res.error ?? ''
    }
    setBusy(false)
    onClose()
    if (ok) toast('ok', `${ok} objeto(s) agregado(s) a ${groupDNs.length} grupo(s)`)
    if (ok < dns.length) toast('error', lastError || 'No se pudieron agregar todos los objetos')
    void refresh()
  }

  return (
    <Picker
      title={dns.length === 1 ? 'Agregar a un grupo' : `Agregar ${dns.length} objetos a un grupo`}
      kinds={[...KINDS]}
      onCancel={onClose}
      onConfirm={(groups) => void add(groups)}
    />
  )
}
