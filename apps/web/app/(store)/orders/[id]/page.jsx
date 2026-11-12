import OrderConfirmation from "../../components/OrderConfirmation";

export default async function OrderPage({ params }) {
  const { id } = await params;
  return <OrderConfirmation orderId={id} />;
}
