import { RelayProvider } from "@/lib/relay-provider"
import type { Metadata, Viewport } from "next"
import "./globals.css"

export const metadata: Metadata = {
  title: "OpenRemote",
  description: "Remote control plane for local AI coding agents",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, title: "OpenRemote", statusBarStyle: "black-translucent" },
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
        <RelayProvider>
          <div className="mx-auto flex min-h-[100dvh] max-w-2xl flex-col">{children}</div>
        </RelayProvider>
      </body>
    </html>
  )
}
