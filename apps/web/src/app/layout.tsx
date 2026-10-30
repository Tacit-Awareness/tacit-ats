import type { Metadata } from "next";
import { Geist_Mono, Inter } from "next/font/google";
import localFont from "next/font/local";
import { cookies } from "next/headers";
import { THEME_COOKIE, parseTheme } from "@/lib/theme";
import "./globals.css";

export const metadata: Metadata = {
  title: "Tacit",
  description: "Your company's hiring workspace in Tacit",
};

// design/tats's type: Inter for everything; Geist Mono (kept from
// tacit-internal's) for ids and timestamps, Departure Mono (a pixel face, OFL --
// fonts/DepartureMono-LICENSE.txt) only for the big numbers. All self-hosted at
// build time: no runtime font request.
const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });
const geistMono = Geist_Mono({ subsets: ["latin"], variable: "--font-geist-mono" });
const departure = localFont({
  src: "./fonts/DepartureMono-Regular.woff2",
  variable: "--font-departure",
  display: "swap",
});

// Bare shell. The client area's sidebar lives in client/layout.tsx, so the
// public job posts are full-viewport pages without it. The theme is a
// cookie, read here so the first paint is already right; with no cookie the
// CSS follows the system setting.
export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const theme = parseTheme((await cookies()).get(THEME_COOKIE)?.value);
  return (
    <html
      lang="en"
      data-theme={theme ?? undefined}
      className={`h-full ${inter.variable} ${geistMono.variable} ${departure.variable}`}
    >
      <body className="flex min-h-full flex-col bg-frame text-foreground">{children}</body>
    </html>
  );
}
