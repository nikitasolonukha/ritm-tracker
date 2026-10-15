import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import { PwaRegistration } from "./pwa";
import { TrackerProvider } from "@/components/tracker-state";
import "./globals.css";
import "../styles/ds.css";

const inter = Inter({ subsets: ["latin", "cyrillic"], variable: "--font-sans", display: "swap" });

export const metadata: Metadata = {
  title: "Ритм",
  description: "Личный трекер привычек, тренировок и наблюдений.",
  manifest: "/manifest.webmanifest",
  icons: { icon: [{ url: "/icon.svg", type: "image/svg+xml" }, { url: "/icon-192.png", sizes: "192x192", type: "image/png" }], apple: [{ url: "/apple-touch-icon.png", sizes: "180x180" }] },
  appleWebApp: { capable: true, title: "Ритм", statusBarStyle: "black-translucent" },
};

export const viewport: Viewport = {
  themeColor: "#060709",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ru">
      <body className={inter.variable}>
        <PwaRegistration />
        <TrackerProvider demoMode={process.env.RITM_DEMO_MODE === "1" && process.env.VERCEL !== "1"}>{children}</TrackerProvider>
      </body>
    </html>
  );
}
