import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Meme'd",
  description: "Meme'd — a creator marketplace where brands run campaigns and creators get paid per milestone.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en">
      <body>
        <div className="container">{children}</div>
      </body>
    </html>
  );
}
