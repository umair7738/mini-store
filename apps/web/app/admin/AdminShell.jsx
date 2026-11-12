"use client";

import { apiFetch } from "../../lib/apiFetch";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { usePending } from "../usePending";
import { notify } from "../Toast";

const AdminContext = createContext(null);

export function useAdmin() {
  return useContext(AdminContext);
}

const links = [
  ["/admin", "Dashboard"],
  ["/admin/products", "Products"],
  ["/admin/orders", "Orders"],
];

export default function AdminShell({ children }) {
  const [busy, run] = usePending();
  const pathname = usePathname();
  const router = useRouter();
  const isLogin = pathname === "/admin/login";
  const [session, setSession] = useState(null);
  const [problem, setProblem] = useState("");
  const [retry, setRetry] = useState(0);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    if (isLogin) return;
    let cancelled = false;
    apiFetch("/api/admin/session", { cache: "no-store" })
      .then((response) => {
        if (response.status === 401) {
          router.replace("/admin/login");
          return null;
        }
        if (!response.ok) throw new Error("Admin session is unavailable");
        return response.json();
      })
      .then((data) => {
        if (!cancelled && data) {
          setSession(data);
          setProblem("");
        }
      })
      .catch((error) => {
        if (!cancelled) setProblem(error.message);
      });
    return () => {
      cancelled = true;
    };
  }, [isLogin, retry, router]);

  const request = useCallback(
    async (path, options = {}) => {
      const response = await apiFetch(path, {
        ...options,
        cache: "no-store",
        headers: {
          ...(options.body && !(options.body instanceof FormData) && { "Content-Type": "application/json" }),
          ...(options.method && { "X-CSRF-Token": session.csrfToken }),
          ...options.headers,
        },
      });
      if (response.status === 401) router.replace("/admin/login");
      if (!response.ok) {
        const data = await response.json();
        const error = new Error(data.message || "Request failed");
        error.field = data.field;
        throw error;
      }
      return response.status === 204 ? null : response.json();
    },
    [router, session],
  );

  async function logout() {
    try {
      await request("/api/admin/logout", { method: "POST" });
      setSession(null);
      router.replace("/admin/login");
    } catch (error) {
      notify(error.message, "error");
    }
  }

  if (isLogin) return <main className="admin-auth">{children}</main>;

  if (!session) {
    return (
      <main className="admin-auth">
        <div className="admin-auth-card" role="status">
          <p className="eyebrow">DANUBE MILANO ADMIN</p>
          <h1>{problem ? "Connection problem" : "Opening workspace"}</h1>
          <p>{problem || "Checking your admin session…"}</p>
          {problem && (
            <button className="button small" onClick={() => setRetry(retry + 1)}>
              Try again
            </button>
          )}
        </div>
      </main>
    );
  }

  return (
    <AdminContext.Provider value={{ ...session, request }}>
      <div className="admin-shell">
        <a className="skip-link" href="#admin-main">Skip to content</a>
        <button className="admin-mobile-toggle" type="button" aria-expanded={menuOpen} aria-controls="admin-navigation" onClick={() => setMenuOpen(!menuOpen)}>Menu</button>
        <aside className={`admin-sidebar ${menuOpen ? "open" : ""}`} id="admin-navigation">
          <Link href="/admin" className="admin-brand">
            <span>DANUBE <em>MILANO</em></span>
            <small>STORE ADMIN</small>
          </Link>
          <p className="admin-nav-label">Workspace</p>
          <nav className="admin-nav" aria-label="Admin navigation">
            {links.map(([href, label]) => (
                <Link
                href={href}
                key={href}
                className={pathname === href ? "active" : ""}
                aria-current={pathname === href ? "page" : undefined}
                  onClick={() => setMenuOpen(false)}
                >
                {label}
              </Link>
            ))}
          </nav>
          <div className="admin-sidebar-bottom">
            <Link href="/">View storefront ↗</Link>
            <button type="button" disabled={busy} onClick={() => run(logout)}>Sign out</button>
          </div>
        </aside>
        <div className="admin-workspace">
          <header className="admin-topbar">
            <span>Danube Milano / Operations</span>
            <span className="admin-account" title={session.email}>{session.email}</span>
          </header>
          <main id="admin-main" className="admin-content">{children}</main>
        </div>
      </div>
    </AdminContext.Provider>
  );
}
