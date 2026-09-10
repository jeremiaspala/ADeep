import type { MenuItemDef } from '../components/ui'

/** Las consolas de la suite, en el orden en que se muestran en el menú. */
export const CONSOLE_LABELS: Record<string, string> = {
  aduc: 'Usuarios y equipos',
  sites: 'Sitios y servicios',
  trusts: 'Dominios y confianzas',
  dfs: 'Administración de DFS',
  dns: 'DNS',
  dhcp: 'DHCP'
}

/**
 * Menú «Consolas»: abre cualquier otra consola en su propia ventana. Comparten
 * proceso y sesión LDAP, así que no vuelve a pedir credenciales.
 */
export function consolesMenu(actual: string): MenuItemDef[] {
  return Object.entries(CONSOLE_LABELS).map(([id, label]) => ({
    id,
    label,
    checked: id === actual,
    disabled: id === actual,
    onSelect: () => void window.adeep.app.openConsole(id)
  }))
}
