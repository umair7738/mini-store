import sanitizeHtml from "sanitize-html";

export class HttpError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export function object(value, allowedKeys) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new HttpError(400, "INVALID_INPUT", "A JSON object is required");
  }
  if (allowedKeys) {
    const allowed = new Set(allowedKeys);
    const unexpected = Object.keys(value).find((key) => !allowed.has(key));
    if (unexpected) throw new HttpError(400, "UNEXPECTED_FIELD", `Unexpected field: ${unexpected}`);
  }
  return value;
}

export function string(value, name, max = 120, min = 1) {
  if (
    typeof value !== "string" ||
    value.trim().length < min ||
    value.trim().length > max
  ) {
    throw new HttpError(
      400,
      "INVALID_INPUT",
      `${name} must be ${min}–${max} characters`,
    );
  }
  return value.trim();
}

export function richText(value) {
  const html = string(value, "Description", 10000);
  return sanitizeHtml(html, {
    allowedTags: ["p", "br", "strong", "b", "em", "i", "u", "ul", "ol", "li", "h2", "h3", "blockquote", "a"],
    allowedAttributes: { a: ["href", "target", "rel"] },
    allowedSchemes: ["https", "http", "mailto"],
    transformTags: { a: sanitizeHtml.simpleTransform("a", { rel: "noopener noreferrer" }, true) },
  });
}

export function integer(value, name, min = 0, max = 4294967295) {
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new HttpError(
      400,
      "INVALID_INPUT",
      `${name} must be an integer from ${min} to ${max}`,
    );
  }
  return value;
}

export function id(value) {
  const number = Number(value);
  return integer(number, "ID", 1);
}

export function email(value) {
  const result = string(value, "Email", 254).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(result)) {
    throw new HttpError(400, "INVALID_INPUT", "A valid email is required");
  }
  return result;
}

export function phone(value) {
  const result = string(value, "Phone", 30, 7);
  if (!/^[+0-9().\-\s]+$/.test(result) || (result.match(/\d/g) || []).length < 7) {
    throw new HttpError(400, "INVALID_INPUT", "A valid phone number is required");
  }
  return result;
}

export function slug(value) {
  const result = string(value, "Slug", 120);
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(result)) {
    throw new HttpError(
      400,
      "INVALID_INPUT",
      "Slug must use lowercase letters, numbers, and hyphens",
    );
  }
  return result;
}

export function attributes(value) {
  if (value == null) return null;
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new HttpError(400, "INVALID_INPUT", "Attributes must be an object");
  }
  if (
    value.colorHex !== undefined &&
    (typeof value.colorHex !== "string" || !/^#[0-9a-f]{6}$/i.test(value.colorHex))
  ) {
    throw new HttpError(400, "INVALID_INPUT", "Colour swatch must be a valid hex colour");
  }
  return JSON.stringify({
    ...value,
    ...(value.colorHex && { colorHex: value.colorHex.toLowerCase() }),
  });
}

export function webUrl(value, name) {
  const result = string(value, name, 500);
  try {
    const parsed = new URL(result);
    if (!["http:", "https:"].includes(parsed.protocol)) throw new Error();
  } catch {
    throw new HttpError(400, "INVALID_INPUT", `${name} must be a valid web address`);
  }
  return result;
}

export function imageUrl(value) {
  if (value == null || value === "") return null;
  const result = string(value, "Image URL", 500);
  if ((/^\/images\/(?:[a-zA-Z0-9_-]+\/)*[a-zA-Z0-9._-]+$/.test(result) || /^\/uploads\/products\/[a-zA-Z0-9._-]+$/.test(result)) && !result.includes("..")) return result;
  try {
    const parsed = new URL(result);
    if (parsed.protocol !== "https:") throw new Error();
  } catch {
    throw new HttpError(
      400,
      "INVALID_INPUT",
      "Image must be an HTTPS URL or a local product image path",
    );
  }
  return result;
}
