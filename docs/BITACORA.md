# Bitácora

Registro de lo que se hizo, en qué orden y por qué. El plan a futuro está en
[`ROADMAP.md`](ROADMAP.md); esto es el historial.

---

## 2026-09-14 (noche) — Un bug propio, los root hints y la basura de siete años

### El bug: `dataLength` no era decorativo

La revisión de DNS mostraba «—» en la política de actualizaciones de cinco zonas de doce.
No eran zonas raras: `_msdcs`, `interna-d.local`, `interna-c.local` y dos inversas. El valor que salía
era `2457177090`, `2049703938`, `4177167618`, `258`, `3307643394`.

En hexadecimal se ve solo: `0x92758C02`, `0x7A2C0002`, `0xF8FA8502`, `0x00000102`,
`0xC526A202`. **Todos terminan en `02`.** El valor real es 2 en los cinco casos.

`ALLOW_UPDATE` viene con `dataLength = 1`, y los tres bytes que siguen **no son relleno en
cero**: son basura del DC. El código leía el DWORD completo. El comentario del roadmap decía
«el valor igual está en el DWORD», que es verdad a medias y llevaba justo al error. Ahora
`readZoneProperties` respeta el `dataLength` declarado y lee 1, 2, 3 o 4 bytes según corresponda.

Es el peor tipo de bug para una herramienta de revisión: no fallaba, **informaba mal**. Cinco
zonas figuraban como «no se pudo leer la política» cuando en realidad estaban bien configuradas.

### Root hints

`CN=RootDNSServers` estaba explícitamente salteado en `listZones` —no es una zona
administrable— pero su contenido importa. Al leerlo aparecieron tres cosas:

1. **Dos copias que no coinciden.** `DomainDnsZones` tiene **7** servidores raíz;
   `CN=System` tiene los 13. Cada servidor usa la de su partición.
2. **Direcciones viejas.** `b` (cambió en 2023), `d` (2013) y `h` (2015) siguen con la IP
   anterior en la copia heredada; `b` también en la otra.
3. Faltan seis servidores en la copia de `DomainDnsZones`: d, h, i, k, l, m.

El hallazgo se informa como **medio, no grave**, y el texto lo aclara: los root hints sólo se
consultan si el servidor resuelve por su cuenta hasta la raíz. Si tiene reenviadores globales
—que viven en el servicio DNS, no en el directorio— no se usan nunca, y **desde LDAP no hay
forma de saber cuál es el caso**. Decirlo vale más que inventar una severidad.

La lista de referencia (`ROOT_SERVERS` en `dns/properties.ts`) queda con la advertencia de
contrastar contra `https://www.internic.net/domain/named.root` antes de tocar nada: cambia cada
varios años y una lista vieja en el código es exactamente el problema que se está reportando.

### Los punteros colgados, borrados

Los tres que encontró la revisión, con respaldo en `~/rollback-dns-2026-09-14.json`:

| Zona | Nodo | Qué era |
|---|---|---|
| `..TrustAnchors` | `@` | NS → `dc-retirado` — un DC que ya no existe. Quedaron los otros 4 NS |
| `11.10.12.in-addr.arpa` | `197` | PTR → `equipo-viejo-1`. Era su único registro: se borró el nodo |
| `8.10.12.in-addr.arpa` | `203` | PTR → `equipo-viejo-2`. Ídem |

Antes de borrar se verificó que los tres nombres no existieran **ni en el directorio ni en
ninguna zona DNS**. El caso de `dc-retirado` se miró aparte porque un NS no es un PTR: borrar un
servidor de nombres de una zona es otra cosa. Con 4 NS válidos restantes, era seguro.

### «Es a propósito»

`interna-a.local` y `interna-b.local` aceptan actualizaciones dinámicas no seguras **a propósito**.
Una revisión que repite todas las veces algo ya decidido se vuelve ruido y se deja de leer; una
que lo esconde deja de servir para auditar. Se agregó `shell/FindingList.tsx`, compartido por
las dos revisiones: un hallazgo marcado como intencional **se sigue evaluando** pero pasa a una
sección aparte, plegada. La lista vive en las preferencias, por `id` del hallazgo.

### DFS: «Nueva carpeta» por fin hace algo

La auditoría de menús venía marcándolo como SIN EFECTO desde hacía sesiones. No era un falso
positivo: `dfs.createFolder` estaba en el backend y en el preload desde el principio, y **la UI
nunca lo llamaba** — el ítem sólo mostraba un aviso pidiendo que eligieras un espacio de
nombres. Ahora abre un diálogo con selector de espacio de nombres (sólo v2), ruta, destinos y
comentario, con la advertencia de que ADeep crea el objeto en AD pero **no comparte la carpeta
en el servidor** ni verifica que el recurso exista.

De paso quedó sin uso el `toast` de esa consola y se sacó.

`npm run validate`: 59/59. La revisión de DNS quedó en 6 observaciones (eran 9).

---

## 2026-09-14 (tarde) — Terminar Hyper-V y DNS, con la seguridad adelante

Pedido de Jeremías: cerrar las dos consolas «valorando la seguridad sobre todo». Eso decidió
qué se construyó y qué no.

### DNS

`dNSProperty` estaba leído a medias. Se separó en `src/main/dns/properties.ts` con las 15
propiedades de MS-DNSP 2.3.2.1, los dos formatos de lista de direcciones (`DNS_ADDR_ARRAY` nuevo
y `IP4_ARRAY` viejo, que conviven), y el armador de propiedades de un DWORD para poder escribir.

Con eso salieron gratis el tipo de zona (y por lo tanto los **reenviadores condicionales**, que
son zonas de tipo 4) y los servidores maestros.

Lo que importa: **`dns.review`**. Contra el dominio real, 12 zonas y 1082 registros → 5
observaciones, **2 graves**: `interna-a.local` y `interna-b.local` aceptan **actualizaciones
dinámicas no seguras**, o sea que cualquiera que llegue al DNS puede pisar cualquier registro de
esas zonas sin autenticarse. Las otras tres son punteros colgados: `dc-retirado`, `equipo-viejo-1` y `equipo-viejo-2`,
exactamente la misma clase de problema que el PTR de `equipo-retirado` que se corrigió a mano esta mañana.

Decisión deliberada: **la revisión no se pronuncia sobre las transferencias de zona ni sobre los
reenviadores globales.** No están en el directorio —son configuración del servicio DNS— y un
hallazgo que no se puede verificar es peor que ninguno. La UI lo dice explícitamente en vez de
dejar el hueco.

El alta de zona nace **sin actualizaciones dinámicas**, y abrir una zona a las no seguras pide
confirmación escrita. Cerrarla no: bajar el privilegio no necesita ceremonia.

### Hyper-V

Se agregó lo que faltaba mirar en materia de confianza:

- **RBCD** (`msDS-AllowedToActOnBehalfOfOtherIdentity`): se parsea el descriptor y se resuelven
  los SID. Vale la pena porque se escribe desde el propio host, sin ser administrador del
  dominio: es de los pocos atributos donde un atacante deja huella y nadie mira.
- **Cifrados Kerberos** decodificados. HOST-A y HOST-C están en 28 — RC4 habilitado.
- **Transición de protocolo** como hallazgo aparte de la delegación no restringida.
- **VM abandonadas**, agregadas en un solo hallazgo en vez de una fila por máquina.
- Propiedades del host con pestaña de seguridad, que junta todo en un lugar.
- VCO ↔ CNO por el dueño del descriptor. Sin ejercitar: no hay clústeres en este dominio, y
  queda dicho en el código y en el roadmap en vez de pasar por probado.

Un detalle de criterio que ya había aparecido con HOST-B: la columna de seguridad mostraba «sin
observaciones» para un host deshabilitado que tiene delegación no restringida. El riesgo no
desaparece porque la cuenta esté apagada, sólo queda latente. Ahora dice **«no restringida
(inerte)»**.

### Documentación

Se escribió [`CONFIGURACION.md`](CONFIGURACION.md): requisitos, los tres modos de TLS y cuándo
usar cada uno, certificados de CA interna, dónde y cómo se guardan las contraseñas, **una tabla
de qué permiso necesita la cuenta para escribir en cada consola**, la recomendación de no usar
Domain Admin para el día a día, los límites de lo que no se puede hacer por LDAP y los errores
frecuentes con los códigos `data XXX` del DC traducidos.

`npm run validate`: 59/59.

---

## 2026-09-14 — Consola de Hyper-V

Décima consola. La pregunta de arranque era si Hyper-V daba para una consola sobre LDAP, así
que lo primero fue sondear el dominio real antes de escribir nada. Dio más de lo esperado:

- Los hosts publican un `serviceConnectionPoint` `CN=Microsoft Hyper-V` bajo su objeto de
  equipo, con el listener de VMConnect en `serviceBindingInformation`.
- **Cada invitado con los servicios de integración publica `CN=Windows Virtual Machine` bajo su
  propio objeto de equipo.** Eso da el inventario de VM unidas al dominio sin salir de LDAP, que
  era la parte que parecía imposible.
- La migración en vivo con Kerberos es `msDS-AllowedToDelegateTo`: se lee y **se escribe**.

Con eso la consola no quedó en el lugar incómodo de DHCP (una pestaña que sólo explica por qué
no hace nada): lee el fabric entero y tiene una escritura real.

### Lo que encontró en el dominio

3 hosts (HOST-A, HOST-B, HOST-C), 8 VM unidas al dominio, 0 clústeres, 4 observaciones. HOST-A y HOST-C se
delegan mutuamente. HOST-B está deshabilitado y tiene delegación no restringida.

La primera versión del diagnóstico marcaba las dos cosas de HOST-B como **graves** y acusaba a HOST-A
y HOST-C de «migración en un solo sentido». Jeremías aclaró que **HOST-B está dado de baja**, y con eso
el diagnóstico quedaba al revés: lo que importa no es el estado de un host que ya no existe, sino
que **HOST-A y HOST-C siguen delegando hacia él**. Se recalibró:

- Host deshabilitado → observación baja («fuera de servicio»), no grave.
- Delegación no restringida en un host deshabilitado → baja, marcada como *inerte*: nadie puede
  autenticarse contra él, pero volvería a importar si alguien reactiva la cuenta.
- Delegar hacia un host deshabilitado → media, **informada en el host vivo**, que es donde hay
  que limpiarla. Reemplaza al falso «migración en un solo sentido».

Queda en 4 observaciones, 0 graves. La lección para las próximas revisiones: un hallazgo tiene
que apuntar al objeto donde está la acción, no al que tiene el síntoma.

### La limpieza, ejecutada

Jeremías pidió ejecutar la limpieza, así que se corrió `hyperv.setDelegation` sobre HOST-A y HOST-C
para sacar a HOST-B de sus destinos. No es la primera escritura de ADeep contra producción —el
2026-09-10 ya se había cambiado un `displayName` desde la UI, ver más abajo—, pero sí la primera
que toca **configuración de seguridad** (`msDS-AllowedToDelegateTo`) y la primera hecha con
respaldo previo.

Se hizo con respaldo: el script leyó y guardó los `msDS-AllowedToDelegateTo` previos en
`~/rollback-hv-delegation-2026-09-14.json` antes de tocar nada, y verificó el resultado
releyendo el atributo.

| | Antes | Después |
|---|---|---|
| HOST-A | 16 SPN (HOST-B + HOST-C) | 8 SPN (sólo HOST-C) |
| HOST-C | 16 SPN (HOST-B + HOST-A) | 8 SPN (sólo HOST-A) |

Salió limpia, sin sorpresas. `setMigrationDelegation` también apaga `TRUSTED_FOR_DELEGATION`,
pero ninguno de los dos lo tenía prendido, así que no escribió `userAccountControl`. La revisión
del fabric bajó de 4 observaciones a 2, las dos bajas y las dos sobre HOST-B.

### Detalles que costaron

- Delegación restringida y no restringida se excluyen: si `TRUSTED_FOR_DELEGATION` está prendido,
  el DC ignora `msDS-AllowedToDelegateTo`. Por eso `setMigrationDelegation` la apaga al guardar,
  con confirmación escrita.
- Los SPN de delegación van con nombre corto **y** FQDN: el cliente puede pedir el ticket con
  cualquiera de los dos. `npm run validate` verifica que lo que escribiríamos coincide con lo
  que ya está en los hosts configurados.
- La columna de servicios publicados con las cuatro palabras enteras no entraba en la grilla;
  quedó con las iniciales M · C · R · W y el nombre completo en el tooltip.

### Lo que sigue bloqueado

Encender, apagar, migrar o ver puntos de control es WMI del host, no LDAP. Es **la misma
decisión de transporte que frena DHCP**, pero ahora con más peso: el DHCP de este dominio no
existe y los tres hosts de Hyper-V sí, y ya publican el SPN `WSMAN`.

`npm run validate`: 58/58.

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

### 13. Refresco automático entre ventanas

Pregunta de Jeremías: «¿el refresco es automático?». La respuesta era «a medias»: cada consola
recargaba su propia vista después de escribir, pero si se cambiaba algo desde **otra** ventana
de ADeep, esa quedaba vieja hasta apretar F5. Es la misma clase de bug del punto 12, sólo que
entre ventanas.

Como las nueve consolas comparten proceso, se resolvió sin sondeo:

- El envoltorio `handle` del puente IPC clasifica cada canal con un regex (`ESCRITURA`) y, si
  la llamada **terminó bien** y era de escritura, emite `directory.changed` con
  `broadcastExcept(event.sender.id, …)`: a todas las ventanas menos a la que escribió, que ya
  recargó sola.
- Cada consola se suscribe y recarga su vista actual con un retardo de 400 ms, así un alta que
  dispara varias escrituras seguidas provoca **una sola** recarga.

Nada de esto genera tráfico si nadie escribe. El sondeo periódico se descartó a propósito: con
una zona DNS de 620 nombres, 634 usuarios y cuatro ventanas abiertas, sería castigar al DC para
nada.

De los 141 canales del puente, 64 quedan clasificados como escritura y 77 como lectura. Las
trampas del regex eran `sites.validateSubnet` (valida, no escribe), `obj.protect.get` /
`obj.cannotChangePassword.get` (los `.get` de pares get/set) y los `store.*`, que tocan
preferencias locales y no el directorio.

**Verificación** (`npm run uitest:refresh`, 39 comprobaciones, todas en verde): clasifica los
canales, abre ADUC y Sitios contra el dominio real y comprueba que una escritura desde una
ventana avisa a la otra y no a sí misma, que la que recibe el aviso **vuelve a leer del
directorio** de verdad, y que una ráfaga de cinco escrituras se colapsa en una sola recarga.
El arnés no escribe nada: reemplaza `obj.modify` por un doble que devuelve true sin tocar LDAP,
de modo que se ejercita el camino real —envoltorio, difusión, preload y suscripción— sin riesgo
en producción.

Lo que sigue sin refrescarse solo son los cambios hechos **fuera** de ADeep (otro admin en una
consola de Windows, un script). Para eso hace falta F5, y es deliberado.

### 14. La lista no se podía desplazar

Jeremías: «si los equipos superan el tamaño de la ventana no tengo scroll para verlos hacia
abajo». Con 634 usuarios el contenedor `Users` llenaba la lista y el resto quedaba inalcanzable:
ni barra ni rueda del mouse.

No faltaba el `overflow: auto` —`.grid` y `.tree` ya lo tenían—, faltaba que alguien tuviera
altura definida. `.app` y `.body` son grids cuyas filas se dimensionan al contenido, y los
paneles intermedios (`.tree-pane`, `.list-pane`) conservaban el `min-height: auto` que traen por
defecto los ítems de flex y de grid. Así, la tabla empujaba la fila hacia abajo, el panel crecía
con ella y `.grid` nunca llegaba a desbordar: no tenía de qué. Lo que recortaba era el
`overflow: hidden` de `body`, varios niveles más arriba, donde ya no hay a qué engancharle una
barra.

La corrección es sólo CSS, en `styles/app.css`:

- `.app` y `.body`: `minmax(0, 1fr)` en la fila del cuerpo y `overflow: hidden`, para que la fila
  no crezca con el contenido.
- `.tree-pane` y `.list-pane`: `min-height: 0` y `overflow: hidden`.
- `.tree` y `.grid`: `min-height: 0`, que es lo que habilita el desborde dentro del flex.

Las nueve consolas comparten estas clases a través de `ConsoleShell` y `DetailList`, así que el
arreglo vale para todas: la lista, y también el árbol, que tenía el mismo defecto y se notaba
menos porque casi nunca es tan largo. Los encabezados `sticky` de la tabla siguen funcionando
—ahora de verdad, porque antes no había scroll respecto del cual quedarse fijos—.

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
| Canales IPC clasificados (64 escriben, 77 leen) | 141 |
| Bugs encontrados por los arneses | 16 |
