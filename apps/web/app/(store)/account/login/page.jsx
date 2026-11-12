import CustomerAuthForm from "../../components/CustomerAuthForm";

export default async function LoginPage({ searchParams }) {
  const params = await searchParams;
  return <CustomerAuthForm next={params.next || "/account"} />;
}
