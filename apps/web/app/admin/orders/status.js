export const statusLabel = { placed: "New order", processing: "Preparing", shipped: "Dispatched", delivered: "Delivered", completed: "Completed (legacy)", cancelled: "Cancelled" };
export const paymentLabel = { unknown: "Not recorded", unpaid: "Unpaid", paid: "Paid" };
export const nextStatuses = {
  placed: ["processing", "shipped", "delivered", "cancelled"],
  processing: ["shipped", "delivered", "cancelled"],
  shipped: ["delivered"],
};
