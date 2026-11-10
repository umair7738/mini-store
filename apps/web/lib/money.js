export const money = (fils) =>
  new Intl.NumberFormat("en-AE", { style: "currency", currency: "AED" }).format(
    fils / 100,
  );
