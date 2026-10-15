import type { Metadata } from "next";
import { IBM_Plex_Mono, Instrument_Sans } from "next/font/google";
import "./globals.css";

export const metadata: Metadata = {
  title: "Tacit",
  description: "Your company's hiring workspace in Tacit",
};

// The same type pair as Tacit's internal workspace: Instrument Sans for
// everything, IBM Plex Mono for keys/timestamps, self-hosted by next/font.
const instrumentSans = Instrument_Sans({
  subsets: ["latin"],
  variable: "--font-instrument-sans",
});
const plexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-plex-mono",
});

// Bare shell. The client area's header lives in client/layout.tsx.
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`h-full ${instrumentSans.variable} ${plexMono.variable}`}>
      <body className="flex min-h-full flex-col bg-background text-foreground">{children}</body>
    </html>
  );
}
