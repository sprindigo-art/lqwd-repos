import type { Metadata } from "next";
import { IBM_Plex_Mono, IBM_Plex_Sans, Inter, Saira_Semi_Condensed } from "next/font/google";
import "./globals.css";

// Sketch-validated fonts (NOC Light, operator decision 2026-06-11):
// Saira Semi Condensed = display headers, IBM Plex Mono = data/labels,
// Inter = body. next/font self-hosts at build time — zero runtime requests.
const saira = Saira_Semi_Condensed({
  weight: ["600", "700"],
  variable: "--font-saira",
  subsets: ["latin"],
});

const plexMono = IBM_Plex_Mono({
  weight: ["400", "600"],
  variable: "--font-plex-mono",
  subsets: ["latin"],
});

// Data-Forward v2 body/UI sans (Phase 10, DS-01) — wired ADDITIVELY alongside the
// v1 fonts (Pitfall 4: removing Saira/Inter/Plex Mono breaks v1 screens). The
// --font-df-sans token in globals.css points at this --font-plex-sans variable.
const plexSans = IBM_Plex_Sans({
  weight: ["400", "500", "600", "700"],
  variable: "--font-plex-sans",
  subsets: ["latin"],
});

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: {
    default: "NodeMonitor — LQWD Fleet Control",
    template: "%s | NodeMonitor",
  },
  description:
    "Local-first node-operator control tool for the LQWD Lightning fleet. Curated analytics + safe, accountable actions.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // Light NOC is the only mode (operator decision 2026-06-11 supersedes the
  // Phase 2 dark default) — no dark class, no dark variant.
  return (
    <html
      lang="en"
      className={`${saira.variable} ${plexMono.variable} ${inter.variable} ${plexSans.variable}`}
    >
      <body className="antialiased">{children}</body>
    </html>
  );
}
