import type { Metadata, Viewport } from "next";
import { Onest } from "next/font/google";
import Script from "next/script";
import "./globals.css";
import { TelegramAppShell } from "@/components/telegram-app-shell";

const onest = Onest({
  subsets: ["latin", "cyrillic"],
  variable: "--font-ui",
  display: "swap",
});

export const metadata: Metadata = {
  title: "ReRaise Poker Club",
  description: "Telegram Mini App for ReRaise Poker Club",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
  themeColor: "#000000",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ru">
      <body
        className={`${onest.variable} telegram-app-body min-h-screen bg-black text-white antialiased`}
      >
        <Script
          src="https://telegram.org/js/telegram-web-app.js"
          strategy="beforeInteractive"
        />
        <TelegramAppShell />
        {children}
      </body>
    </html>
  );
}
