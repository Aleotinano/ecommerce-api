import { ProductModel } from "../services/productos.js";
import {
  deleteCloudinaryImage,
  uploadImageToCloudinary,
} from "../lib/imageManager.js";
import { cleanupUploadedImage, getUploadedImageFile } from "../middleware/upload.js";

const PRODUCT_IMAGE_ENTITY = "products";

export class productsController {
  static async getAll(req, res, next) {
    try {
      const {
        name,
        categoryId,
        variantColor,
        variantSize,
        minPrice,
        maxPrice,
        limit,
        offset,
      } = req.search;

      const pagination = await ProductModel.getAll({
        name,
        categoryId,
        variantColor,
        variantSize,
        minPrice,
        maxPrice,
        limit,
        offset,
      });

      return res.json(pagination);
    } catch (error) {
      next(error);
    }
  }

  static async getVariantOptions(req, res, next) {
    try {
      const options = await ProductModel.getVariantOptions();
      return res.json(options);
    } catch (error) {
      next(error);
    }
  }

  static async getById(req, res, next) {
    try {
      const { id } = req.params;
      const product = await ProductModel.getById({ id });

      return res.json(product);
    } catch (error) {
      next(error);
    }
  }

  static async create(req, res, next) {
    const uploadedFile = getUploadedImageFile(req);
    let uploadedImage;

    try {
      const {
        name,
        description,
        categoryId,
        img,
        isActive,
        variants = [],
      } = req.body;

      if (uploadedFile) {
        uploadedImage = await uploadImageToCloudinary(uploadedFile.path, {
          entity: PRODUCT_IMAGE_ENTITY,
        });
      }

      const newProduct = await ProductModel.create({
        name,
        description,
        categoryId,
        img: uploadedImage?.img ?? img,
        imgPublicId: uploadedImage?.imgPublicId ?? null,
        isActive,
        variants,
      });

      return res.status(201).json({
        message: "producto creado",
        producto: newProduct,
      });
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
      const { id } = req.params;
      const existing = await ProductModel.getByIdForManagement({ id });
      const { name, description, categoryId, img, isActive } = req.body;

      const imageData = {};
      let shouldDeletePreviousImage = false;

      if (uploadedFile) {
        uploadedImage = await uploadImageToCloudinary(uploadedFile.path, {
          entity: PRODUCT_IMAGE_ENTITY,
        });
        imageData.img = uploadedImage.img;
        imageData.imgPublicId = uploadedImage.imgPublicId;
        shouldDeletePreviousImage = Boolean(existing.imgPublicId);
      } else if (img !== undefined && img !== existing.img) {
        imageData.img = img;
        imageData.imgPublicId = null;
        shouldDeletePreviousImage = Boolean(existing.imgPublicId);
      }

      const updatedProduct = await ProductModel.edit(
        { id },
        {
          name,
          description,
          categoryId,
          isActive,
          ...imageData,
        }
      );

      if (shouldDeletePreviousImage) {
        await deleteCloudinaryImage(existing.imgPublicId);
      }

      return res.json({
        message: "Producto actualizado",
        product: updatedProduct,
      });
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
      const { id } = req.params;
      const existing = await ProductModel.getByIdForManagement({ id });

      if (existing.imgPublicId) {
        await deleteCloudinaryImage(existing.imgPublicId);
      }

      const deletedProduct = await ProductModel.delete({ id });

      return res.json({
        message: "Producto eliminado correctamente",
        product: deletedProduct,
      });
    } catch (error) {
      next(error);
    }
  }
}
