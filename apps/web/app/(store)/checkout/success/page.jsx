import OrderConfirmation from "../../components/OrderConfirmation";

export const metadata = { title: "Order confirmation", robots: { index: false, follow: false } };

export default async function SuccessPage({ searchParams }) {
  const params = await searchParams;
  return <OrderConfirmation orderId={params.order || ""} />;
}
