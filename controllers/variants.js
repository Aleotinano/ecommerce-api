import { VariantModel } from "../services/variants.js";
import {
  deleteCloudinaryImage,
  uploadImageToCloudinary,
} from "../lib/imageManager.js";
import {
  cleanupUploadedImage,
  getUploadedImageFile,
} from "../middleware/upload.js";

const VARIANT_IMAGE_ENTITY = "variants";

export class variantsController {
  static async getAll(req, res, next) {
    try {
      const { productId } = req.params;
      const variants = await VariantModel.getVariants({
        productId: Number(productId),
      });

      return res.json({ variants });
    } catch (error) {
      next(error);
    }
  }

  static async create(req, res, next) {
    const uploadedFile = getUploadedImageFile(req);
    let uploadedImage;

    try {
      const { productId } = req.params;
      const { color, size, price, stock, img, isActive } = req.body;

      if (uploadedFile) {
        uploadedImage = await uploadImageToCloudinary(uploadedFile.path, {
          entity: VARIANT_IMAGE_ENTITY,
        });
      }

      const variant = await VariantModel.createVariant({
        productId: Number(productId),
        color,
        size,
        price,
        stock,
        img: uploadedImage?.img ?? img,
        imgPublicId: uploadedImage?.imgPublicId ?? null,
        isActive,
      });

      return res.status(201).json({ message: "Variante creada", variant });
    } catch (error) {
      if (uploadedImage?.imgPublicId) {
        await deleteCloudinaryImage(uploadedImage.imgPublicId).catch(() => {});
      }
      next(error);
    } finally {
      await cleanupUploadedImage(req).catch(() => {});
    }
  }

  static async edit(req, res, next) {
    const uploadedFile = getUploadedImageFile(req);
    let uploadedImage;

    try {
      const { productId, id: variantId } = req.params;
      const existing = await VariantModel.getByIdForManagement({
        productId: Number(productId),
        variantId: Number(variantId),
      });
      const { color, size, price, stock, img, isActive } = req.body;

      const imageData = {};
      let shouldDeletePreviousImage = false;

      if (uploadedFile) {
        uploadedImage = await uploadImageToCloudinary(uploadedFile.path, {
          entity: VARIANT_IMAGE_ENTITY,
        });
        imageData.img = uploadedImage.img;
        imageData.imgPublicId = uploadedImage.imgPublicId;
        shouldDeletePreviousImage = Boolean(existing.imgPublicId);
      } else if (img !== undefined && img !== existing.img) {
        imageData.img = img;
        imageData.imgPublicId = null;
        shouldDeletePreviousImage = Boolean(existing.imgPublicId);
      }

      const variant = await VariantModel.editVariant(
        { productId: Number(productId), variantId: Number(variantId) },
        {
          color,
          size,
          price,
          stock,
          isActive,
          ...imageData,
        }
      );

      if (shouldDeletePreviousImage) {
        await deleteCloudinaryImage(existing.imgPublicId);
      }

      return res.json({ message: "Variante actualizada", variant });
    } catch (error) {
      if (uploadedImage?.imgPublicId) {
        await deleteCloudinaryImage(uploadedImage.imgPublicId).catch(() => {});
      }
      next(error);
    } finally {
      await cleanupUploadedImage(req).catch(() => {});
    }
  }

  static async delete(req, res, next) {
    try {
      const { productId, id: variantId } = req.params;
      const existing = await VariantModel.getByIdForManagement({
        productId: Number(productId),
        variantId: Number(variantId),
      });

      if (existing.imgPublicId) {
        await deleteCloudinaryImage(existing.imgPublicId);
      }

      await VariantModel.deleteVariant({
        productId: Number(productId),
        variantId: Number(variantId),
      });

      return res.json({ message: "Variante eliminada" });
    } catch (error) {
      next(error);
    }
  }
}
