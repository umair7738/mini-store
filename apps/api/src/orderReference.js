import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

function key() {
  return createHash("sha256").update(process.env.CSRF_SECRET).digest();
}

export function encryptOrderReference(publicId) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const encrypted = Buffer.concat([cipher.update(publicId, "utf8"), cipher.final()]);
  return Buffer.concat([Buffer.from([1]), iv, cipher.getAuthTag(), encrypted]).toString("base64url");
}

export function decryptOrderReference(reference) {
  try {
    const value = Buffer.from(reference, "base64url");
    if (value.length < 30 || value[0] !== 1) return null;
    const decipher = createDecipheriv("aes-256-gcm", key(), value.subarray(1, 13));
    decipher.setAuthTag(value.subarray(13, 29));
    return Buffer.concat([decipher.update(value.subarray(29)), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}
