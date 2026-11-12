import ProductForm from "../ProductForm";

export const metadata = { title: "New product", robots: { index: false, follow: false } };

export default function NewProductPage() {
  return <ProductForm />;
}
