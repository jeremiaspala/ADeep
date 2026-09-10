# ADeep — plan de trabajo

> Documento de continuidad. Si retomás la sesión sin contexto previo, **leé esto primero**
> y seguí por la fase que esté marcada como en curso.
> Última actualización: 2026-09-10 (fases 0 a 3 terminadas).

---

## 1. Estado real del proyecto

### Qué está hecho

**Backend (`src/main/`) — completo y compilando.** `ldap/connection.ts` (bind, StartTLS/LDAPS,
paginación), `ldap/directory.ts` (RawEntry → DirEntry, clasificación de objetos),
`ldap/operations.ts` (alta/baja/modificación de usuarios, grupos, OUs, equipos, contactos,
contraseñas, UAC, membresías, FSMO, DCs, política de contraseñas), `ldap/sddl.ts`
(parser/serializador de `nTSecurityDescriptor`), `ldap/encoding.ts` (SID, GUID, FILETIME, DN),
`ldap/controls.ts` (SDFlags, TreeDelete, ShowDeleted), `ipc.ts` (~60 canales), `store.ts`
(perfiles + `safeStorage`).

**Renderer (`src/renderer/`) — consola ADUC completa a nivel UI.** Shell (menubar, toolbar,
árbol, lista, statusbar), diálogos de conexión, nuevo objeto (usuario con wizard, grupo, OU,
equipo, contacto), propiedades con 10 pestañas, editor de atributos, editor de ACLs, selector
de objetos, buscador con presets y consultas guardadas, mover, restablecer contraseña,
preferencias, columnas, info del dominio.

**Empaquetado.** `electron-builder.yml` + `scripts/appimage-postbuild.mjs` →
`release/ADeep-0.1.0-x86_64.AppImage` que arranca en distros con sólo FUSE 3.

### Estado de la validación

`npm run validate` corre 40 verificaciones **de sólo lectura** contra el DC del perfil
guardado — se puede ejecutar sin riesgo en producción. Al 2026-09-10, 40/40 en verde contra
`dc01.ejemplo.local` (dominio real, 634 usuarios, 378 equipos, 4 DC).

`npm run uitest` abre las cuatro consolas, se conecta con el perfil guardado y captura la
pantalla de cada una. También sólo lectura.

Lo que la validación **no** cubre: ninguna operación de escritura se ejecutó nunca contra un
dominio real (crear, borrar, mover, cambiar contraseñas, escribir ACLs). Antes de usar esas
funciones en producción hay que probarlas en un lab.

### Qué NO estaba probado — histórico

**Ninguna operación LDAP se había ejecutado contra un DC real hasta la Fase 0.** Lo verificado es:
`npm run typecheck` limpio, `npm run build` limpio, el AppImage levanta y renderiza el diálogo
de conexión. Todo lo que pasa después del bind es **código sin ejercitar**. Los puntos con más
probabilidad de fallar en el primer contacto con un dominio real:

1. `security.write` — reescribe el descriptor completo. **Probar primero en un objeto
   descartable de un lab**, nunca en producción.
2. `create.copyUser` — copia membresías y atributos del original.
3. `obj.setCannotChangePassword` — manipula ACEs de `User-Change-Password` (dos ACEs: SELF y
   Everyone).
4. `obj.protect.set` — ACE de denegación de Delete/DeleteTree.
5. Paginación y `sizeLimit` en contenedores con más de 1000 objetos.
6. `search.run` con `includeDeleted` (control ShowDeleted + base `CN=Deleted Objects`).
7. Escrituras de contraseña: exigen canal cifrado; el código lo valida pero nunca se probó el
   `unicodePwd` real.

La Fase 0 encontró y corrigió cuatro bugs reales con esa pasada (ver el historial de git).
**Sigue pendiente probar las escrituras en un lab.**

### Deuda pendiente de la consola ADUC

API del backend que existe y la UI todavía no usa:

| Canal | Falta |
|---|---|
| `security.schemaObjects` | Asistente **Delegar control** (clases + derechos extendidos ya se leen del esquema) |
| `obj.renameUser` | Renombrar usuario con cn/sAMAccountName/UPN a la vez (hoy sólo se renombra el RDN) |
| `obj.changePassword` | Cambio de contraseña por el propio usuario (delete+add de `unicodePwd`) |
| `group.memberOfRecursive` | Pestaña de membresías efectivas (`LDAP_MATCHING_RULE_IN_CHAIN`) |
| `search.bySid` / `search.byGuid` | Ir a objeto por SID/GUID desde el editor de ACLs |
| `session.wellKnownContainers` | Accesos directos a Users/Computers/DCs en el árbol |
| `dir.hasChildren` | Twisty del árbol correcto (hoy se muestra por `isContainer`) |

Preferencias declaradas pero sin efecto: `showUsersGroupsAsContainers`, `language`
(la UI está fija en español), `confirmDelete` sólo aplica al borrado múltiple.
`ViewMode.type === 'query'` está en el tipo pero nunca se usa (las consultas guardadas se
muestran como `results`).

Funcionalidad de ADUC que falta del todo: gMSA/MSA, impresoras y carpetas compartidas
publicadas, Papelera de AD (restaurar objetos borrados), mover con arrastrar y soltar,
`Enviar correo`, RSAT-like "Buscar" desde el árbol contextual.

---

## 2. Arquitectura: consolas separadas

Decisión de Jeremías (2026-09-10): **consolas separadas, no un selector dentro de una ventana**,
con el mismo sistema de diseño. Se implementó como en MMC:

- Una ventana por consola, cada una con su propio documento HTML y su punto de entrada
  (`src/renderer/{index,sites,trusts,dfs}.html` + `src/renderer/src/main-*.tsx`).
- `src/main/windows.ts` abre y trae al frente cada ventana; `--console=<id>` en la línea de
  comandos abre una consola concreta, y una segunda ejecución reusa la instancia que ya corre.
- **Una sola sesión LDAP** para todas: la conexión vive en el proceso principal y los cambios
  se difunden con `session.changed`, así que conectarse en una consola conecta a todas.
- El aspecto común sale de `src/renderer/src/shell/`: `ConsoleShell` (menús, toolbar, árbol,
  lista, barra de estado), `SimpleTree`, `DetailList` y `ScheduleEditor`, más el CSS compartido.
- Empaquetado: **un** AppImage y un lanzador `.desktop` por consola
  (`release/launchers/`, con `instalar-lanzadores.sh`). Cuatro AppImages de 94 MB casi idénticos
  no aportan nada; si se quisieran, alcanza con repetir el empaquetado cambiando `productName`.

ADUC conserva su `App.tsx` histórico (árbol LDAP perezoso, paginación, menús propios) y todavía
no usa `ConsoleShell`; comparte el CSS y los diálogos. Migrarlo es deuda técnica, no urgente.

## 2 bis. Alternativa descartada

Se evaluó una sola ventana con un selector de consola y un contrato `ConsoleDef` común
(árbol, lista, columnas y menús servidos por la consola activa). Se descartó por pedido
explícito: las consolas van separadas, como los complementos de MMC. La idea del contrato
sobrevive en `shell/` pero como componentes que cada consola compone a mano, no como un
registro central.

---

## 3. Fases

### Fase 0 — Validación  ✅ terminada

- [x] Arnés `npm run validate`: 40 verificaciones de sólo lectura contra el dominio real.
- [x] **Bug crítico corregido:** los filtros LDAP con valores binarios se armaban como texto
      con escapes `\XX` y ldapts los serializa en UTF-8, así que todo byte ≥ 0x80 se rompía
      (`0xd7` → `0xc3 0x97`). Fallaban en silencio `search.bySid`, `search.byGuid`, la
      resolución de nombres del editor de ACLs y el grupo principal. Ahora se arman con
      `EqualityFilter` + Buffer (`src/main/ldap/filters.ts`).
- [x] `getWellKnownContainers` devolvía GUIDs en vez de nombres; tres GUID well-known estaban
      mal o faltaban.
- [x] Configuration y Schema se clasificaban como particiones de aplicación.
- [x] `pKT`, `invocationId`, `msDS-TrustForestTrustInfo` y los `msDFS-*v2` no estaban en la
      lista de atributos binarios: llegaban corrompidos.
- [x] Round-trip del descriptor de seguridad verificado sobre los **14 848 objetos** del
      dominio: sin pérdida semántica (la diferencia de bytes es relleno del DC).
- [x] Shell compartido (`src/renderer/src/shell/`) y ventanas por consola.
- [ ] Pendiente: probar las **escrituras** en un lab.
- [ ] Pendiente: migrar ADUC a `ConsoleShell`.

### Fase 1 — Sitios y servicios de Active Directory  ✅ terminada

Todo vive bajo `CN=Sites,CN=Configuration,<rootDomainNamingContext>`. Es 100% LDAP: la fase
más directa de las cuatro.

**Árbol:** Sites → `<sitio>` → Servers → `<servidor>` → NTDS Settings; más
`CN=Subnets` y `CN=Inter-Site Transports` (IP / SMTP).

| Objeto | objectClass | Atributos clave |
|---|---|---|
| Sitio | `site` | `description`, `location`, `gPLink` |
| Subred | `subnet` | `siteObject`, `location`, `description` (RDN = `10.0.0.0/24`) |
| Vínculo | `siteLink` | `siteList`, `cost`, `replInterval`, `schedule`, `options` (bit 1 = notificación) |
| Puente | `siteLinkBridge` | `siteLinkList` |
| Servidor | `server` | `dNSHostName`, `serverReference`, `bridgeheadTransportList` |
| NTDS Settings | `nTDSDSA` | `options` (bit 1 = GC), `hasMasterNCs`, `msDS-HasFullReplicaNCs`, `invocationId` |
| Conexión | `nTDSConnection` | `fromServer`, `enabledConnection`, `options`, `schedule` |
| Config. del sitio | `nTDSSiteSettings` | `options` (bit 1 = KCC intra-sitio off, bit 16 = inter-sitio off), `interSiteTopologyGenerator` |

- [x] Lectura del árbol completo + lista con columnas propias.
- [x] Alta/baja de sitios, subredes (con validación de CIDR) y vínculos (coste, intervalo, notificación, compresión). Puentes: pendiente.
- [x] Mover servidor entre sitios.
- [x] Marcar/desmarcar catálogo global.
- [x] Ver conexiones del KCC, habilitarlas y deshabilitarlas; crear conexiones manuales por IPC.
- [x] Editor de `schedule` (188 bytes) con arrastre, reutilizado en DFS-R. Round-trip verificado.
- [x] Acciones sobre rootDSE (MS-ADTS 3.1.1.3.3):
      `replicateSingleObject`, `schemaUpdateNow`, `doGarbageCollection`, `invalidateRidPool`.
      **Limitación conocida:** "Replicar ahora" completo es DRSUAPI (RPC), no LDAP; con
      `replicateSingleObject` se cubre el caso puntual, no la sincronización de un NC entero.

### Fase 2 — Dominios y confianzas de Active Directory  ✅ terminada

**Confianzas:** `CN=System,<defaultNamingContext>`, objetos `trustedDomain`.

| Atributo | Contenido |
|---|---|
| `trustPartner`, `flatName` | FQDN y NetBIOS del dominio par |
| `trustDirection` | 1 entrante, 2 saliente, 3 bidireccional |
| `trustType` | 1 NT/downlevel, 2 AD/uplevel, 3 MIT Kerberos, 4 DCE |
| `trustAttributes` | 0x1 no transitiva, 0x2 sólo uplevel, 0x4 filtrado de SID, 0x8 transitiva de bosque, 0x10 entre organizaciones, 0x20 dentro del bosque, 0x40 tratar como externa, 0x200 PIM |
| `securityIdentifier` | SID del dominio par |
| `msDS-TrustForestTrustInfo` | blob con los espacios de nombres de la confianza de bosque (MS-ADTS 6.1.6.9.3) — hay que parsearlo |
| `msDS-SupportedEncryptionTypes` | tipos de cifrado Kerberos |

**Dominios del bosque y sufijos UPN:** `CN=Partitions,CN=Configuration,…` → objetos
`crossRef` (`nCName`, `dnsRoot`, `nETBIOSName`, `msDS-Behavior-Version`) y el atributo
`uPNSuffixes` del propio contenedor Partitions.

- [x] Vista de dominios del bosque con nivel funcional por dominio y del bosque.
- [x] Lista de confianzas con dirección, tipo y atributos decodificados (0 en este dominio: código ejercitado pero sin datos reales).
- [x] Editar filtrado de SID, autenticación selectiva y tipos de cifrado.
- [x] ABM de sufijos UPN alternativos. Falta integrarlo con el combo del alta de usuario de ADUC.
- [x] Elevar nivel funcional de dominio y de bosque, con confirmación escrita y el máximo que soportan los DC.
- [x] **Limitación documentada en la UI:** crear, validar o restablecer una confianza requiere
      LSA RPC (MS-LSAD). Sólo se administra lo que vive en el directorio; para lo demás,
      mostrar el comando `netdom`/`New-ADTrust` equivalente y que el usuario lo corra.

### Fase 3 — Administración de DFS  ✅ terminada

**Espacios de nombres basados en dominio (v2, modo Windows 2008+)** —
`CN=DfsRoots,CN=Dfs-Configuration,CN=System,<dominio>`:

| Objeto | Atributos |
|---|---|
| `msDFS-NamespaceAnchor` | ancla del espacio de nombres |
| `msDFS-Namespacev2` | `msDFS-Propertiesv2`, `msDFS-Ttlv2`, `msDFS-TargetListv2` |
| `msDFS-Linkv2` | `msDFS-LinkPathv2`, `msDFS-TargetListv2`, `msDFS-Commentv2`, `msDFS-Ttlv2`, `msDFS-ShortNameLinkPathv2` |

`msDFS-TargetListv2` es un blob XML en UTF-8 con la lista de destinos (`<targets><target …>`):
hay que escribir parser y serializador (MS-DFSNM 2.3.3).

**Namespaces v1 (standalone / modo 2000):** objeto `fTDfs` con el blob binario `pKT` —
formato mucho más incómodo. **Alcance sugerido: sólo lectura en v1.**

**Replicación DFS:** `CN=DFSR-GlobalSettings,CN=System,<dominio>` →
`msDFSR-ReplicationGroup` → `msDFSR-Content`/`msDFSR-ContentSet`, `msDFSR-Topology` →
`msDFSR-Member`/`msDFSR-Connection`, y por miembro `msDFSR-Subscriber`/`msDFSR-Subscription`
(`msDFSR-RootPath`, `msDFSR-StagingPath`, `msDFSR-Enabled`, `msDFSR-ReadOnly`,
`msDFSR-ConflictPath`).

- [x] Árbol de espacios de nombres (v1 y v2) con carpetas y destinos.
- [x] Parser + serializador de `msDFS-TargetListv2`, y **parser del blob `pKT` de v1**, verificado contra los tres espacios de nombres del dominio (raíz, vínculos, destinos y estado en línea).
- [x] ABM de carpetas y destinos en v2; v1 en sólo lectura, con aviso en la UI.
- [x] Grupos de replicación: miembros, rutas replicadas y de staging, conexiones, programación.
- [x] **Limitación documentada en la UI:** crear un espacio de nombres nuevo es MS-DFSNM (RPC contra el servidor).
      Editar los que ya existen sí es LDAP. Los servidores releen AD por sondeo (hasta 1 h),
      así que hay que avisar que el cambio no es inmediato.

### Fase 4 — Consola de administración de DHCP

**Este es el único que no se resuelve con LDAP y necesita una decisión de arquitectura.**
En AD sólo vive la lista de servidores autorizados:
`CN=NetServices,CN=Services,CN=Configuration,…`, objeto `dHCPClass`, atributo `dhcpServers`.
Ámbitos, reservas, concesiones y opciones viven en el servidor, no en el directorio.

Opciones de transporte:

| Vía | Qué implica | Veredicto |
|---|---|---|
| **A. WinRM / PowerShell remoting** (`Get-DhcpServerv4Scope`, `Add-DhcpServerv4Reservation`, …) | Cliente WS-Man sobre HTTP(S) + autenticación NTLM o Kerberos. Se puede hacer en Node; hay que resolver NTLM a mano o meter dependencia. | **Recomendado para DHCP de Windows** |
| **B. MS-DHCPM (RPC/DCOM nativo)** | DCE/RPC + marshalling NDR + SPNEGO. Semanas de trabajo, alto riesgo. | Descartado |
| **C. SSH + `netsh dhcp`** | Requiere OpenSSH en el DC; parseo de texto frágil. | Plan B de A |
| **D. ISC Kea vía API REST** (control-agent, JSON) o `dhcpd` + OMAPI | Trivial comparado con el resto, si el DHCP corre en Linux. | **Recomendado si el DHCP es Kea/ISC** |

- [ ] **DECISIÓN PENDIENTE — preguntar antes de codear: ¿el DHCP a administrar es el de
      Windows Server o uno Linux (ISC dhcpd / Kea)?** El resto de la fase depende de esto.
- [ ] Autorizar / desautorizar servidores DHCP en AD (esto sí es LDAP y se puede hacer ya,
      independiente de la decisión anterior).
- [ ] Transporte elegido, con perfil de conexión propio (host, credenciales, puerto).
- [ ] Árbol: servidor → IPv4/IPv6 → ámbitos → (conjunto de direcciones, concesiones,
      reservas, opciones), superámbitos, directivas, filtros MAC.
- [ ] ABM de ámbitos, exclusiones y reservas; edición de opciones (003 router, 006 DNS,
      015 dominio, 042 NTP, 066/067 arranque PXE).
- [ ] Vista de concesiones con filtro y conversión de concesión en reserva.
- [ ] Estadísticas por ámbito (uso, disponibles) y estado de conmutación por error (failover).

---

## 3 bis. Consumo de recursos (medido el 2026-09-10)

Medido con PSS sobre el árbol de procesos, bajo Xvfb (todo por software, así que el proceso
de GPU pesa más que con una placa real):

| | 1 consola | 4 consolas |
|---|---|---|
| Proceso principal (Node + LDAP) | 84 MB | 72 MB |
| Renderer por consola | 88 MB | 53-56 MB c/u |
| Proceso de GPU | 44 MB | 97 MB |
| Zygotes + servicio de red | 52 MB | 43 MB |
| **Total** | **269 MB** | **433 MB** |

Conclusiones:

- El piso de una consola es ~270 MB y cada consola adicional cuesta ~55 MB. Es el precio de
  ventanas separadas: **la palanca real es cerrar las consolas que no se usan.**
- Apagar la composición por GPU ahorra 14-19 MB de forma reproducible. Viene apagada por
  defecto y se puede volver a prender en Preferencias (requiere reiniciar).
- **Probado y descartado:** `--in-process-gpu` elimina el proceso de GPU pero mueve sus ~98 MB
  al proceso principal, con un total igual o peor. `--renderer-process-limit=1` no consolida
  nada: Electron le da un renderer propio a cada ventana igual.
- Las caches de resolución del directorio (SID → nombre, GUID → clase) tienen techo
  (5000 y 3000 entradas) para que una sesión larga no crezca sin control.

## 4. Convenciones del proyecto

- **UI y mensajes de error en español rioplatense.** Los identificadores del código, en inglés.
- Comentarios sólo cuando el *porqué* no sea obvio; nada de comentarios que narran el *qué*.
- Todo canal IPC devuelve `AppResult<T>`; el renderer lo pasa por `report()` de
  `renderer/src/store.ts` para el toast de error.
- Los tipos compartidos van en `src/shared/`. El renderer no importa nada de `src/main/`
  (el `tsconfig.web.json` sólo ve `renderer`, `preload/*.d.ts` y `shared`).
- Alias: `@/` → `renderer/src`, `@shared/` → `src/shared` (declarados en los dos tsconfig
  **y** en `electron.vite.config.ts`; si falta en el vite config, el build rompe aunque el
  typecheck pase).
- CSS: variables de `styles/global.css`, clases de `styles/app.css`. No inventar paletas
  nuevas ni meter librerías de estilos.
- Nada de dependencias nuevas sin motivo fuerte. Runtime hoy: `ldapts` y los toolkit de
  Electron; el resto es devDependency.

## 5. Cómo verificar

```bash
npm run typecheck                 # los dos proyectos, node y web
npm run validate                  # 40 verificaciones de sólo lectura contra el DC del perfil
npm run uitest                    # abre las 4 consolas, conecta y captura pantallas
npm run build                     # electron-vite
npm run dist                      # + electron-builder + repack del AppImage

# Captura de pantalla sin sesión gráfica:
xvfb-run -a --server-args="-screen 0 1280x800x24" bash -c \
  './release/linux-unpacked/adeep --no-sandbox & sleep 12; import -window root /tmp/shot.png; pkill -f linux-unpacked/adeep'
```

**Al terminar de probar, limpiar siempre** (si no, quedan Electron y Xvfb comiendo la máquina):

```bash
pkill -f '\.mount_ADeep' ; pkill -f 'linux-unpacked/adeep' ; pkill Xvfb
rm -rf /tmp/xvfb-run.* /tmp/appimage_extracted_*
```

## 6. Notas del entorno

- La máquina tiene **FUSE 3 y no libfuse2**. El runtime que embebe electron-builder 25 es de
  2019 y pide `libfuse.so.2`: por eso existe `scripts/appimage-postbuild.mjs`, que reemplaza el
  runtime por el estático de type2-runtime y parchea `AppRun` para pasar siempre
  `--no-sandbox` (el montaje FUSE es `nosuid`, así que `chrome-sandbox` nunca puede ser setuid).
  **No borrar ese script pensando que es un parche temporal.**
- `electron-builder.yml` usa la sintaxis de la v25: `linux.desktop` es un **mapa plano**.
  La forma anidada `desktop: { entry: {...} }` es de la v26 y escribe `entry=[object Object]`.
- El proyecto **no es un repositorio git**. Si se va a trabajar en serio en varias consolas,
  `git init` primero.
