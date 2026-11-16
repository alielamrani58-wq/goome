import type { Metadata } from "next";
import "./globals.css";
import { getPortal } from "@/lib/goome-server";
import { PORTALS } from "@/lib/goome-portals";

export function generateMetadata(): Metadata {
 const portal = PORTALS[getPortal()];
 return {
  title: portal.title,
  description: portal.description,
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="fr">
      <body className="antialiased">{children}</body>
    </html>
  );
}
