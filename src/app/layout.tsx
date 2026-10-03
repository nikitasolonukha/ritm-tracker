import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import { PwaRegistration } from "./pwa";
import { TrackerProvider } from "@/components/tracker-state";
import "./globals.css";

const inter = Inter({ subsets: ["latin", "cyrillic"], variable: "--font-sans", display: "swap" });

export const metadata: Metadata = {
  title: "Ритм",
  description: "Личный трекер привычек, тренировок и наблюдений.",
  manifest: "/manifest.webmanifest",
};

export const viewport: Viewport = {
  themeColor: "#0a0b0f",
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
