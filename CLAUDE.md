# ADeep

Suite de consolas de administración de Active Directory para Linux (Electron + React +
TypeScript, LDAP con `ldapts`). Reemplaza a las MMC de RSAT sin necesidad de Windows.

**Antes de trabajar: leer `docs/ROADMAP.md`.** Ahí está el estado real de cada consola, lo que
está sin probar contra un DC, la deuda pendiente y el plan por fases.

## Estructura

- `src/main/` — proceso principal. `ldap/` es la capa compartida (conexión, encoding, SDDL,
  controles); `ipc.ts` expone ~60 canales; `store.ts` persiste perfiles con `safeStorage`.
- `src/preload/` — `contextBridge` → `window.adeep`. Toda llamada devuelve `AppResult<T>`.
- `src/renderer/` — React. `components/ui.tsx` tiene Modal, MenuPopup, Toasts, Tabs, campos y
  el `ConfirmProvider`.
- `src/shared/` — tipos y constantes que ven los dos lados.

## Reglas

- UI y errores en español rioplatense; identificadores en inglés.
- Comentarios sólo para el *porqué*.
- El renderer nunca importa de `src/main/`; lo común va a `src/shared/`.
- Alias `@/` y `@shared/`: declararlos en los tsconfig **y** en `electron.vite.config.ts`.
- Estilos con las variables de `styles/global.css`; sin librerías de UI nuevas.
- Verificar con `npm run typecheck` y `npm run build` antes de dar algo por terminado.
- Después de probar la app, matar los procesos de prueba (Electron y Xvfb quedan vivos).
