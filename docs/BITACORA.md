# Bitácora

Registro de lo que se hizo, en qué orden y por qué. El plan a futuro está en
[`ROADMAP.md`](ROADMAP.md); esto es el historial.

---

## 2026-09-10 — De una consola a nueve

Sesión larga. Se empezó con un backend LDAP completo y una interfaz que no existía, y se
terminó con nueve consolas empaquetadas y publicadas.

### 1. El renderer no existía

`src/renderer/index.html` apuntaba a un `main.tsx` que no estaba. Se escribió toda la interfaz
de ADUC: shell, árbol, lista con columnas configurables, diálogos de conexión, alta de objetos,
propiedades con diez pestañas, editor de atributos, editor de ACLs, buscador con consultas
guardadas.

Correcciones fuera del renderer que hicieron falta para que compilara y anduviera:

- Faltaba el alias `@shared` en `electron.vite.config.ts`: el typecheck pasaba y el build no.
- `Preferences` vivía en `preload/index.ts`, fuera del `tsconfig.web`. Se movió a `shared/`.
- Errores de tipos preexistentes en `ipc.ts`, `operations.ts` y `sddl.ts`.

### 2. Empaquetado: el AppImage no arrancaba

Dos problemas, ninguno evidente:

- El runtime de AppImage que embebe electron-builder 25 es de 2019 y pide `libfuse.so.2`. Este
  equipo tiene sólo FUSE 3. Se reemplaza por el runtime estático de type2-runtime en un
  postbuild.
- El montaje FUSE es `nosuid`, así que `chrome-sandbox` nunca puede ser setuid y Electron
  aborta. El `.desktop` pasaba `--no-sandbox` pero desde la terminal no. Se parchea `AppRun`.

También: `linux.desktop` en electron-builder 25 es un mapa plano; la forma anidada de la v26
escribe una línea basura `entry=[object Object]`.

### 3. Fase 0 — validación contra el dominio real

Se armó `npm run validate`: verificaciones **de sólo lectura** contra el DC del perfil guardado,
para poder correrlas sin riesgo en producción. Encontró un bug que rompía cuatro funciones a la
vez y que nadie hubiera visto:

> Los filtros LDAP con valores binarios se construían como texto con escapes `\XX`. ldapts los
> serializa a BER en UTF-8, así que **todo byte ≥ 0x80 se convertía en dos** (`0xd7` → `0xc3 0x97`).
> Fallaban en silencio `search.bySid`, `search.byGuid`, la resolución de nombres del editor de
> ACLs y el grupo principal en «Miembro de».

Se corrigió armando los filtros con `EqualityFilter` y Buffer (`ldap/filters.ts`) y se
eliminaron los helpers viejos para que nadie los vuelva a usar.

Otros hallazgos de la misma pasada: `getWellKnownContainers` devolvía GUIDs en vez de nombres;
Configuration y Schema se clasificaban como particiones de aplicación; `pKT`, `invocationId`,
`dnsRecord` y los `msDFS-*v2` no estaban en la lista de atributos binarios y llegaban
corrompidos.

El round-trip del descriptor de seguridad se verificó sobre los **14 848 objetos** del dominio:
sin pérdida semántica.

### 4. Sitios y servicios, Dominios y confianzas, DFS

Tres consolas nuevas. Lo que costó:

- **Programación semanal**: el blob `schedule` de 188 bytes, reusado después en DFS-R.
- **`msDS-TrustForestTrustInfo`**: parser de los espacios de nombres de una confianza de bosque.
- **`pKT`**: los espacios de nombres DFS v1 guardan todos sus vínculos en un blob binario. Se
  escribió el parser contra el formato documentado y se ajustó contra los datos reales — había
  un campo `comment` entre `state` y los timestamps que la documentación no dejaba claro. Se
  verificó contra los tres espacios de nombres del dominio: raíz, vínculos, destinos y estado.

**Decisión de arquitectura**: consolas separadas, cada una en su ventana, como los complementos
de MMC. Se descartó la idea de una sola ventana con un selector.

### 5. Consumo de recursos

Medido con PSS: 269 MB una consola, 433 MB las cuatro. Cada consola adicional cuesta ~55 MB.

- Apagar la composición por GPU ahorra 14-19 MB reproducibles. Queda apagada por defecto.
- **Probado y descartado**: `--in-process-gpu` elimina el proceso de GPU pero mueve sus 98 MB
  al principal; `--renderer-process-limit=1` no consolida nada porque Electron le da un
  renderer propio a cada ventana igual.

### 6. Empaquetado: idas y vueltas

Se pasó de un AppImage a cuatro (uno por consola) y se volvió a uno solo, que es lo que hace
que compartan proceso y sesión LDAP. Quedaron los lanzadores `.desktop` por consola.

Dos correcciones de íconos:

- El `.desktop` declaraba `StartupWMClass=ADeep` pero la ventana reporta `WM_CLASS="adeep"`.
  Con esa diferencia el panel no asocia la ventana con su lanzador.
- Los íconos no entraban al asar: se referenciaba un archivo que `files` no incluía, así que en
  la versión empaquetada las ventanas no tenían ícono ninguno.

### 7. El bug de los submenús

Reportado por Jeremías: `Nuevo > Usuario` no hacía nada. Resultó ser de fondo y afectaba a
**todas** las consolas: el submenú se dibuja en otro portal, el menú padre veía el clic como
«afuera» y desmontaba el ítem antes de que llegara el `click`.

A partir de ahí se armó `uitest-audit`, que recorre todos los ítems de menú de todas las
consolas y verifica que cada uno haga algo, con lista negra de acciones destructivas porque
corre contra el dominio productivo.

### 8. DNS y DHCP

- **DNS** es la consola con más sustancia después de ADUC, porque el DNS integrado vive en LDAP.
  Códec completo del blob `dnsRecord`: el TTL es **big-endian** aunque el resto de la cabecera
  sea little, y los nombres van en `DNS_COUNT_NAME`. Verificado reconstruyendo los **726
  registros** de la zona principal: todos idénticos byte a byte.
- **DHCP** quedó a medias a propósito. De DHCP, AD guarda una sola cosa: la lista de servidores
  autorizados, que en este dominio está vacía. Los ámbitos necesitan otro transporte y Jeremías
  pidió expresamente charlarlo antes de meter WinRM.

### 9. Editor LDAP, Directivas de grupo y Certificados

- **Editor LDAP**: navegación cruda de cualquier contexto de nombres.
- **Directivas de grupo**: `gPLink` se guarda al revés de la precedencia; hay que invertirlo
  para mostrarlo y volver a invertirlo para escribirlo. Verificado reconstruyendo los 57
  `gPLink` del dominio, todos idénticos.
- **Certificados**: plantillas con quién las publica y una revisión de seguridad (ESC1, ESC2,
  ESC3, ESC9). La primera versión marcaba 7 plantillas en rojo, pero eran plantillas por defecto
  que ninguna CA publica y por lo tanto no son solicitables. Se degradaron a observación menor
  y quedó **1 sola con hallazgo real**. Sin ese ajuste el informe era ruido.
- **Confiar en la CA del dominio**: lee los certificados de CA del propio directorio, los fija
  en el perfil y activa la validación del certificado LDAPS.

### 10. Un error propio, y su consecuencia

El arnés de auditoría hizo clic en «Confiar en la CA del dominio» y **eso borró la contraseña
guardada del perfil**. Causa: `saveProfile` borraba el secreto cuando el perfil llegaba sin
`password`, y la sesión activa nunca lo devuelve.

Corregido: ahora sólo se borra cuando el usuario apaga «guardar la contraseña». La contraseña
que había se perdió y hubo que volver a escribirla una vez.

Se agregó «confiar» a la lista negra del arnés y la acción pasó a pedir confirmación,
mostrando qué CAs va a fijar.

### 11. «Cambié el nombre y no se modificó»

Reporte de Jeremías, y la primera escritura que se probó contra el dominio real. **La escritura
había funcionado**: `displayName` decía «Jeremias Palazzesi» con `whenChanged` de esa misma
hora. Lo que no funcionaba era la interfaz: el árbol y la lista muestran el `cn`, no el
`displayName`, así que el cambio no se veía en ningún lado.

Debajo había dos huecos reales:

- `givenName`, `initials` y `sn` no eran editables en ninguna parte, sólo en el alta.
- `obj.renameUser` existía en el backend desde el principio y **no tenía interfaz**: F2
  renombraba únicamente el RDN, dejando los demás nombres viejos.

Se agregaron los campos a la pestaña General y un diálogo de cambio de nombre como el de
Windows: nombre, iniciales, apellido, CN, nombre para mostrar, cuenta y UPN, con el CN y el
nombre para mostrar rearmándose solos mientras no se los toque. F2 y el menú contextual abren
ese diálogo para usuarios y el de siempre para el resto.

### 12. La misma clase de bug en el resto de las consolas

A pedido de Jeremías se revisaron los 60 puntos de escritura de las nueve consolas buscando lo
mismo: **la escritura anda pero la vista queda vieja**. Aparecieron tres, y dos eran peores que
el original:

- **DNS**: al agregar o borrar registros se recargaban los registros pero no las zonas, así que
  los contadores del árbol y de la lista quedaban viejos.
- **Editor LDAP**: al crear o borrar se refrescaba la lista pero no la rama del árbol; el objeto
  nuevo no aparecía hasta reiniciar la consola.
- **Sitios**: el editor de programación de una conexión se abría, dejaba editar… y **descartaba
  los cambios** con un aviso. Ahora guarda de verdad (`sites.setConnectionSchedule`).

Y una acción que mentía: «Forzar replicación» en el menú de un servidor decía que replicaba pero
disparaba la recolección de basura. Se eliminó, y las dos operaciones sobre rootDSE que sí
funcionan quedaron con nombres que dicen lo que hacen.

Después de esto: 170 ítems de menú recorridos, **0 sin efecto**.

### Lo que quedó pendiente

- **Las escrituras nunca se probaron contra un dominio real.** Las lecturas sí, exhaustivamente.
- **Capturas contra un lab**: Samba AD DC no provisiona en este equipo. Tres imágenes distintas
  (Samba 4.24.7, 4.23.10 y una 4.15), con privilegios, sin seccomp y con volúmenes reales,
  todas mueren igual: `Security context active token stack underflow` durante el repackaging de
  la base. Es el user namespace de podman rootless sobre el kernel 7.0.0. Falta decidir entre
  contenedor rootful, provisionar en el host o recortar las capturas actuales.
- **DHCP**: falta decidir el transporte.

### Cifras al cierre

| | |
|---|---|
| Consolas | 9 |
| Verificaciones de sólo lectura | 56, todas en verde |
| Ítems de menú auditados | 170, todos con efecto |
| Objetos con round-trip de descriptor de seguridad verificado | 14 848 |
| Registros DNS reconstruidos byte a byte | 726 |
| Atributos `gPLink` reconstruidos | 57 |
| Bugs encontrados por los arneses | 16 |
