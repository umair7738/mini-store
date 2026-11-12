const timezone = "Asia/Dubai";

export function formatDate(date, options) {
  return new Intl.DateTimeFormat("en-AE", { ...options, timeZone: timezone }).format(new Date(date));
}

export function dateKey(date) {
  const parts = new Intl.DateTimeFormat("en", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(date));
  return `${parts.find((part) => part.type === "year").value}-${parts.find((part) => part.type === "month").value}-${parts.find((part) => part.type === "day").value}`;
}
