"use client";

import Link from "next/link";
import { usePending } from "../../usePending";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

export default function AccountPage() {
  const router = useRouter();
  const [busy, run] = usePending();
  const [customer, setCustomer] = useState(null);
  const [csrf, setCsrf] = useState("");
  const [addresses, setAddresses] = useState([]);
  const [profile, setProfile] = useState({ name: "", phone: "" });
  const [address, setAddress] = useState({ label: "Home", name: "", phone: "", address: "" });
  const [editingAddress, setEditingAddress] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  async function load() {
    const response = await fetch("/api/customer/session", { cache: "no-store" });
    const data = await response.json();
    if (!data.customer) { setCustomer(null); setLoading(false); return; }
    setCustomer(data.customer); setCsrf(data.csrfToken);
    setProfile({ name: data.customer.name, phone: data.customer.phone || "" });
    const result = await fetch("/api/customer/addresses", { cache: "no-store" });
    if (result.ok) setAddresses((await result.json()).addresses);
    setLoading(false);
  }
  useEffect(() => { load().catch(() => { setError("Account could not be loaded."); setLoading(false); }); }, []);
  async function saveProfile(event) {
    event.preventDefault(); setError("");
    const response = await fetch("/api/customer/profile", { method: "PUT", headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf }, body: JSON.stringify(profile) });
    const data = await response.json();
    if (!response.ok) { setError(data.message); return; }
    setCustomer(data.customer); setNotice("Profile saved.");
  }
  async function saveAddress(event) {
    event.preventDefault(); setError("");
    const response = await fetch(editingAddress ? `/api/customer/addresses/${editingAddress}` : "/api/customer/addresses", { method: editingAddress ? "PUT" : "POST", headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf }, body: JSON.stringify(address) });
    const data = await response.json();
    if (!response.ok) { setError(data.message); return; }
    setAddress({ label: "Home", name: customer.name, phone: customer.phone || "", address: "" }); setEditingAddress(null); setNotice("Address saved."); await load();
  }
  async function deleteAddress(addressId) {
    const response = await fetch(`/api/customer/addresses/${addressId}`, { method: "DELETE", headers: { "X-CSRF-Token": csrf } });
    if (!response.ok) { setError("Address could not be deleted."); return; }
    setAddresses((current) => current.filter((item) => item.id !== addressId));
  }
  async function logout() {
    await fetch("/api/customer/logout", { method: "POST", headers: { "X-CSRF-Token": csrf } });
    router.refresh(); setCustomer(null);
  }
  if (loading) return <section className="section narrow"><p role="status">Loading account…</p></section>;
  if (!customer) return <section className="section narrow"><p className="eyebrow">DANUBE MILANO</p><div className="account-card"><h1>Your account</h1><p>Sign in to view your profile and saved addresses. You can always checkout as a guest.</p><p><Link className="button" href="/account/login">Sign in</Link> <Link className="button secondary" href="/account/register">Create account</Link></p><Link href="/orders">View guest orders on this device →</Link></div></section>;
  return <section className="section account-page"><p className="eyebrow">YOUR ACCOUNT</p><header className="account-heading"><div><h1>Account</h1><p>{customer.email}</p></div><button className="button secondary" disabled={busy} onClick={() => run(logout)}>Sign out</button></header>
    {error && <p className="notice error" role="alert">{error}</p>}{notice && <p className="notice" role="status">{notice}</p>}
    <div className="account-grid"><form className="account-card" onSubmit={(event) => { event.preventDefault(); run(() => saveProfile(event)); }}><h2>Profile</h2><label>Name<input required maxLength="120" value={profile.name} onChange={(e) => setProfile({ ...profile, name: e.target.value })} /></label><label>Phone<input maxLength="30" value={profile.phone} onChange={(e) => setProfile({ ...profile, phone: e.target.value })} /></label><button className="button" disabled={busy}>Save profile</button><p><Link href="/orders">View My Orders →</Link></p></form>
    <section className="account-card"><h2>Saved addresses</h2>{addresses.map((item) => <article className="saved-address" key={item.id}><div><strong>{item.label} · {item.name}</strong><p>{item.phone}<br />{item.address}</p></div><div><button type="button" className="text-button" onClick={() => { setEditingAddress(item.id); setAddress({ label: item.label, name: item.name, phone: item.phone, address: item.address }); }}>Edit</button> <button type="button" className="text-button" disabled={busy} onClick={() => run(() => deleteAddress(item.id))}>Delete</button></div></article>)}{!addresses.length && <p>No saved addresses yet.</p>}<form onSubmit={(event) => { event.preventDefault(); run(() => saveAddress(event)); }}><h3>{editingAddress ? "Edit address" : "Add address"}</h3><label>Label<input required maxLength="60" value={address.label} onChange={(e) => setAddress({ ...address, label: e.target.value })} /></label><label>Recipient name<input required maxLength="120" value={address.name} onChange={(e) => setAddress({ ...address, name: e.target.value })} /></label><label>Phone<input required type="tel" maxLength="30" value={address.phone} onChange={(e) => setAddress({ ...address, phone: e.target.value })} /></label><label>Delivery address<textarea required minLength="10" maxLength="500" value={address.address} onChange={(e) => setAddress({ ...address, address: e.target.value })} /></label><button className="button" disabled={busy}>{editingAddress ? "Update address" : "Save address"}</button>{editingAddress && <button className="button secondary" type="button" onClick={() => { setEditingAddress(null); setAddress({ label: "Home", name: "", phone: "", address: "" }); }}>Cancel edit</button>}</form></section></div>
  </section>;
}
