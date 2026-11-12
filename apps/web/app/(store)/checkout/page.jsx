import CheckoutForm from "./CheckoutForm";

export default async function CheckoutPage({ searchParams }) {
  const params = await searchParams;
  return <CheckoutForm buyNow={params.buyNow || ""} buyNowQuantity={params.quantity || "1"} attempt={params.attempt || ""} />;
}
