import type { Metadata, Viewport } from "next";
import { PwaRegistration } from "./pwa";
import { TrackerProvider } from "@/components/tracker-state";
import "./globals.css";

export const metadata: Metadata = {
  title: "Ритм",
  description: "Личный трекер привычек, тренировок и наблюдений.",
  manifest: "/manifest.webmanifest",
};

export const viewport: Viewport = {
  themeColor: "#111312",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ru">
      <body>
        <PwaRegistration />
        <TrackerProvider demoMode={process.env.RITM_DEMO_MODE === "1" && process.env.VERCEL !== "1"}>{children}</TrackerProvider>
      </body>
    </html>
  );
}
