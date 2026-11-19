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

// Tacit Testbench's two voices, so the ATS and Testbench read as one product:
// Mona Sans names things (titles, the nav, headings) and Geist Mono is
// everything you act on or read as data, which is most of the page. Mona Sans
// (OFL, fonts/MonaSans-LICENSE.txt) is the variable file Testbench ships.
// Both self-hosted at build time: no runtime font request.
const mona = localFont({
  src: "./fonts/MonaSans.woff2",
  variable: "--font-mona",
  weight: "200 900",
  display: "swap",
});
const geistMono = Geist_Mono({ subsets: ["latin"], variable: "--font-geist-mono" });
// Inter: the client area's face under Tacit Tickets' skin (globals.css points the
// signed-in shell's fonts at it).
const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });

// Bare shell. The client area's sidebar lives in client/layout.tsx, so the
// public job posts are full-viewport pages without it. The theme is a
// cookie, read here so the first paint is already right; with no cookie the
// CSS follows the system setting.
export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const theme = parseTheme((await cookies()).get(THEME_COOKIE)?.value);
  return (
    <html
      lang="en"
      suppressHydrationWarning
      data-theme={theme ?? undefined}
      className={`h-full ${mona.variable} ${geistMono.variable} ${inter.variable}`}
      // Real code (a client ID, scopes, a token) keeps Geist Mono by its own name: the
      // client area's skin points --font-geist-mono at Inter (globals.css, Tacit Tickets).
      style={{ "--font-code": geistMono.style.fontFamily } as React.CSSProperties}
    >
      <body className="flex min-h-full flex-col bg-frame text-foreground">{children}</body>
    </html>
  );
}
