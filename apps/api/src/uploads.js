import { randomUUID } from "node:crypto";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Router } from "express";
import multer from "multer";
import { HttpError } from "./validation.js";

export const uploadsRouter = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { files: 8, fileSize: 8 * 1024 * 1024 } });
export const uploadDir = resolve(dirname(fileURLToPath(import.meta.url)), "../../..", "web", "public", "uploads", "products");

function imageType(buffer) {
  if (buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return "png";
  if (buffer[0] === 255 && buffer[1] === 216 && buffer[2] === 255) return "jpg";
  if (buffer.toString("ascii", 0, 4) === "RIFF" && buffer.toString("ascii", 8, 12) === "WEBP") return "webp";
  return null;
}

uploadsRouter.post("/images", (req, res, next) => upload.array("images", 8)(req, res, (error) => {
  if (error) return next(new HttpError(400, "INVALID_UPLOAD", "Upload up to 8 images, each no larger than 8 MB"));
  next();
}), async (req, res) => {
  if (!req.files?.length) throw new HttpError(400, "INVALID_UPLOAD", "Choose at least one image");
  await mkdir(uploadDir, { recursive: true });
  const images = [];
  const written = [];
  try {
    for (const file of req.files) {
      const extension = imageType(file.buffer);
      if (!extension) throw new HttpError(400, "INVALID_UPLOAD", "Use PNG, JPEG, or WebP image files");
      const filename = `${randomUUID()}.${extension}`;
      const filePath = resolve(uploadDir, filename);
      await writeFile(filePath, file.buffer, { flag: "wx" });
      written.push(filePath);
      images.push(`/uploads/products/${filename}`);
    }
  } catch (error) {
    await Promise.allSettled(written.map((filePath) => unlink(filePath)));
    throw error;
  }
  res.status(201).json({ images });
});
