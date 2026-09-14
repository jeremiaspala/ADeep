# ADeep — RSAT para Linux

**Administrá Active Directory desde Linux, sin Windows y sin una máquina virtual en el medio.**

ADeep es una alternativa nativa a las consolas MMC de **RSAT** (Remote Server Administration
Tools): diez aplicaciones de escritorio que hablan **LDAP** directo contra el controlador de
dominio. Incluye el equivalente a **ADUC** (Active Directory Users and Computers), Sitios y
servicios, Dominios y confianzas, **DNS**, DFS, Directivas de grupo, Certificados (AD CS),
Hyper-V y un editor LDAP tipo ADSI Edit.

Escrito en Electron + React + TypeScript. Se distribuye como **AppImage**: no hace falta unir
el equipo al dominio, ni configurar Kerberos, ni `sssd`, ni `realmd`.

[![Licencia MIT](https://img.shields.io/badge/licencia-MIT-blue.svg)](LICENSE)
[![Descargar AppImage](https://img.shields.io/github/v/release/jeremiaspala/ADeep?label=descargar)](https://github.com/jeremiaspala/ADeep/releases/latest)
[![Linux](https://img.shields.io/badge/plataforma-Linux%20x86--64-informational)](https://github.com/jeremiaspala/ADeep/releases/latest)

**[⬇ Descargar la última versión](https://github.com/jeremiaspala/ADeep/releases/latest)**

---

## Las consolas

| | Qué administra |
|---|---|
| **Usuarios y equipos** | Usuarios, grupos, equipos, OUs y contactos. Propiedades con 10 pestañas, editor de atributos, editor de ACLs, buscador con consultas guardadas |
| **Sitios y servicios** | Sitios, subredes, vínculos, catálogo global, conexiones del KCC, programación semanal de replicación |
| **Dominios y confianzas** | Dominios del bosque, particiones, relaciones de confianza, sufijos UPN, niveles funcionales |
| **Administración de DFS** | Espacios de nombres (v1 y v2) y grupos de replicación DFS-R |
| **DNS** | Zonas integradas en el directorio, directas e inversas: alta, edición y baja de zonas y registros, actualizaciones dinámicas y revisión de seguridad |
| **DHCP** | Servidores autorizados en el directorio *(parcial — ver [Límites](#límites-conocidos))* |
| **Hyper-V** | Hosts, máquinas virtuales unidas al dominio, delegación de migración en vivo y revisión de seguridad del fabric *(parcial — ver [Límites](#límites-conocidos))* |
| **Editor LDAP** | Acceso crudo a cualquier contexto de nombres: dominio, configuración, esquema y particiones DNS |
| **Directivas de grupo** | Directivas, dónde se aplica cada una, precedencia, herencia y estado |
| **Certificados** | Entidades emisoras, plantillas y revisión de seguridad (ESC1, ESC2, ESC3, ESC9) |

Cada consola abre en su propia ventana, como los complementos de MMC, pero **todas comparten
proceso y una sola sesión LDAP**: te autenticás una vez.

> **Antes de conectarte:** [`docs/CONFIGURACION.md`](docs/CONFIGURACION.md) tiene los requisitos,
> los modos de TLS, **qué permisos necesita la cuenta para cada consola** y los problemas
> frecuentes con su solución.

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
./ADeep-*-x86_64.AppImage --console=hyperv   # Hyper-V
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

> Pendientes de rehacer. Las que había mostraban un dominio productivo real y se quitaron del
> repositorio por eso; las nuevas se van a generar contra un laboratorio.
> `npm run uitest` las produce automáticamente en `docs/img/`.


## Equivalencias con RSAT

Si venís de Windows, cada consola de ADeep reemplaza a un complemento de MMC:

| MMC / RSAT (Windows) | Consola de ADeep |
|---|---|
| `dsa.msc` — Active Directory Users and Computers (ADUC) | Usuarios y equipos |
| `dssite.msc` — Active Directory Sites and Services | Sitios y servicios |
| `domain.msc` — Active Directory Domains and Trusts | Dominios y confianzas |
| `dnsmgmt.msc` — DNS Manager | DNS |
| `dfsmgmt.msc` — DFS Management | Administración de DFS |
| `gpmc.msc` — Group Policy Management Console | Directivas de grupo |
| `certsrv.msc` / `certtmpl.msc` — Certification Authority | Certificados |
| `virtmgmt.msc` — Hyper-V Manager | Hyper-V *(parcial)* |
| `dhcpmgmt.msc` — DHCP | DHCP *(parcial)* |
| `adsiedit.msc` — ADSI Edit | Editor LDAP |

## Preguntas frecuentes

**¿Se puede administrar Active Directory desde Linux sin RSAT?**
Sí. ADeep habla LDAP directo contra el DC, que es el mismo protocolo que usan las consolas de
Windows para casi todo. No necesita Wine, ni una VM con Windows, ni RSAT instalado en ningún
lado.

**¿Hay que unir la máquina Linux al dominio?**
No. Alcanza con llegar al DC por LDAPS (636) o StartTLS (389) y tener credenciales del dominio.

**¿Qué distribuciones soporta?**
Cualquiera con FUSE 3 y entorno gráfico. Probado en Ubuntu, Debian, Fedora y derivadas. El
AppImage trae un runtime estático, así que no necesita `libfuse2`.

**¿Puede crear usuarios y restablecer contraseñas?**
Sí. Las escrituras de contraseña exigen canal cifrado, como en Windows: LDAPS o StartTLS.

**¿Qué NO puede hacer?**
Todo lo que no vive en el directorio: crear relaciones de confianza (LSA RPC), ámbitos de DHCP,
encender máquinas virtuales de Hyper-V, emitir certificados o editar el contenido de las
directivas de grupo. Está detallado en [Límites conocidos](#límites-conocidos).

**¿Es seguro usarlo contra producción?**
Las lecturas están validadas de forma exhaustiva. Las escrituras están menos ejercitadas:
probalas en un laboratorio primero. Los arneses de verificación que trae son de sólo lectura.

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

Las diez consolas comparten proceso y **una sola sesión LDAP**. Eso hace que el refresco entre
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
npm run uitest       # abre las diez consolas, conecta y captura pantalla
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
- **Hyper-V administra el fabric, no las máquinas.** Del directorio salen los hosts, en qué
  puerto escucha VMConnect, qué VM están unidas al dominio y quién puede migrarle a quién; eso
  se lee y la delegación de migración en vivo se escribe. Encender, apagar, migrar o sacar un
  punto de control vive en el WMI del host (`root\virtualization\v2`) y necesita el mismo
  transporte que falta decidir para DHCP.
- **Crear confianzas** requiere LSA RPC y no se puede por LDAP. Se administran las que ya existen.
- **Crear espacios de nombres DFS** requiere MS-DFSNM por RPC. Se administran los que ya existen.
- **El contenido de las directivas de grupo** vive en SYSVOL, no en el directorio. Desde acá se
  administra dónde se aplican, en qué orden y con qué estado, no qué configuran.
- **Emitir o revocar certificados** es MS-ICPR por RPC. Se administran las plantillas, sus
  permisos y qué entidad emisora publica cada una.
- Los servidores DNS y DFS releen su configuración de AD por sondeo, así que un cambio puede
  tardar en verse.

## Revisiones de seguridad

Tres consolas traen una vista que sólo lee y no cambia nada:

- **DNS** — zonas con actualizaciones dinámicas no seguras, comodines, `wpad`/`isatap`
  publicados, CNAME mal formados y punteros colgados.
- **Hyper-V** — delegación no restringida, RBCD, transición de protocolo, RC4 habilitado,
  delegación hacia hosts dados de baja y máquinas virtuales abandonadas.
- **Certificados** — ESC1, ESC2, ESC3 y ESC9 en las plantillas.

## Documentación

- [`docs/CONFIGURACION.md`](docs/CONFIGURACION.md) — requisitos, conexión, TLS, **permisos por
  consola** y problemas frecuentes.
- [`docs/ROADMAP.md`](docs/ROADMAP.md) — el plan por fases y las decisiones de arquitectura.
- [`docs/BITACORA.md`](docs/BITACORA.md) — el historial de lo que se fue haciendo y por qué.

---

## In English

**ADeep — RSAT for Linux.** Manage Active Directory from Linux, without Windows and without a
virtual machine in the middle.

ADeep is a native replacement for the Microsoft **RSAT** MMC snap-ins: ten desktop consoles that
speak **LDAP** directly to the domain controller. It covers **ADUC** (Active Directory Users and
Computers), Sites and Services, Domains and Trusts, **DNS**, DFS, Group Policy, Certificate
Services (AD CS), Hyper-V and an ADSI Edit style raw LDAP browser.

Built with Electron, React and TypeScript, shipped as an **AppImage**. The machine does not need
to be domain-joined, and there is no Kerberos, `sssd` or `realmd` setup involved — just LDAPS or
StartTLS to a reachable domain controller.

It also ships read-only **security review** views: DNS zones accepting insecure dynamic updates,
dangling pointer records and stale root hints; unconstrained and resource-based Kerberos
delegation on Hyper-V hosts; and ESC1/ESC2/ESC3/ESC9 findings on certificate templates.

The user interface and documentation are in Spanish. Download the AppImage from
[Releases](https://github.com/jeremiaspala/ADeep/releases/latest).

*Keywords: Active Directory management on Linux, RSAT alternative for Linux, ADUC for Linux,
LDAP admin tool, Active Directory Users and Computers Linux client, manage AD without Windows,
Group Policy from Linux, DNS manager for Active Directory, Linux domain administration.*

## Licencia

MIT.

---

<img src="docs/img/fundamenta.svg" width="18" align="absmiddle"> Hecho por **Jeremías Palazzesi**
en [Fundamenta](https://fundamenta.ar) · blog: [nerdadas.com](https://nerdadas.com)
