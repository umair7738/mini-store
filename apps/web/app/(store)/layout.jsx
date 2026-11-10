import Link from "next/link";

export default function StoreLayout({ children }) {
  return (
    <>
      <header className="site-header">
        <Link href="/" className="brand">
          DANUBE <span>MILANO</span>
        </Link>
        <nav aria-label="Main navigation">
          <Link href="/">Shop</Link>
          <Link href="/cart">Cart</Link>
          <Link href="/admin">Admin</Link>
        </nav>
      </header>
      <main>{children}</main>
      <footer className="site-footer">
        <span>DANUBE MILANO</span>
        <span>Bathroom essentials · AED</span>
      </footer>
    </>
  );
}
