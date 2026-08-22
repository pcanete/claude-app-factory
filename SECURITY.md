# Política de seguridad

No reportes una vulnerabilidad sospechada en un issue público, y no incluyas en el reporte credenciales reales, registros de clientes ni logs de producción.

Usá el reporte privado de vulnerabilidades de GitHub para este repositorio cuando esté disponible. Incluí la versión o el commit afectado, el impacto, la reproducción mínima y, si la conocés, una mitigación propuesta.

Las aplicaciones generadas tienen dueños y despliegues independientes. Una vulnerabilidad en la extensión de un cliente se reporta a quien sea dueño de esa aplicación; una vulnerabilidad en el compilador compartido o en la plantilla del runtime va acá.

Claude App Factory es un proyecto en etapa temprana. Una aplicación generada no está lista para producción hasta que se hayan revisado, para su caso de uso real, sus controles de autenticación, autorización, base de datos, migraciones, respaldos, manejo de secretos y observabilidad.
