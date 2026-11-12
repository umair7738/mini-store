"use client";
import { createContext, useContext, useEffect, useState, useSyncExternalStore } from "react";
import { createCartStore } from "../../../lib/cartStore";
import { apiFetch } from "../../../lib/apiFetch";

const CartContext = createContext(null);
export default function CartProvider({ children }) {
  const [store] = useState(() => createCartStore(apiFetch));
  useEffect(() => { store.load(); }, [store]);
  return <CartContext.Provider value={store}>{children}</CartContext.Provider>;
}
export function useCart() {
  const store = useContext(CartContext);
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  return { ...state, store };
}
