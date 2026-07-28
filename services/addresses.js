import prisma from "../lib/prisma.js";
import { createError } from "../helpers/error.js";

// Tope por usuario: es un endpoint de escritura sin otro límite y una libreta
// realista no pasa de un puñado de lugares.
const MAX_ADDRESSES = 10;

// Sin caché: es data por usuario, /store/* ya responde con `no-store` y los
// namespaces de `delPattern` son solo de catálogo.

const PUBLIC_FIELDS = {
  id: true,
  label: true,
  addressText: true,
  addressLat: true,
  addressLng: true,
  addressDetails: true,
  addressMapsUrl: true,
  isDefault: true,
  createdAt: true,
  updatedAt: true,
};

// El índice único parcial se chequea por statement, no al cerrar la transacción:
// hay que limpiar la default vieja ANTES de escribir la nueva o choca con
// duplicate key.
async function clearDefault(tx, userId, exceptId) {
  await tx.userAddress.updateMany({
    where: {
      userId,
      isDefault: true,
      ...(exceptId !== undefined && { NOT: { id: exceptId } }),
    },
    data: { isDefault: false },
  });
}

function assertHasLocation(addressText, addressMapsUrl) {
  if (addressText == null && addressMapsUrl == null) {
    throw createError(
      "La dirección necesita una dirección escrita y/o un link de Google Maps",
      "ADDRESS_LOCATION_REQUIRED",
      400
    );
  }
}

function isDuplicateLabel(error) {
  return error.code === "P2002";
}

export const AddressModel = {
  async getAll({ tenantId, userId }) {
    return prisma.userAddress.findMany({
      where: { tenantId, userId },
      orderBy: [{ isDefault: "desc" }, { id: "asc" }],
      select: PUBLIC_FIELDS,
    });
  },

  async getById({ tenantId, userId, id }) {
    const address = await prisma.userAddress.findFirst({
      where: { id, tenantId, userId },
      select: PUBLIC_FIELDS,
    });

    if (!address) {
      throw createError("La dirección no existe", "ADDRESS_NOT_FOUND", 404);
    }

    return address;
  },

  async create({
    tenantId,
    userId,
    label,
    addressText,
    addressLat,
    addressLng,
    addressDetails,
    addressMapsUrl,
    isDefault,
  }) {
    return prisma.$transaction(async (tx) => {
      const count = await tx.userAddress.count({ where: { tenantId, userId } });

      if (count >= MAX_ADDRESSES) {
        throw createError(
          `No podés guardar más de ${MAX_ADDRESSES} direcciones`,
          "ADDRESS_LIMIT_REACHED",
          409
        );
      }

      // La primera dirección queda default sola: así el checkout siempre tiene
      // algo preseleccionado.
      const effectiveDefault = isDefault ?? count === 0;
      if (effectiveDefault) await clearDefault(tx, userId);

      try {
        return await tx.userAddress.create({
          data: {
            tenantId,
            userId,
            label,
            addressText: addressText ?? null,
            addressLat: addressLat ?? null,
            addressLng: addressLng ?? null,
            addressDetails: addressDetails ?? null,
            addressMapsUrl: addressMapsUrl ?? null,
            isDefault: effectiveDefault,
          },
          select: PUBLIC_FIELDS,
        });
      } catch (error) {
        if (isDuplicateLabel(error)) {
          throw createError(
            "Ya tenés una dirección con ese nombre",
            "ADDRESS_LABEL_DUPLICATE",
            409
          );
        }
        throw error;
      }
    });
  },

  async edit({
    tenantId,
    userId,
    id,
    label,
    addressText,
    addressLat,
    addressLng,
    addressDetails,
    addressMapsUrl,
    isDefault,
  }) {
    return prisma.$transaction(async (tx) => {
      const address = await tx.userAddress.findFirst({
        where: { id, tenantId, userId },
      });

      if (!address) {
        throw createError("La dirección no existe", "ADDRESS_NOT_FOUND", 404);
      }

      // Se valida la fila MERGEADA, no el payload: un PATCH que borra
      // addressText sobre una fila sin addressMapsUrl la dejaría sin ubicación
      // y el CHECK de la migración saldría como 500.
      assertHasLocation(
        addressText !== undefined ? addressText : address.addressText,
        addressMapsUrl !== undefined ? addressMapsUrl : address.addressMapsUrl
      );

      if (isDefault === true) await clearDefault(tx, userId, id);

      try {
        return await tx.userAddress.update({
          where: { id },
          data: {
            ...(label !== undefined && { label }),
            ...(addressText !== undefined && { addressText }),
            ...(addressLat !== undefined && { addressLat }),
            ...(addressLng !== undefined && { addressLng }),
            ...(addressDetails !== undefined && { addressDetails }),
            ...(addressMapsUrl !== undefined && { addressMapsUrl }),
            ...(isDefault !== undefined && { isDefault }),
          },
          select: PUBLIC_FIELDS,
        });
      } catch (error) {
        if (isDuplicateLabel(error)) {
          throw createError(
            "Ya tenés otra dirección con ese nombre",
            "ADDRESS_LABEL_DUPLICATE",
            409
          );
        }
        throw error;
      }
    });
  },

  async delete({ tenantId, userId, id }) {
    return prisma.$transaction(async (tx) => {
      const address = await tx.userAddress.findFirst({
        where: { id, tenantId, userId },
      });

      if (!address) {
        throw createError("La dirección no existe", "ADDRESS_NOT_FOUND", 404);
      }

      const deleted = await tx.userAddress.delete({
        where: { id },
        select: PUBLIC_FIELDS,
      });

      // Perder la default al borrar es un efecto colateral, no una elección del
      // cliente: promovemos la más vieja que quede para no dejar el checkout sin
      // preselección. (Desmarcarla a mano con PATCH sí se respeta.)
      if (address.isDefault) {
        const next = await tx.userAddress.findFirst({
          where: { tenantId, userId },
          orderBy: { id: "asc" },
          select: { id: true },
        });
        if (next) {
          await tx.userAddress.update({
            where: { id: next.id },
            data: { isDefault: true },
          });
        }
      }

      return deleted;
    });
  },
};
