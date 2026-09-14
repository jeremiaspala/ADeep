# Configuración y acceso

Todo lo que hace falta para que ADeep se conecte a un dominio y para que la cuenta con la que
te conectás pueda hacer lo que necesitás. Si algo no anda, empezá por
[Problemas frecuentes](#problemas-frecuentes).

---

## 1. Requisitos del equipo

| | |
|---|---|
| Sistema | Linux x86-64 con entorno gráfico (X11 o Wayland) |
| Dependencia | **FUSE 3** (`libfuse3`). El AppImage trae un runtime estático, no necesita `libfuse2` |
| Red | Alcance al controlador de dominio por TCP 389 y/o 636 |
| Resolución | El nombre del DC tiene que resolver. Lo más simple es apuntar el `/etc/resolv.conf` al DNS del dominio |

No hace falta unir la máquina al dominio, ni tener Kerberos configurado, ni `sssd`, ni
`realmd`. ADeep habla LDAP directo con bind simple.

```sh
chmod +x ADeep-*-x86_64.AppImage
./ADeep-*-x86_64.AppImage
```

---

## 2. La conexión

Al abrir cualquier consola aparece el diálogo de conexión. Los campos:

| Campo | Qué poner |
|---|---|
| **Servidor** | FQDN del DC: `dc01.empresa.local`. **No uses la IP** si vas a usar TLS: el certificado del DC se emite para el nombre, no para la dirección |
| **Puerto** | 389 para texto plano o StartTLS, 636 para LDAPS. Se completa solo al elegir el modo |
| **Seguridad** | Ver abajo |
| **Usuario** | `usuario@empresa.local` (UPN), `EMPRESA\usuario`, o el DN completo |
| **Contraseña** | — |
| **Base DN** | Se detecta solo del rootDSE. Sólo tocalo si querés acotar la vista |

### Modos de seguridad

| Modo | Puerto | Cuándo |
|---|---|---|
| `LDAPS` | 636 | **Recomendado.** TLS desde el primer byte |
| `StartTLS` | 389 | Equivalente en seguridad; negocia TLS sobre el puerto claro |
| Texto plano | 389 | **Sólo laboratorio.** La contraseña del bind viaja legible por la red |

> **Las escrituras de contraseña exigen canal cifrado.** Active Directory rechaza escribir
> `unicodePwd` sobre una conexión sin TLS. Si te conectás en texto plano, restablecer o cambiar
> contraseñas va a fallar y ADeep te lo va a decir; el resto de las operaciones funciona igual.

### Certificados

Por omisión ADeep **valida** el certificado del DC. Si tu CA es interna, tenés dos caminos:

1. **Recomendado:** conectate una vez, abrí la consola de **Certificados** → *Acción* →
   **Confiar en la CA del dominio para LDAPS**. ADeep lee los certificados de CA del propio
   directorio (`CN=Certification Authorities,CN=Public Key Services,…`), los guarda en el perfil
   y a partir de ahí valida contra ellos.
2. Marcar **No verificar el certificado** en el perfil. Esto desactiva la validación: la conexión
   sigue cifrada pero deja de estar autenticada, así que un intermediario podría hacerse pasar
   por el DC. Usalo sólo en un lab.

### Dónde quedan guardados los perfiles

`$XDG_CONFIG_HOME/adeep/` (habitualmente `~/.config/adeep/`).

La contraseña **sólo se guarda si tildás «Guardar contraseña»**, y se cifra con el `safeStorage`
de Electron, que se apoya en el llavero del escritorio (`gnome-keyring`, `kwallet`). Si no hay
llavero disponible, ADeep te avisa: en ese caso la contraseña quedaría en texto plano en el
archivo de perfiles, así que **no la guardes**. Podés verificarlo en *Herramientas →
Preferencias*.

---

## 3. Permisos: qué necesita la cuenta

**Leer casi todo el directorio sólo requiere ser un usuario del dominio.** Los permisos que
siguen son para **escribir**. ADeep no eleva privilegios ni hace nada por su cuenta: si el
directorio dice que no, la operación falla y se muestra el error del DC.

| Consola | Leer | Escribir |
|---|---|---|
| **Usuarios y equipos** | Usuario del dominio | Control delegado sobre la OU (lo habitual), o *Opers. de cuentas* / *Admins. del dominio* |
| **Sitios y servicios** | Usuario del dominio | Escritura en `CN=Sites,CN=Configuration` → *Enterprise Admins* o delegación explícita |
| **Dominios y confianzas** | Usuario del dominio | *Admins. del dominio*; elevar el nivel de bosque, *Enterprise Admins* |
| **Administración de DFS** | Usuario del dominio | *Admins. del dominio* o delegación sobre `CN=Dfs-Configuration,CN=System` |
| **DNS** | Usuario del dominio | **DnsAdmins** |
| **DHCP** | Usuario del dominio | Autorizar servidores escribe en `CN=NetServices,CN=Services,CN=Configuration` → *Enterprise Admins* |
| **Hyper-V** | Usuario del dominio | La delegación de migración en vivo escribe `msDS-AllowedToDelegateTo`, que además del permiso sobre el objeto exige el privilegio **SeEnableDelegationPrivilege** en el DC: en la práctica, *Admins. del dominio* |
| **Editor LDAP** | Usuario del dominio | Lo que pida cada objeto |
| **Directivas de grupo** | Usuario del dominio | Vincular: control sobre la OU o el sitio. Crear GPO: *Group Policy Creator Owners* |
| **Certificados** | Usuario del dominio | Plantillas y entidades emisoras viven en la partición de configuración → *Enterprise Admins* |

### Cuenta recomendada

Para uso diario, **no te conectes con Domain Admin**. Creá una cuenta propia y delegale sólo lo
que necesites:

```
Usuario del dominio
  + control delegado sobre las OUs que administrás   (usuarios y equipos)
  + DnsAdmins                                        (sólo si administrás DNS)
```

Reservá la cuenta privilegiada para las operaciones que de verdad la piden (niveles funcionales,
delegación de Kerberos, particiones de configuración) y usala sólo para eso.

### Lo que ADeep nunca hace

- No guarda ni transmite credenciales a ningún lado que no sea el DC que configuraste.
- No hace cambios sin que los pidas: cada escritura sale de una acción explícita de la UI, y las
  destructivas piden confirmación.
- Los arneses que corren contra un dominio (`npm run validate`, `uitest-audit`) son de **sólo
  lectura**, con lista negra de ítems destructivos.

---

## 4. Las consolas

Cada consola abre en su propia ventana, como los complementos de MMC, pero **comparten proceso y
una sola sesión LDAP**: te autenticás una vez.

```sh
./ADeep-*-x86_64.AppImage                     # Usuarios y equipos
./ADeep-*-x86_64.AppImage --console=sites     # Sitios y servicios
./ADeep-*-x86_64.AppImage --console=trusts    # Dominios y confianzas
./ADeep-*-x86_64.AppImage --console=dfs       # DFS
./ADeep-*-x86_64.AppImage --console=dns       # DNS
./ADeep-*-x86_64.AppImage --console=dhcp      # DHCP
./ADeep-*-x86_64.AppImage --console=hyperv    # Hyper-V
./ADeep-*-x86_64.AppImage --console=ldap      # Editor LDAP
./ADeep-*-x86_64.AppImage --console=gpo       # Directivas de grupo
./ADeep-*-x86_64.AppImage --console=adcs      # Certificados
```

Desde cualquier consola, el menú **Consolas** abre las otras. Para tenerlas en el menú del
escritorio, bajá los `.desktop`, los `.png` y `instalar-lanzadores.sh` de la release al mismo
directorio del AppImage y corré el script.

### Revisiones de seguridad

Tres consolas traen una vista de revisión que sólo lee y no cambia nada:

- **DNS → Revisión de seguridad**: zonas con actualizaciones dinámicas no seguras, registros
  comodín, `wpad`/`isatap` publicados, CNAME mal formados, punteros colgados (PTR, CNAME, NS, MX
  o SRV que apuntan a un nombre del que el dominio es autoridad y no existe) y **root hints** con
  direcciones viejas, servidores faltantes o copias que no coinciden entre particiones.
- **Hyper-V → Revisión**: delegación no restringida, RBCD, transición de protocolo, RC4
  habilitado, delegación hacia hosts dados de baja y VM abandonadas.
- **Certificados → Revisión de seguridad**: ESC1, ESC2, ESC3 y ESC9 en las plantillas.

Un hallazgo que es a propósito se marca con **«Es a propósito»**: se sigue evaluando en cada
pasada, pero pasa a una sección aparte para que lo pendiente quede a la vista. La lista se guarda
en las preferencias del equipo, no en el directorio.

**Lo que las revisiones no pueden ver.** Las transferencias de zona, los reenviadores globales y
la lista de bloqueo de consultas globales viven en el servicio DNS, no en Active Directory, y
desde LDAP no se leen. Por eso los hallazgos de root hints salen como observación media: si tus
servidores usan reenviadores, los root hints no se consultan nunca y el hallazgo no aplica.

---

## 5. Límites conocidos

ADeep administra **lo que vive en Active Directory**. Estas cosas no están en el directorio y
por lo tanto no se pueden hacer por LDAP:

| No se puede | Por qué | Con qué se hace |
|---|---|---|
| Crear, validar o restablecer confianzas | LSA RPC (MS-LSAD) | `netdom`, `New-ADTrust` |
| Crear espacios de nombres DFS | MS-DFSNM (RPC) | Consola DFS de Windows |
| Ámbitos, concesiones y reservas de DHCP | Viven en el servidor DHCP | WinRM, MS-DHCPM, API de Kea |
| Encender, apagar o migrar máquinas virtuales | WMI del host, `root\virtualization\v2` | Administrador de Hyper-V, PowerShell |
| Transferencias de zona y reenviadores globales de DNS | Configuración del servicio DNS | Consola DNS de Windows |
| Emitir o revocar certificados | MS-ICPR (RPC) | Consola de la CA |
| Contenido de las directivas de grupo | SYSVOL, no el directorio | GPMC |
| Replicar un NC completo («Replicar ahora») | DRSUAPI (RPC) | `repadmin` |

DFS v1 (espacios de nombres en modo Windows 2000) es **sólo lectura**: los vínculos viven dentro
de un blob binario y reescribirlo a ciegas es demasiado riesgo.

**Las escrituras están poco ejercitadas contra dominios reales.** Las lecturas sí, de forma
exhaustiva. Probá las escrituras en un laboratorio antes de usarlas en producción.

---

## 6. Problemas frecuentes

**«No se pudo resolver el nombre del servidor»**
El equipo no resuelve el FQDN del DC. Apuntá el DNS al del dominio, o agregá una línea en
`/etc/hosts` para probar.

**«El certificado no es de confianza»**
La CA del dominio no está en el almacén del sistema. Usá *Certificados → Confiar en la CA del
dominio para LDAPS*, o marcá «No verificar el certificado» si es un lab.

**«Credenciales inválidas» con la contraseña correcta**
Probá el formato del usuario: `usuario@dominio.local` suele funcionar donde `DOMINIO\usuario`
falla. El error del DC incluye un código `data XXX` que ADeep traduce: `52e` contraseña
incorrecta, `525` usuario inexistente, `530` fuera de horario, `531` estación no permitida,
`532` contraseña expirada, `533` cuenta deshabilitada, `701` cuenta expirada, `775` cuenta
bloqueada.

**«Se requiere una conexión cifrada»**
Estás en texto plano e intentaste escribir una contraseña. Cambiá el perfil a LDAPS o StartTLS.

**«Permisos insuficientes» al escribir**
La cuenta no tiene el derecho sobre ese objeto. Mirá la tabla de la sección 3.

**La aplicación empaquetada no arranca**
El AppImage necesita FUSE 3. Si tu distro sólo tiene `libfuse2`, o no tiene FUSE, extraelo:

```sh
./ADeep-*-x86_64.AppImage --appimage-extract
./squashfs-root/AppRun --no-sandbox
```

**El cambio en el directorio no se ve en el servidor**
Los servidores DNS y DFS releen su configuración de Active Directory por sondeo, y pueden tardar
hasta una hora. El cambio ya está escrito; lo que falta es que el servicio lo lea.

---

## 7. Compilar desde el código

```sh
npm ci
npm run typecheck     # los dos proyectos, node y web
npm run build         # electron-vite
npm run dist          # + electron-builder + repack del AppImage
```

`npm run dist` genera un AppImage por consola desde una sola carga útil, más los lanzadores
`.desktop` en `release/launchers/`.

Para verificar contra un dominio real (**sólo lectura**, se puede correr en producción):

```sh
npm run validate      # ~60 verificaciones contra el DC del perfil guardado
npm run uitest        # abre las consolas, conecta y captura pantalla
```
