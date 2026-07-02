import { CategoryModel } from "../services/categories.js";
import {
  deleteCloudinaryImage,
  uploadImageToCloudinary,
} from "../lib/imageManager.js";
import {
  cleanupUploadedImage,
  getUploadedImageFile,
} from "../middleware/upload.js";

const CATEGORY_IMAGE_ENTITY = "categories";

export class CategoryController {
  static async getAll(req, res, next) {
    try {
      const includeChildren = req.query.includeChildren === "true";
      const categories = await CategoryModel.getAll({
        tenantId: req.tenantId,
        includeChildren,
      });
      res.json(categories);
    } catch (error) {
      next(error);
    }
  }

  static async getTree(req, res, next) {
    try {
      const categories = await CategoryModel.getTree({ tenantId: req.tenantId });
      res.json(categories);
    } catch (error) {
      next(error);
    }
  }

  static async getById(req, res, next) {
    try {
      const { id } = req.params;
      const category = await CategoryModel.getById({
        tenantId: req.tenantId,
        id,
      });

      res.json({ message: "categoria", category: category });
    } catch (error) {
      next(error);
    }
  }

  static async create(req, res, next) {
    const uploadedFile = getUploadedImageFile(req);
    let uploadedImage;

    try {
      const { name, description, isActive, icon, imageUrl, parentId } = req.body;

      if (uploadedFile) {
        uploadedImage = await uploadImageToCloudinary(uploadedFile.path, {
          entity: CATEGORY_IMAGE_ENTITY,
        });
      }

      const category = await CategoryModel.create({
        tenantId: req.tenantId,
        name,
        description,
        isActive,
        icon,
        imageUrl: uploadedImage?.img ?? imageUrl,
        imgPublicId: uploadedImage?.imgPublicId ?? null,
        parentId,
      });

      res.status(201).json({
        message: "Categoria creada",
        category: category,
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
      const existing = await CategoryModel.getByIdForManagement({
        tenantId: req.tenantId,
        id,
      });
      const { name, description, isActive, icon, imageUrl, parentId } = req.body;

      const imageData = {};
      let shouldDeletePreviousImage = false;

      if (uploadedFile) {
        uploadedImage = await uploadImageToCloudinary(uploadedFile.path, {
          entity: CATEGORY_IMAGE_ENTITY,
        });
        imageData.imageUrl = uploadedImage.img;
        imageData.imgPublicId = uploadedImage.imgPublicId;
        shouldDeletePreviousImage = Boolean(existing.imgPublicId);
      } else if (imageUrl !== undefined && imageUrl !== existing.imageUrl) {
        imageData.imageUrl = imageUrl;
        imageData.imgPublicId = null;
        shouldDeletePreviousImage = Boolean(existing.imgPublicId);
      }

      const category = await CategoryModel.edit({
        tenantId: req.tenantId,
        id,
        name,
        description,
        isActive,
        icon,
        parentId,
        ...imageData,
      });

      if (shouldDeletePreviousImage) {
        await deleteCloudinaryImage(existing.imgPublicId);
      }

      res.json({ message: "Categoria editada", category: category });
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

      const category = await CategoryModel.delete({
        tenantId: req.tenantId,
        id,
      });

      if (category.imgPublicId) {
        await deleteCloudinaryImage(category.imgPublicId).catch(() => {});
      }

      res.json({ message: "Categoria eliminada", category });
    } catch (error) {
      next(error);
    }
  }
}
