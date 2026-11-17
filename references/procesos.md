# Procesos e iteraciones — contrato

**Plataforma 2.0.** Reemplaza al motor de etapas de las versiones 1.2 a 1.12, que queda
descripto como historia en [`process-engine.md`](process-engine.md).

## Qué resuelve

Una sola cosa: que no se pierda cómo alguien del equipo hizo algo con IA en su máquina, y que
otra persona lo repita en otra máquina, con otra IA.

- **El proceso sabe qué hace falta.** Qué tiene que tener la máquina, con cómo comprobarlo y
  cómo instalarlo; qué hay que registrar cada vez; dónde se guarda lo producido. La persona no
  tiene que inventarlo ni recordarlo.
- **Lo producido queda guardado.** Con [almacén propio](#lo-producido-en-el-almacén-propio)
  (2.4), en la aplicación, que comprueba que llegó; sin almacén, en Dropbox: una iteración sin
  carpeta de Dropbox y sin la lista de archivos que quedaron ahí no se registra.
- **Un proceso nace completo.** Sin ficha, skill (o método), carpeta, requisitos y registro no
  se guarda, lo cree una persona en el panel o su agente por MCP.
- **Quien administra define; el resto registra.** Crear y cambiar procesos lo hace quien
  administra —en persona o con su agente, que opera con su rol—. Los demás registran
  iteraciones.
- **Nada más.** No hay etapas, colas, revisiones ni aprobaciones. Estado y responsable son
  opcionales. Quien administra edita y borra todo desde el panel.

## Dónde vive

`src/platform/processes/`, en la zona de plataforma:

| Archivo | Qué hace |
|---|---|
| `definition.ts` | Puro, sin dependencias: qué es un proceso válido, qué le falta a una iteración, la guía para la IA y la lectura de requisitos y registro escritos por una persona. Lo prueba `scripts/test-process-definition.mjs` |
| `engine.ts` | Las operaciones sobre la base |
| `tools.ts` | Las herramientas y los comandos MCP |

## Qué necesita la AppSpec

El bloque `"blocks": ["procesos"]` agrega las dos entidades con sus permisos. Ver
[Bloques](app-spec-v0.md#bloques).

| Entidad | Campos | Relación |
|---|---|---|
| `proceso` | `nombre`, `estado` (`publicado`, `retirado`), `descripcion`, `definicion` (json) | — |
| `iteracion` | `titulo`, `carpeta`, `archivos` (json), `datos` (json), `receta` (json), `skill`, `conversacion`, `origen` (`original`, `reproduccion`), `salio_igual`, `que_falto`, `autor` (person), y opcionales `responsable` (person) y `estado` (`en_curso`, `terminada`, `publicada`) | `proceso` |

Los roles con `manage_users` tienen todos los permisos sobre las dos; el resto, lectura.
Registrar una iteración no usa esa matriz: lo hace la herramienta, que valida lo que llega, y
la puede usar cualquier rol.

Las herramientas genéricas no escriben procesos: `create_record`, `update_record` y
`delete_record` rechazan `proceso`, y `create_record` rechaza `iteracion`. El formulario
genérico del panel tampoco crea ni edita procesos. No saben qué tiene que tener un proceso
completo; el motor sí. Editar o borrar una iteración ya registrada sigue siendo como con
cualquier registro.

## La definición del proceso

```json
{
  "proceso": "carrusel-p3-negocios",
  "ficha": {
    "resumen": "El negocio de un deportista contado en 9 láminas, con fotos reales.",
    "entrada": "Un deportista o una historia de negocios.",
    "entrega": "9 láminas de 1080×1350, caption y texto alternativo.",
    "pedido_ejemplo": "Hacé un carrusel de P3 Negocios sobre …",
    "skill": { "nombre": "carrusel-p3-negocios", "repo": "https://github.com/…" }
  },
  "requisitos": [
    { "nombre": "carousel-builder", "tipo": "skill", "verificar": "existe .claude/skills/carousel-builder", "instalar": "clonar prc-skills y enlazar" },
    { "nombre": "Pillow", "tipo": "libreria", "verificar": "python -c \"import PIL\"", "instalar": "pip install pillow" },
    { "nombre": "Dropbox", "tipo": "conector", "verificar": "el conector responde list_folder", "instalar": "conectar Dropbox en la app" }
  ],
  "registro": [
    { "clave": "deportista", "descripcion": "el deportista y el negocio" },
    { "clave": "fuentes", "descripcion": "los enlaces de cada dato" },
    { "clave": "nota", "descripcion": "algo para la próxima", "requerido": false }
  ],
  "carpeta": "/Clientes/www.p3planeta.com/p3-negocios/piezas/",
  "metodo": "Opcional: cómo se hace, para procesos sin skill."
}
```

| Campo | Regla |
|---|---|
| `requisitos` | Cada uno con `tipo` (`skill`, `libreria`, `programa`, `conector`, `variable`, `archivo`) y `verificar`, que es lo que la IA ejecuta o mira en esa máquina. `instalar` dice qué hacer si falta. La skill de la ficha cuenta como requisito aunque no esté en la lista |
| `registro` | Los datos que cada iteración tiene que dejar en `datos`. Clave en minúsculas, sin espacios. `requerido: false` los hace opcionales |
| `carpeta` | La carpeta de Dropbox donde va cada iteración, una carpeta por vez |
| `ficha.skill` | Nombre y repositorio. La versión no se anota: es el commit, y cada iteración dice con cuál se hizo |

**Obligatorio para guardar** (`faltasDeFicha`, igual en el panel y en el MCP): `ficha.resumen`,
`ficha.entrada`, `ficha.entrega`, la skill con su repositorio —o `metodo`, si no hay skill—,
una `carpeta` de Dropbox, al menos un requisito y al menos un dato en `registro`.
`pedido_ejemplo` es opcional. Una definición vieja incompleta se sigue leyendo; no se puede
volver a guardar hasta completarla.

Un proceso es un solo registro y se edita en el lugar. El historial del método es el del
repositorio de su skill. En el panel, requisitos y registro se escriben una línea por
elemento: `nombre | tipo | cómo comprobarlo | qué hacer si falta` y `clave | qué es | opcional`.

Las definiciones anteriores a la 2.0 —con `etapas`, `proposito`, `pedido`— se siguen leyendo:
lo que no se usa se ignora. Al editar el proceso en el panel se reemplazan por la forma nueva.

## La iteración

`registrar_iteracion` exige:

- `carpeta`: la carpeta de Dropbox (`https://www.dropbox.com/…` o `/Clientes/…`);
- `archivos`: lo que quedó en esa carpeta, comprobado con el conector de Dropbox;
- `receta`: `pasos`, `herramientas`, `modelo`, `decisiones`, y si los hay `prompts` y `descartes`;
- `datos`: los que pide el registro del proceso;
- en una reproducción, si salió igual y, si no, qué faltó.

Y guarda además la skill con su commit (`«carrusel-p3-negocios @ f31eaf4»`) y el enlace a la
conversación (`https://…` o `claude://…`). Si el proceso no existe y quien registra administra,
`nuevo_proceso` lo crea en el mismo paso con la ficha completa —nombre, `ficha`, `requisitos`,
`registro`, `carpeta` y `metodo` si no hay skill— y la iteración se valida contra ese registro.
Si quien registra no administra, se rechaza: tiene que pedirle a quien administra que lo cree.
Lo producido ya está en Dropbox, así que no se pierde nada.

Registrar no termina con `registrar_iteracion`: las láminas o la portada se adjuntan después con
`adjuntar_a_iteracion`, con el id que devolvió. Una iteración sin imágenes está **incompleta**:
la respuesta de `registrar_iteracion` lo dice —«Falta adjuntar las láminas con
adjuntar_a_iteracion…»— en vez de un «Quedó registrada» a secas, `iteraciones_de_proceso`
devuelve `incompleta: true` y el panel la marca. Para no pasar las imágenes en base64 por el
chat, conviene un script que lea los archivos del disco y llame a `adjuntar_a_iteracion` por
HTTP contra el mismo servidor MCP, con la credencial ya configurada en la máquina.

La plataforma no lee Dropbox: la comprobación la hace la IA con el conector, antes de
registrar. Si la IA no tiene conector, le pregunta a la persona; que el archivo esté en la
carpeta sincronizada de la máquina no alcanza. Si alguna vez una carpeta registrada resulta vacía, el paso siguiente es que el
servidor lo verifique con una credencial de Dropbox propia.

## Lo producido en el almacén propio

**Plataforma 2.4.** Con Dropbox, sumar a alguien a un proceso exigía darle acceso a la cuenta
donde se guarda lo producido. Con almacén propio, quien opera sólo necesita entrar a la
aplicación: ella guarda los archivos y decide quién los ve, con los mismos permisos que el
resto de sus registros.

Se activa con cinco variables (`.env.example`): `ALMACEN_S3_ENDPOINT`, `ALMACEN_S3_BUCKET`,
`ALMACEN_S3_ACCESS_KEY_ID`, `ALMACEN_S3_SECRET_ACCESS_KEY` y, opcional, `ALMACEN_S3_REGION`
(`auto` en R2). Cualquier bucket privado compatible con S3 sirve: Cloudflare R2, Amazon S3,
Supabase Storage. Sin ellas todo sigue como antes. La firma es Signature V4 propia, sin SDK
(`src/platform/storage/firma.ts`), probada contra el ejemplo publicado por AWS en
`scripts/test-almacen.mjs`.

Con almacén:

- La `carpeta` deja de ser obligatoria en el proceso y en la iteración; si viene, es una
  referencia (Dropbox, Drive o lo que el equipo use además). `archivos` también es opcional.
  En la AppSpec, `iteracion.carpeta` tiene que ser opcional.
- Después de `registrar_iteracion`, la IA llama `subir_producido` con nombre, tipo, tamaño y
  MD5 de cada archivo, y recibe una dirección firmada por archivo que vale una hora. Sube con
  un PUT desde la máquina —el archivo no pasa por el chat ni por el servidor—; el
  `Content-MD5` va firmado, así que el almacén rechaza un archivo distinto del declarado.
  Hasta 5 GB por archivo y 200 por iteración.
- `confirmar_producido` consulta el almacén: lo que llegó con el tamaño y el MD5 declarados
  queda **guardado** (`app_stored_file`, con auditoría); lo que no llegó sigue pendiente. Es
  la aplicación la que comprueba, no la persona.
- Una iteración sin lo producido guardado está **incompleta**, igual que sin láminas, y la
  respuesta de `registrar_iteracion` y `confirmar_producido` dice qué falta.
- `iteraciones_de_proceso` devuelve `producido` por iteración; `descargar_producido` da una
  dirección de descarga que vale una hora, a quien puede leer la iteración. En el panel, cada
  archivo se baja desde `/producido/<id>`, que comprueba permisos y redirige a una dirección
  de cinco minutos.
- Borrar una iteración, por el motor o por las herramientas genéricas, borra también lo
  producido del almacén, después de confirmar la transacción.

La vista previa (lo que se mira en el panel y lo que lee otra IA con `read_attachment`) sale
de lo producido: al confirmar, si la iteración todavía no tiene imágenes, `confirmar_producido`
copia del almacén las imágenes guardadas —en el orden de sus nombres, dentro de la política de
adjuntos— y las deja como adjuntos (2.5.4). Antes había que mandarlas otra vez con
`adjuntar_a_iteracion`, y ese paso necesita una credencial de agente guardada en la máquina: quien
se conecta con su propia cuenta subía todo y la iteración quedaba incompleta igual.
`adjuntar_a_iteracion` queda para lo que no es imagen (la portada de un video) o para elegir
otra vista previa. Si la iteración ya tiene imágenes, confirmar no las toca. Una iteración
vieja sin vista previa se arregla llamando de nuevo a `confirmar_producido`.

## Lo que trae el proceso

**Plataforma 2.5.** Repetir un proceso exigía además clonar el repositorio privado de skills y
sincronizar las carpetas compartidas donde viven sus archivos de entrada (una marca, unos
modelos, un canon). Con almacén propio, el proceso **trae** esas cosas:

- Quien administra publica cada **recurso** —una skill o una carpeta de archivos— como un
  `.zip` versionado, con un archivo `.version` en la raíz: `publicar_recurso` da una dirección
  firmada para subirlo y `confirmar_recurso` comprueba tamaño y MD5 y lo deja publicado
  (`app_resource`, migración 220). Una versión publicada no se pisa; la vigente es la última.
- El proceso declara la lista `recursos` (nombres) en su definición, desde `editar_proceso`,
  `nuevo_proceso` o el panel.
- `como_se_hace` devuelve cada recurso con su versión, su SHA-256, una dirección de descarga
  que vale una hora y su destino, que fija la plataforma: `$HOME/.claude/skills/<nombre>` para
  una skill y `$HOME/.claude/recursos/<nombre>` para archivos. La guía empieza por
  «Instalá lo que trae el proceso».
- La IA instala sólo si la versión cambió, comprobando el SHA-256 y descomprimiendo con `tar`.
  **Nunca toca una carpeta que es un enlace o tiene `.git`**: es la máquina donde se edita
  ese recurso, y reemplazarla borraría el original.

Las skills tienen que leer sus entradas de `$HOME/.claude/recursos/<nombre>` y no de rutas
de una carpeta compartida, para que funcionen igual en cualquier máquina. Quien edita los
recursos enlaza esas carpetas a sus originales.

## Las herramientas

| Herramienta | Hace |
|---|---|
| `como_se_hace` | Requisitos, skill, carpeta, qué registrar y la guía completa, con las últimas veces que se hizo y sus imágenes |
| `registrar_iteracion` | Guarda una vez que se hizo, si está completa |
| `iteraciones_de_proceso` | Todas las veces que se hizo, con todo lo registrado |
| `adjuntar_a_iteracion` | Adjunta imágenes o PDF livianos para verlos en el panel. Sin imágenes, la iteración queda incompleta; con almacén, las imágenes subidas con `subir_producido` ya quedan como vista previa al confirmar |
| `editar_proceso` | Sólo para quien administra (los demás no la ven): cambia lo que se manda de un proceso y deja el resto; tiene que quedar completo |
| `subir_producido` | Sólo con almacén: una dirección firmada por archivo para subir lo producido |
| `confirmar_producido` | Sólo con almacén: comprueba en el almacén lo subido y lo da por guardado |
| `descargar_producido` | Sólo con almacén: una dirección para bajar un archivo de lo producido |
| `publicar_recurso` | Sólo quien administra, con almacén: una dirección para subir una versión de un recurso |
| `confirmar_recurso` | Sólo quien administra, con almacén: comprueba la versión subida y la deja publicada |

Comandos (prompts MCP): `registrar`, `reproducir` y `mejorar_proceso`.

Las instrucciones del servidor le dicen a toda IA que adjuntar es parte de registrar. A la de
quien administra le agregan los pasos para crear un proceso, en orden: skill en el repositorio
de la organización, enlazada y probada regenerando la pieza desde la skill; commit y push;
pieza en Dropbox comprobada con el conector (o preguntando a la persona); `registrar_iteracion`
con `nuevo_proceso` y la ficha completa; adjuntar las láminas; comprobar con
`iteraciones_de_proceso` que aparecen.

Toda credencial que registra tiene que tener una persona responsable: la iteración queda a su
nombre.

## El panel

**Procesos** lista lo que el equipo sabe hacer, con la portada de la última pieza. Si la
última iteración no tiene imágenes, la tarjeta lo marca («última incompleta»), y si ninguna
tiene, la portada dice «Incompleta: sin vista previa» en vez de «Sin piezas todavía». La página de
cada proceso muestra qué hace, con qué skill, qué necesita la máquina, qué se registra, dónde
se guarda y las iteraciones como galería o lista. Quien administra, desde ahí:

- **Edita** el proceso, en el lugar.
- **Retira** o **reactiva**: un proceso retirado no aparece entre los vigentes y `como_se_hace`
  no lo devuelve.
- **Borra** el proceso con sus iteraciones, o una iteración sola, con sus imágenes. No se
  deshace. Lo que está en Dropbox no se toca.
- **Edita** una iteración desde su registro.

## Pasar de 1.x a 2.0 en una aplicación instalada

La 2.0 no puede quitar tablas de una aplicación que ya existe: la evolución sólo agrega.
Hay que hacer tres cosas, en este orden:

1. Agregar la entidad `iteracion` con `evolve_app.py` (tomarla del bloque) y quitar los
   permisos de `instancia` y `evento` para que no aparezcan en el panel.
2. Una migración propia en `database/custom/` que copie a `iteracion` las instancias que eran
   iteraciones, con el mismo id para que sus imágenes las sigan, mueva los adjuntos a
   `iteracion` y borre instancias y eventos.
3. Actualizar la plataforma con `update_platform.py`, y borrar a mano las pantallas que ya no
   existen (`src/app/pendientes`, `src/app/trabajo`) y los archivos de `src/platform/processes/`
   que la 2.0 no trae.
