-- `PENDING` pasa a llamarse `NEW`. Es un rename de ETIQUETA, no un valor nuevo:
-- Postgres conserva el OID del label, así que las filas existentes de "Order" y
-- "OrderStatusHistory" quedan apuntando al mismo valor, el DEFAULT de la columna
-- (guardado como Const con ese OID) sigue siendo válido, y la posición dentro del
-- tipo no se mueve — un `ORDER BY status` ordena igual que antes. No hay backfill.
--
-- Por eso se escribe a mano y no se deja que Prisma genere el diff: para el diff
-- automático un rename es un valor que desaparece y otro que aparece, o sea
-- drop + create del tipo, que sí tocaría todas las filas.
ALTER TYPE "OrderStatus" RENAME VALUE 'PENDING' TO 'NEW';
