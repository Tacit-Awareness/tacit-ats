import type { Metadata } from "next";
import { Geist_Mono } from "next/font/google";
import "./globals.css";

export const metadata: Metadata = {
  title: "Tacit",
  description: "Your company's hiring workspace in Tacit",
};

// Tacit Testbench's type: Neco and Recoleta are self-hosted from public/fonts
// (globals.css), Geist Mono for keys and timestamps comes from next/font.
const geistMono = Geist_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-geist-mono",
});

// Bare shell. The client area's header lives in client/layout.tsx.
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`h-full ${geistMono.variable}`}>
      <head>
        <link rel="preload" href="/fonts/Recoleta-Regular.woff2" as="font" type="font/woff2" crossOrigin="" />
        <link rel="preload" href="/fonts/Neco-Medium.woff2" as="font" type="font/woff2" crossOrigin="" />
      </head>
      <body className="flex min-h-full flex-col text-foreground">{children}</body>
    </html>
  );
}
