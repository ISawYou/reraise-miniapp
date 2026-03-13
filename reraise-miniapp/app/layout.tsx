import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "ReRaise Poker Club",
  description: "Telegram Mini App for poker club management",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ru">
      <body>{children}</body>
    </html>
  );
}
