# ADeep

**Administración de Active Directory para Linux.** Un RSAT hecho de cero: nueve consolas con el
mismo lenguaje visual, sobre LDAP nativo, sin Windows y sin una máquina virtual en el medio.

![Las consolas de ADeep](docs/img/consolas.png)

---

## Las consolas

| | Qué administra |
|---|---|
| **Usuarios y equipos** | Usuarios, grupos, equipos, OUs y contactos. Propiedades con 10 pestañas, editor de atributos, editor de ACLs, buscador con consultas guardadas |
| **Sitios y servicios** | Sitios, subredes, vínculos, catálogo global, conexiones del KCC, programación semanal de replicación |
| **Dominios y confianzas** | Dominios del bosque, particiones, relaciones de confianza, sufijos UPN, niveles funcionales |
| **Administración de DFS** | Espacios de nombres (v1 y v2) y grupos de replicación DFS-R |
| **DNS** | Zonas integradas en el directorio, directas e inversas, con alta, edición y baja de registros |
| **DHCP** | Servidores autorizados en el directorio *(parcial — ver [Límites](#límites-conocidos))* |
| **Editor LDAP** | Acceso crudo a cualquier contexto de nombres: dominio, configuración, esquema y particiones DNS |
| **Directivas de grupo** | Directivas, dónde se aplica cada una, precedencia, herencia y estado |
| **Certificados** | Entidades emisoras, plantillas y revisión de seguridad (ESC1, ESC2, ESC3, ESC9) |

Cada consola abre en su propia ventana, como los complementos de MMC, pero **todas comparten
proceso y una sola sesión LDAP**: te autenticás una vez.

## Instalación

Bajá el AppImage de la [última versión](https://github.com/jeremiaspala/ADeep/releases/latest):

```sh
chmod +x ADeep-*-x86_64.AppImage
./ADeep-*-x86_64.AppImage                    # Usuarios y equipos
./ADeep-*-x86_64.AppImage --console=sites    # Sitios y servicios
./ADeep-*-x86_64.AppImage --console=trusts   # Dominios y confianzas
./ADeep-*-x86_64.AppImage --console=dfs      # DFS
./ADeep-*-x86_64.AppImage --console=dns      # DNS
./ADeep-*-x86_64.AppImage --console=dhcp     # DHCP
./ADeep-*-x86_64.AppImage --console=ldap     # Editor LDAP
./ADeep-*-x86_64.AppImage --console=gpo      # Directivas de grupo
./ADeep-*-x86_64.AppImage --console=adcs     # Certificados
```

Desde cualquier consola, el menú **Consolas** (o el botón de la punta derecha de la barra de
herramientas) abre las otras.

Para tenerlas en el menú del escritorio, bajá los `.desktop`, los `.png` y
`instalar-lanzadores.sh` de la misma release al directorio del AppImage y corré el script:

```sh
./instalar-lanzadores.sh
```

### Requisitos

- Un DC alcanzable por **LDAPS (636)** o **StartTLS (389)**. Sin cifrado, Active Directory
  rechaza cualquier cambio de contraseña.
- El AppImage trae un runtime estático, así que **no hace falta libfuse2**: anda en distros
  que sólo tienen FUSE 3.

## Capturas

### Usuarios y equipos
![Usuarios y equipos](docs/img/aduc.png)

### Sitios y servicios
![Sitios y servicios](docs/img/sites.png)

### DNS
![DNS](docs/img/dns.png)

### Administración de DFS
![DFS](docs/img/dfs.png)

### Directivas de grupo
![Directivas de grupo](docs/img/gpo.png)

### Certificados
![Certificados](docs/img/adcs.png)

### Editor LDAP
![Editor LDAP](docs/img/ldap.png)

### Dominios y confianzas
![Dominios y confianzas](docs/img/trusts.png)

## Cómo está hecho

Electron + React + TypeScript, con [`ldapts`](https://github.com/ldapts/ldapts) como única
dependencia de runtime. Todo el trabajo sucio está resuelto a mano en el proceso principal:

- **`nTSecurityDescriptor`** — parser y serializador de descriptores de seguridad binarios
  (MS-DTYP), para el editor de ACLs.
- **`dnsRecord`** — códec de registros DNS (MS-DNSP), A/AAAA/NS/CNAME/SOA/PTR/MX/TXT/SRV.
- **`pKT`** — parser del blob de metadatos de los espacios de nombres DFS v1 (MS-DFSNM).
- **`schedule`** — bitmap semanal de 7×24 de vínculos, conexiones y DFS-R.
- **`gPLink`** — vínculos de directivas de grupo, que se guardan al revés de la precedencia.
- **`msDS-TrustForestTrustInfo`** — espacios de nombres de una confianza de bosque.
- SIDs, GUIDs, FILETIME, DNs, `userAccountControl`, `groupType` y compañía.

Las nueve consolas comparten proceso y **una sola sesión LDAP**. Eso hace que el refresco entre
ventanas salga barato: cuando una consola escribe, el puente IPC avisa a las demás y cada una
recarga su vista. Sin sondeo — si nadie escribe, no hay tráfico. Los cambios hechos fuera de
ADeep sí necesitan F5.

```
src/
  main/          proceso principal: LDAP y una carpeta por consola
    ldap/        conexión, encoding, SDDL, controles, filtros binarios
    aduc… adcs/  operaciones de cada consola
  preload/       contextBridge → window.adeep, todo devuelve AppResult<T>
  renderer/      una página y un punto de entrada por consola
    shell/       ConsoleShell, SimpleTree, DetailList, ScheduleEditor
    consoles/    la interfaz de cada consola
  shared/        tipos y constantes que ven los dos lados
```

## Desarrollo

```sh
npm install
npm run dev          # electron-vite en modo desarrollo
npm run typecheck    # los dos proyectos, main y renderer
npm run build
npm run dist         # AppImage + lanzadores en release/
```

### Verificación

El proyecto trae arneses que corren la aplicación de verdad contra un dominio real, usando el
perfil guardado. **Son de sólo lectura**, para poder correrlos sin riesgo:

```sh
npm run validate     # 56 verificaciones de sólo lectura contra el DC del perfil
npm run uitest       # abre las nueve consolas, conecta y captura pantalla
npm run uitest:refresh  # dos consolas: una escribe, la otra recarga sola

npx electron out/main/uitest-audit.js --no-sandbox   # recorre todos los ítems de menú
npx electron out/main/uitest-switch.js --no-sandbox  # verifica el cambio de consola
```

`validate` no se limita a que las funciones no exploten: reconstruye lo que lee y compara
contra el original. El round-trip del descriptor de seguridad se verificó sobre los 14 848
objetos de un dominio real, el códec DNS reconstruyó 726 registros byte a byte y los 57
atributos `gPLink` del dominio volvieron idénticos.

Vale la pena: estos arneses encontraron, entre otras cosas, que los filtros LDAP con valores
binarios se corrompían en silencio (todo byte ≥ 0x80 se convertía en dos), que los submenús no
respondían al clic en ninguna consola, y que las ventanas de la app empaquetada no tenían ícono.

## Límites conocidos

Vale más decirlo que descubrirlo en producción:

- **Las escrituras no se probaron contra un dominio real.** Las lecturas sí, exhaustivamente.
  Crear, borrar, mover, cambiar contraseñas y escribir ACLs funcionan en el papel pero todavía
  no se ejercitaron: probalos en un lab antes de usarlos en serio.
- **DFS v1** (espacios de nombres en modo Windows 2000) es **sólo lectura**: los vínculos viven
  dentro de un blob binario y reescribirlo a ciegas es demasiado riesgo. v2 sí se edita.
- **DHCP está a medias.** De DHCP, Active Directory guarda una sola cosa: la lista de servidores
  autorizados. Ámbitos, concesiones y reservas viven en el servidor y necesitan otro transporte
  (WinRM, MS-DHCPM por RPC, o la API REST de Kea si es Linux). Todavía no está decidido cuál.
- **Crear confianzas** requiere LSA RPC y no se puede por LDAP. Se administran las que ya existen.
- **Crear espacios de nombres DFS** requiere MS-DFSNM por RPC. Se administran los que ya existen.
- **El contenido de las directivas de grupo** vive en SYSVOL, no en el directorio. Desde acá se
  administra dónde se aplican, en qué orden y con qué estado, no qué configuran.
- **Emitir o revocar certificados** es MS-ICPR por RPC. Se administran las plantillas, sus
  permisos y qué entidad emisora publica cada una.
- Los servidores DNS y DFS releen su configuración de AD por sondeo, así que un cambio puede
  tardar en verse.

El plan por fases y las decisiones de arquitectura están en [`docs/ROADMAP.md`](docs/ROADMAP.md);
el historial de lo que se fue haciendo, en [`docs/BITACORA.md`](docs/BITACORA.md).

## Licencia

MIT.

---

<img src="docs/img/fundamenta.svg" width="18" align="absmiddle"> Hecho por **Jeremías Palazzesi**
en [Fundamenta](https://fundamenta.ar) · blog: [nerdadas.com](https://nerdadas.com)
