const cooldowns = new Map();
let version = 0;
const listeners = new Set();
export const subscribeCooldown = (listener) => { listeners.add(listener); return () => listeners.delete(listener); };
export const cooldownVersion = () => version;
export const activeCooldowns = () => [...cooldowns.values()].filter((until) => until > Date.now());
function changed() { version += 1; listeners.forEach((listener) => listener()); }

export async function apiFetch(path, options = {}) {
  const key = `${options.method || "GET"}:${String(path).split("?")[0]}`;
  const until = cooldowns.get(key) || 0;
  if (until > Date.now()) throw new Error(`Please wait ${Math.ceil((until - Date.now()) / 1000)} seconds before trying again.`);
  const response = await fetch(path, { ...options, cache: "no-store" });
  if (response.status === 429) {
    const value = response.headers.get("Retry-After");
    const seconds = Number(value);
    const delay = value && Number.isFinite(seconds) ? Math.max(1, seconds) * 1000 : Math.max(1000, (Date.parse(value) || Date.now() + 60000) - Date.now());
    const expires = Date.now() + delay;
    cooldowns.set(key, expires);
    changed();
    setTimeout(() => { if (cooldowns.get(key) === expires) { cooldowns.delete(key); changed(); } }, delay);
  }
  return response;
}
