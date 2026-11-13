# Procesos e iteraciones — contrato

**Plataforma 2.0.** Reemplaza al motor de etapas de las versiones 1.2 a 1.12, que queda
descripto como historia en [`process-engine.md`](process-engine.md).

## Qué resuelve

Una sola cosa: que no se pierda cómo alguien del equipo hizo algo con IA en su máquina, y que
otra persona lo repita en otra máquina, con otra IA.

- **El proceso sabe qué hace falta.** Qué tiene que tener la máquina, con cómo comprobarlo y
  cómo instalarlo; qué hay que registrar cada vez; dónde se guarda lo producido. La persona no
  tiene que inventarlo ni recordarlo.
- **Lo producido queda en Dropbox.** Una iteración sin carpeta de Dropbox y sin la lista de
  archivos que quedaron ahí no se registra.
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

## Las herramientas

| Herramienta | Hace |
|---|---|
| `como_se_hace` | Requisitos, skill, carpeta, qué registrar y la guía completa, con las últimas veces que se hizo y sus imágenes |
| `registrar_iteracion` | Guarda una vez que se hizo, si está completa |
| `iteraciones_de_proceso` | Todas las veces que se hizo, con todo lo registrado |
| `adjuntar_a_iteracion` | Adjunta imágenes o PDF livianos para verlos en el panel. Obligatorio en piezas visuales: sin imágenes, la iteración queda incompleta |
| `editar_proceso` | Sólo para quien administra (los demás no la ven): cambia lo que se manda de un proceso y deja el resto; tiene que quedar completo |

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
tiene, la portada dice «Incompleta: falta adjuntar las láminas» en vez de «Sin piezas todavía». La página de
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
