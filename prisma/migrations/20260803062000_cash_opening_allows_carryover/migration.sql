-- Los saldos de apertura pasan a admitir negativos.
--
-- No es una licencia para declarar cualquier cosa: Zod sigue rechazando un monto de
-- apertura negativo en `POST /open`, que es por donde entra una PERSONA. Lo que estos
-- CHECKs bloqueaban era la CONTINUACIÓN, que es un valor derivado: cuando un turno
-- termina con el esperado en negativo —los egresos superaron lo que entró, o sea que
-- falta registrar un ingreso—, la caja siguiente tiene que arrancar con ese número.
--
-- Forzarlo a 0 sería inventar plata y borrar justo el desvío que la caja existe para
-- mostrar; y dejar el CHECK hacía que cerrar el día reventara con un 500 en el único
-- momento en que el problema estaba a la vista. El aviso de "esperado negativo" sigue
-- señalándolo en el panel hasta que alguien cargue el ingreso que falta.

ALTER TABLE "CashRegisterSession" DROP CONSTRAINT "CashRegisterSession_opening_nonneg_check";
ALTER TABLE "CashRegisterSession" DROP CONSTRAINT "CashRegisterSession_opening_transfer_nonneg_check";
