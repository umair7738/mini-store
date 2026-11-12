import StoreFooter from "./components/StoreFooter";
import StoreHeader from "./components/StoreHeader";
import CartProvider from "./components/CartProvider";

export default function StoreLayout({ children }) {
  return (
    <CartProvider>
      <StoreHeader />
      <main>{children}</main>
      <StoreFooter />
    </CartProvider>
  );
}
