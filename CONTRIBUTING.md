# Cómo contribuir

Gracias por ayudar a mejorar Claude App Factory.

## Antes de tocar el código

1. Abrí o referenciá un issue que describa la capacidad de negocio y por qué corresponde a la base neutral.
2. Confirmá que el cambio no deja fijo en el código un CRM, un ERP ni el dominio de un cliente anterior.
3. Decidí si va en la estructura generada o del lado de la extensión del cliente.

## Verificaciones de desarrollo

Desde la raíz del repositorio:

```bash
python scripts/test_scaffold.py
python scripts/scaffold_app.py \
  --spec references/example-maintenance.app-spec.json \
  --output ../maintenance-demo
python scripts/verify_scaffold.py ../maintenance-demo
```

Si el cambio toca el runtime, además instalá las dependencias de la aplicación generada, corré `pnpm typecheck` o `pnpm build`, aplicá las migraciones contra una base PostgreSQL descartable, corré `pnpm db:smoke` y recorré un camino de ABM completo en un navegador real.

## Una invariante que el revisor no tiene que recordar

Una entidad puede declarar `record_access`: quién ve todos sus registros y quién sólo
los propios. El control no vive en las pantallas sino en `src/lib/repository.ts`, que es
el único lugar donde se arma SQL contra las tablas de entidades.

Por eso hay dos reglas, y las dos las verifica `node scripts/test-record-access.mjs`
dentro de la aplicación generada:

- **Toda función del repositorio que consulte la base aplica alcance** —filtrando en SQL,
  delegando en quien filtra, o fijando el dueño al crear— o se declara exenta con motivo
  escrito en `EXENTAS`.
- **Todo archivo que importe el repositorio y lo invoque pasa identidad**, tanto para leer
  como para escribir.

La prueba no lee una lista de funciones a revisar: recorre el repositorio y el árbol de
rutas y falla ante lo que no conoce. Agregar una consulta sin alcance rompe el CI el día
que se escribe, no el día que alguien la audita. Si tu cambio necesita una excepción,
escribí el motivo; que quede a la vista en la revisión es la mitad del control.

Esa prueba comprueba que el filtro esté escrito. **Que además filtre lo comprueba
`pnpm db:access`**, que siembra dos personas del mismo rol acotado en una base
descartable y ejerce el repositorio real —importado, no reescrito— con la identidad de
cada una: quién lee qué, quién puede modificar y borrar qué, y qué pasa al asignar una
relación ajena. Corre en el CI contra PostgreSQL.

Las dos hacen falta y ninguna reemplaza a la otra. La matriz sólo falla en los caminos
que ejercita, así que una ruta nueva sin alcance la esquiva sin hacer ruido; el recorrido
del código encuentra esa ruta pero no puede afirmar nada sobre el comportamiento. Una
responde "¿está puesto el control?" y la otra "¿funciona?".

## Pull requests

- Mantené intactas las fronteras entre el código generado y el que es del cliente.
- Agregá o actualizá pruebas del comportamiento del compilador.
- Documentá las variables de entorno nuevas y los controles previos a producción.
- Nunca incluyas credenciales, datos de clientes, secretos de despliegue ni archivos `.env` locales.
- Señalá de forma explícita las migraciones, los efectos de seguridad y los riesgos de compatibilidad hacia atrás.

Los pull requests chicos y enfocados son más fáciles de revisar y de reutilizar.
