import { randomUUID } from "node:crypto";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Router } from "express";
import multer from "multer";
import sharp from "sharp";
import { HttpError } from "./validation.js";

export const uploadsRouter = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { files: 8, fileSize: 8 * 1024 * 1024 } });
export const uploadDir = resolve(dirname(fileURLToPath(import.meta.url)), "../../..", "web", "public", "uploads", "products");

let activeUploads = 0;

uploadsRouter.post("/images", (req, res, next) => {
  if (!req.is("multipart/form-data")) return next(new HttpError(415, "INVALID_UPLOAD", "Use a multipart image upload"));
  if (activeUploads >= 2) { res.set("Retry-After", "5"); return next(new HttpError(429, "UPLOAD_BUSY", "Uploads are busy. Try again shortly.")); }
  activeUploads += 1;
  // Keep the slot until parsing/processing finishes, even if the client disconnects.
  req.releaseUpload = () => { activeUploads -= 1; };
  next();
}, (req, res, next) => upload.array("images", 8)(req, res, (error) => {
  if (error) { req.releaseUpload(); return next(new HttpError(error.code === "LIMIT_FILE_SIZE" ? 413 : 400, "INVALID_UPLOAD", "Upload up to 8 images, each no larger than 8 MB")); }
  next();
}), async (req, res) => {
  const images = [];
  const written = [];
  try {
    if (!req.files?.length) throw new HttpError(400, "INVALID_UPLOAD", "Choose at least one image");
    await mkdir(uploadDir, { recursive: true });
    for (const file of req.files) {
      let buffer, extension;
      try {
        const image = sharp(file.buffer, { limitInputPixels: 20_000_000, failOn: "warning" });
        const metadata = await image.metadata();
        if (!["png", "jpeg", "webp"].includes(metadata.format) || (metadata.pages || 1) > 1) throw new Error("Unsupported image");
        extension = metadata.format === "jpeg" ? "jpg" : metadata.format;
        buffer = await image.rotate().toFormat(metadata.format).toBuffer();
      } catch { throw new HttpError(400, "INVALID_UPLOAD", "Use valid PNG, JPEG, or WebP images up to 20 million pixels"); }
      const filename = `${randomUUID()}.${extension}`;
      const filePath = resolve(uploadDir, filename);
      await writeFile(filePath, buffer, { flag: "wx" });
      written.push(filePath);
      images.push(`/uploads/products/${filename}`);
    }
  } catch (error) {
    await Promise.allSettled(written.map((filePath) => unlink(filePath)));
    throw error;
  } finally { req.releaseUpload(); }
  res.status(201).json({ images });
});
