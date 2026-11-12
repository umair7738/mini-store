import { HttpError } from "./validation.js";

export function pagination(query) {
  if (typeof query.page !== "string" || !/^[1-9]\d{0,7}$/.test(query.page)) throw new HttpError(400, "INVALID_INPUT", "Invalid page number");
  if (query.search !== undefined && (typeof query.search !== "string" || query.search.length > 254)) throw new HttpError(400, "INVALID_INPUT", "Invalid search");
  return { page: Number(query.page), search: (query.search || "").trim(), size: 10 };
}
