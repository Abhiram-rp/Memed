import type { Metadata } from "next";
import { Space_Grotesk, Plus_Jakarta_Sans } from "next/font/google";
import { AuthProvider } from "@/context/AuthContext";
import "./globals.css";

/**
 * Typography: Space Grotesk is the bold display face for headings and big
 * numbers; Plus Jakarta Sans is the clean body face. Both come from
 * next/font/google (bundled with Next.js — no extra dependency) and are
 * exposed as CSS variables consumed by globals.css.
 */
const display = Space_Grotesk({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-display",
});

const sans = Plus_Jakarta_Sans({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-sans",
});

export const metadata: Metadata = {
  title: "Creator Marketplace for Brand Campaigns | Meme'd",
  description:
    "Meme'd — a creator marketplace where brands run campaigns and creators get paid per milestone.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${display.variable} ${sans.variable}`}>
      {/* suppressHydrationWarning: browser extensions (e.g. ColorZilla's
          cz-shortcut-listen) inject attributes onto <body> before React
          hydrates, which would otherwise log a hydration mismatch. */}
      <body suppressHydrationWarning>
        <a className="skip-link" href="#main-content">
          Skip to content
        </a>
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
