import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Larabee Inbox",
  description: "Shared line for Larabee Homes",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, title: "Larabee", statusBarStyle: "default" },
  // Without an explicit apple-touch-icon, iOS puts a SCREENSHOT of the page on
  // the home screen instead of an icon. The manifest alone does not cover it.
  icons: {
    icon: [
      { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
};

// Mobile-first: this is used standing in a driveway, not at a desk.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // Deliberately NOT maximumScale:1. Blocking pinch-zoom stops anyone who needs
  // to enlarge text from using the app at all, and it was only there to prevent
  // iOS zooming when a small input is focused -- which is fixed properly below
  // in the stylesheet by making touch inputs 16px.
  themeColor: "#186A4E",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
