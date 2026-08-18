import type { Metadata, Viewport } from "next";
import { Assistant } from "next/font/google";
import "./globals.css";
import { BRAND_COLOR } from "@/lib/brand";
import { he } from "@/lib/he";

/** פונט עברי יחיד לכל המערכת. `display: swap` כדי שטקסט יופיע מיד גם ברשת סלולרית איטית. */
const assistant = Assistant({
  variable: "--font-assistant",
  subsets: ["hebrew", "latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: he.app.title,
  description: he.app.description,
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // מותר להגדיל — נדרש לקריאת תמונות ליקוי בשטח
  maximumScale: 5,
  themeColor: BRAND_COLOR,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="he"
      dir="rtl"
      className={`${assistant.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col">{children}</body>
    </html>
  );
}
