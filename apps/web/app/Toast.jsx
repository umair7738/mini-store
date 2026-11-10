"use client";

import { useEffect, useState } from "react";

export function notify(message, type = "success") {
  window.dispatchEvent(
    new CustomEvent("store-toast", { detail: { message, type } }),
  );
}

export function focusField(form, name) {
  const field =
    (name && form.elements.namedItem(name)) ||
    form.querySelector(":invalid") ||
    form.querySelector("input, textarea, select");
  if (!field?.focus) return;
  form.classList.add("was-validated");
  field.closest("details")?.setAttribute("open", "");
  field.scrollIntoView({ behavior: "smooth", block: "center" });
  field.focus({ preventScroll: true });
}

export function invalidForm(event) {
  const form = event.currentTarget;
  const first = form.querySelector(":invalid");
  if (event.target !== first) return;
  notify(first.validationMessage || "Please check this field", "error");
  requestAnimationFrame(() => focusField(form));
}

export default function Toast() {
  const [items, setItems] = useState([]);
  useEffect(() => {
    function add(event) {
      const id = crypto.randomUUID();
      setItems((current) => [...current.slice(-2), { id, ...event.detail }]);
      setTimeout(
        () => setItems((current) => current.filter((item) => item.id !== id)),
        5000,
      );
    }
    window.addEventListener("store-toast", add);
    return () => window.removeEventListener("store-toast", add);
  }, []);
  return (
    <div className="toast-stack">
      {items.map((item) => (
        <div
          className={`toast ${item.type}`}
          role={item.type === "error" ? "alert" : "status"}
          key={item.id}
        >
          <span>{item.message}</span>
          <button
            type="button"
            aria-label="Dismiss notification"
            onClick={() =>
              setItems((current) =>
                current.filter((entry) => entry.id !== item.id),
              )
            }
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
