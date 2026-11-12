export function singleFlight(action) {
  let pending = false;
  return async (...args) => {
    if (pending) return;
    pending = true;
    try { return await action(...args); }
    finally { pending = false; }
  };
}
