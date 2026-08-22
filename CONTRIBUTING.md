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

## Pull requests

- Mantené intactas las fronteras entre el código generado y el que es del cliente.
- Agregá o actualizá pruebas del comportamiento del compilador.
- Documentá las variables de entorno nuevas y los controles previos a producción.
- Nunca incluyas credenciales, datos de clientes, secretos de despliegue ni archivos `.env` locales.
- Señalá de forma explícita las migraciones, los efectos de seguridad y los riesgos de compatibilidad hacia atrás.

Los pull requests chicos y enfocados son más fáciles de revisar y de reutilizar.
