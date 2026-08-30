import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "VAZOU.AI",
  description: "Descubra quanto dinheiro sua empresa está deixando escapar — e recupere.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="pt-BR">
      <body className="bg-bg text-text antialiased">{children}</body>
    </html>
  );
}
