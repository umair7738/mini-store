import CustomerAuthForm from "../../components/CustomerAuthForm";

export default async function RegisterPage({ searchParams }) {
  const params = await searchParams;
  return <CustomerAuthForm register next={params.next || "/account"} />;
}
