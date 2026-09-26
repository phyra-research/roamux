import { NotifyWatcher } from "@/components/notify-watcher"
import { PwaRegistrar } from "@/components/pwa-registrar"
import { ReconnectingBanner } from "@/components/reconnecting-banner"
import { RelayProvider } from "@/lib/relay-provider"
import type { Metadata, Viewport } from "next"
import { Inter } from "next/font/google"
import "./globals.css"

// Self-hosted at build time (no external CDN request at runtime — CSP/
// offline-safe). Applied via CSS variable on <html>; globals.css sets it as
// the real font-family directly, not through a Tailwind font-sans utility.
const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" })

export const metadata: Metadata = {
  title: "roamux",
  description: "Remote control plane for local AI coding agents",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, title: "roamux", statusBarStyle: "default" },
  // Next emits <link rel="apple-touch-icon"> from this (iOS ignores manifest icons).
  icons: { apple: "/icons/icon-192.png" },
}

export const viewport: Viewport = {
  themeColor: "#FAF1CA",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  viewportFit: "cover",
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={inter.variable}>
      <body>
        <PwaRegistrar />
        <RelayProvider>
          {/* Renders nothing — observes relay state globally so a background
              badge/sound/notification fires regardless of which page is open,
              not just the specific session that changed (#113). */}
          <NotifyWatcher />
          <div className="mx-auto flex min-h-[100dvh] max-w-2xl flex-col">
            <ReconnectingBanner />
            {children}
          </div>
        </RelayProvider>
      </body>
    </html>
  )
}
