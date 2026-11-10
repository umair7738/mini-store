import "./globals.css";
import Toast from "./Toast";

export const metadata = {
  metadataBase: new URL(
    process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000",
  ),
  title: {
    default: "Danube Milano | Bathroom essentials",
    template: "%s | Danube Milano",
  },
  description: "Thoughtfully selected sanitary products for modern bathrooms.",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" data-scroll-behavior="smooth">
      <body>
        {children}
        <Toast />
      </body>
    </html>
  );
}
