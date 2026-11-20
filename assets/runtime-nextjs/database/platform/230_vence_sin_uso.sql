-- Una credencial de agente vence cuando deja de usarse, no a fecha fija.
--
-- Hasta acá cada credencial vencía a los N días de creada, aunque se usara todos los días:
-- al vencer, la conexión dejaba de andar y renovarla obligaba a quien la usaba a reemplazar
-- la clave en un archivo de configuración de su máquina. Ahora cada uso corre el
-- vencimiento: vence a los `renew_days` días sin uso. Una clave en uso no vence; una que
-- quedó olvidada (una persona que se fue, una máquina que ya no está) se apaga sola.
--
-- `renew_days` es el plazo elegido al crear la conexión. Para las que ya existían se toma
-- el que tenían: la distancia entre su creación y su vencimiento.

ALTER TABLE app_agent ADD COLUMN IF NOT EXISTS renew_days integer CHECK (renew_days BETWEEN 1 AND 3650);

UPDATE app_agent
   SET renew_days = LEAST(3650, GREATEST(1, round(extract(epoch FROM (expires_at - created_at)) / 86400)::integer))
 WHERE renew_days IS NULL AND expires_at IS NOT NULL;
