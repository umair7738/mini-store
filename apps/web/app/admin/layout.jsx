import AdminShell from "./AdminShell";

export const metadata = {
  title: "Store admin",
  robots: { index: false, follow: false },
};
export default function Layout({ children }) {
  return <AdminShell>{children}</AdminShell>;
}
