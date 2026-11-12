"use client";

import { useRef, useState } from "react";
import { singleFlight } from "./singleFlight";
import { notify } from "./Toast";

export function usePending() {
  const [busy, setBusy] = useState(false);
  const run = useRef(null);
  if (!run.current) run.current = singleFlight(async (action) => {
    setBusy(true);
    try { return await action(); }
    catch (error) { notify(error.message || "Request failed. Please try again.", "error"); }
    finally { setBusy(false); }
  });
  return [busy, run.current];
}
