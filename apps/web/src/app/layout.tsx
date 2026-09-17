import { PwaRegistrar } from "@/components/pwa-registrar"
import { ReconnectingBanner } from "@/components/reconnecting-banner"
import { RelayProvider } from "@/lib/relay-provider"
import type { Metadata, Viewport } from "next"
import "./globals.css"

export const metadata: Metadata = {
  title: "roamux",
  description: "Remote control plane for local AI coding agents",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, title: "roamux", statusBarStyle: "black-translucent" },
  // Next emits <link rel="apple-touch-icon"> from this (iOS ignores manifest icons).
  icons: { apple: "/icons/icon-192.png" },
}

export const viewport: Viewport = {
  themeColor: "#0a0a0b",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  viewportFit: "cover",
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <PwaRegistrar />
        <RelayProvider>
          <div className="mx-auto flex min-h-[100dvh] max-w-2xl flex-col">
            <ReconnectingBanner />
            {children}
          </div>
        </RelayProvider>
      </body>
    </html>
  )
}
