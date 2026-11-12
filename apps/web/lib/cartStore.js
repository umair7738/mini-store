export function createCartStore(request) {
  let confirmed = null, active = null, timer, loading, running = false, error = "", unresolved = false, dueAt = 0;
  const quantities = new Map(), additions = [], listeners = new Set();
  let state = { cart: null, pending: false, unresolved: false, error: "", status: "Loading cart…" };
  function publish() {
    let cart = confirmed;
    if (cart) {
      const targets = new Map(active?.kind === "quantity" ? [[active.id, active.quantity]] : []);
      quantities.forEach((quantity, id) => targets.set(id, quantity));
      const items = cart.items.map((item) => {
        const quantity = targets.has(item.productId) ? targets.get(item.productId) : item.quantity;
        return { ...item, quantity, lineTotalFils: quantity * item.priceFils };
      }).filter((item) => item.quantity > 0);
      cart = { ...cart, items, totalFils: items.reduce((sum, item) => sum + item.lineTotalFils, 0) };
    }
    const pending = running || quantities.size > 0 || additions.length > 0;
    state = { cart, pending, unresolved, error, status: unresolved ? "Cart could not be confirmed. Retry before checkout." : pending ? "Saving cart…" : confirmed ? "Cart saved" : "Loading cart…" };
    listeners.forEach((listener) => listener());
  }
  async function read() {
    const response = await request("/api/cart");
    if (!response.ok) throw new Error("Cart is unavailable. Please try again.");
    confirmed = await response.json();
    unresolved = false;
    error = "";
  }
  function load(force = false) {
    if (confirmed && !force && !unresolved) return Promise.resolve();
    if (!loading) loading = read().catch((problem) => { unresolved = true; error = problem.message; }).finally(() => { loading = null; publish(); });
    return loading;
  }
  async function pump() {
    if (running || unresolved) return;
    clearTimeout(timer);
    running = true;
    publish();
    await (loading || (confirmed ? Promise.resolve() : load()));
    while (!unresolved && (quantities.size || additions.length)) {
      if (quantities.size && dueAt > Date.now()) { timer = setTimeout(pump, dueAt - Date.now()); break; }
      if (quantities.size) {
        const [id, quantity] = quantities.entries().next().value;
        quantities.delete(id);
        active = { kind: "quantity", id, quantity };
      } else active = additions.shift();
      const job = active;
      publish();
      try {
        const response = await request(job.kind === "add" ? "/api/cart/items" : `/api/cart/items/${job.id}`, {
          method: job.kind === "add" ? "POST" : job.quantity === 0 ? "DELETE" : "PATCH",
          headers: { "Content-Type": "application/json" },
          ...(job.quantity !== 0 && { body: JSON.stringify(job.kind === "add" ? { productId: job.id, quantity: job.quantity } : { quantity: job.quantity }) }),
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.message || "Cart update failed");
        confirmed = data;
        error = "";
        job.resolve?.(data);
      } catch (problem) {
        quantities.clear();
        additions.splice(0).forEach((queued) => queued.reject(problem));
        active = null;
        try { await read(); } catch { unresolved = true; }
        error = problem.message || "Cart update failed. Please retry.";
        job.reject?.(problem);
      }
      active = null;
      publish();
    }
    running = false;
    publish();
  }
  return {
    subscribe: (listener) => { listeners.add(listener); return () => listeners.delete(listener); },
    getSnapshot: () => state,
    load,
    retry: async () => { if (running) return; await load(true); if (!unresolved) pump(); },
    change(id, quantity) {
      const item = state.cart?.items.find((item) => item.productId === id);
      if (!item || unresolved || !Number.isInteger(quantity) || quantity < 0 || (quantity > 0 && quantity > Math.min(20, item.stock))) return;
      quantities.set(id, quantity);
      dueAt = quantity === 0 ? 0 : Date.now() + 300;
      error = "";
      publish();
      clearTimeout(timer);
      timer = setTimeout(pump, quantity === 0 ? 0 : 300);
    },
    add(id, quantity) {
      if (unresolved) return Promise.reject(new Error("Confirm the cart before adding another item."));
      return new Promise((resolve, reject) => { additions.push({ kind: "add", id, quantity, resolve, reject }); publish(); pump(); });
    },
    replace(cart) { confirmed = cart; publish(); },
  };
}
