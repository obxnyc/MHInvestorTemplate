import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Larabee Inbox",
  description: "Shared line for Larabee Homes",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, title: "Larabee", statusBarStyle: "default" },
};

// Mobile-first: this is used standing in a driveway, not at a desk.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  themeColor: "#186A4E",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
