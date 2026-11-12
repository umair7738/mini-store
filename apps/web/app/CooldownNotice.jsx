"use client";
import { useEffect, useState, useSyncExternalStore } from "react";
import { activeCooldowns, subscribeCooldown, cooldownVersion } from "../lib/apiFetch";

export function useCooldown() {
  useSyncExternalStore(subscribeCooldown, cooldownVersion, () => 0);
  return activeCooldowns().length > 0;
}
export default function CooldownNotice() {
  const active = useCooldown();
  const [now, setNow] = useState(0);
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [active]);
  if (!active) return null;
  const seconds = Math.max(1, Math.ceil((Math.max(...activeCooldowns()) - (now || Date.now())) / 1000));
  return <div className="cooldown-notice" role="status">Too many requests. Try again in {seconds} seconds. Your action will not be retried automatically.</div>;
}
