import StoreFooter from "./components/StoreFooter";
import StoreHeader from "./components/StoreHeader";

export default function StoreLayout({ children }) {
  return (
    <>
      <StoreHeader />
      <main>{children}</main>
      <StoreFooter />
    </>
  );
}
