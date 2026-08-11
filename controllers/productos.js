import { ProductModel } from "../services/productos.js";
import {
  deleteCloudinaryImage,
  uploadImageToCloudinary,
} from "../lib/imageManager.js";
import {
  cleanupUploadedImage,
  getUploadedImageFile,
} from "../middleware/upload.js";

const PRODUCT_IMAGE_ENTITY = "products";

export class productsController {
  static async getAll(req, res, next) {
    try {
      const {
        name,
        categoryId,
        type,
        attributes,
        minPrice,
        maxPrice,
        limit,
        offset,
      } = req.search;

      const isAdmin = req.user?.role === "ADMIN" || req.user?.role === "STAFF";

      const pagination = await ProductModel.getAll({
        tenantId: req.tenantId,
        name,
        categoryId,
        type,
        variantAttributes: attributes,
        minPrice,
        maxPrice,
        limit,
        offset,
        includeInactive: isAdmin,
      });

      return res.json(pagination);
    } catch (error) {
      next(error);
    }
  }

  static async getVariantOptions(req, res, next) {
    try {
      const options = await ProductModel.getVariantOptions({
        tenantId: req.tenantId,
      });
      return res.json(options);
    } catch (error) {
      next(error);
    }
  }

  static async getStats(req, res, next) {
    try {
      const stats = await ProductModel.getStats({ tenantId: req.tenantId });
      return res.json(stats);
    } catch (error) {
      next(error);
    }
  }

  static async getComboOptions(req, res, next) {
    try {
      const { id } = req.params;
      const options = await ProductModel.getComboOptions({
        tenantId: req.tenantId,
        id,
      });
      return res.json(options);
    } catch (error) {
      next(error);
    }
  }

  static async getById(req, res, next) {
    try {
      const { id } = req.params;
      const product = await ProductModel.getById({ tenantId: req.tenantId, id });

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
        price,
        compareAtPrice,
        stock,
        img,
        isActive,
        type,
        variants = [],
        comboMinItems,
        comboMaxItems,
        comboOptions,
        comboCategoryOptions,
      } = req.body;

      if (uploadedFile) {
        uploadedImage = await uploadImageToCloudinary(uploadedFile.path, {
          tenantId: req.tenantId,
          entity: PRODUCT_IMAGE_ENTITY,
        });
      }

      const newProduct = await ProductModel.create({
        tenantId: req.tenantId,
        name,
        description,
        categoryId,
        price,
        compareAtPrice,
        stock,
        img: uploadedImage?.img ?? img,
        imgPublicId: uploadedImage?.imgPublicId ?? null,
        isActive,
        type,
        variants,
        comboMinItems,
        comboMaxItems,
        comboOptions,
        comboCategoryOptions,
      });

      return res.status(201).json({
        message: "producto creado",
        producto: newProduct,
      });
    } catch (error) {
      if (uploadedImage?.imgPublicId) {
        await deleteCloudinaryImage(uploadedImage.imgPublicId, {
          tenantId: req.tenantId,
        }).catch(() => {});
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
      const existing = await ProductModel.getByIdForManagement({
        tenantId: req.tenantId,
        id,
      });
      const {
        name,
        description,
        categoryId,
        price,
        compareAtPrice,
        img,
        isActive,
        type,
        variants,
        comboMinItems,
        comboMaxItems,
        comboOptions,
        comboCategoryOptions,
      } = req.body;

      const imageData = {};
      let shouldDeletePreviousImage = false;

      if (uploadedFile) {
        uploadedImage = await uploadImageToCloudinary(uploadedFile.path, {
          tenantId: req.tenantId,
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
        { tenantId: req.tenantId, id },
        {
          name,
          description,
          categoryId,
          price,
          compareAtPrice,
          isActive,
          type,
          variants,
          comboMinItems,
          comboMaxItems,
          comboOptions,
          comboCategoryOptions,
          ...imageData,
        }
      );

      if (shouldDeletePreviousImage) {
        await deleteCloudinaryImage(existing.imgPublicId, {
          tenantId: req.tenantId,
        });
      }

      return res.json({
        message: "Producto actualizado",
        product: updatedProduct,
      });
    } catch (error) {
      if (uploadedImage?.imgPublicId) {
        await deleteCloudinaryImage(uploadedImage.imgPublicId, {
          tenantId: req.tenantId,
        }).catch(() => {});
      }
      next(error);
    } finally {
      await cleanupUploadedImage(req).catch(() => {});
    }
  }

  static async assignCategory(req, res, next) {
    try {
      const { id } = req.params;
      const { categoryId } = req.body;

      const updatedProduct = await ProductModel.assignCategory({
        tenantId: req.tenantId,
        id,
        categoryId,
      });

      return res.json({
        message: "Categoría del producto actualizada",
        product: updatedProduct,
      });
    } catch (error) {
      next(error);
    }
  }

  static async delete(req, res, next) {
    try {
      const { id } = req.params;
      const existing = await ProductModel.getByIdForManagement({
        tenantId: req.tenantId,
        id,
      });

      if (existing.imgPublicId) {
        await deleteCloudinaryImage(existing.imgPublicId, {
          tenantId: req.tenantId,
        });
      }

      const deletedProduct = await ProductModel.delete({
        tenantId: req.tenantId,
        id,
      });

      return res.json({
        message: "Producto eliminado correctamente",
        product: deletedProduct,
      });
    } catch (error) {
      next(error);
    }
  }
}
