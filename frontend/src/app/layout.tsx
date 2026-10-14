import type { Metadata } from "next";
import { AuthProvider } from "@/context/AuthContext";
import "./globals.css";

export const metadata: Metadata = {
  title: "Meme'd",
  description: "Meme'd — a creator marketplace where brands run campaigns and creators get paid per milestone.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en">
      <body>
        <AuthProvider>
          <div className="container">{children}</div>
        </AuthProvider>
      </body>
    </html>
  );
}
