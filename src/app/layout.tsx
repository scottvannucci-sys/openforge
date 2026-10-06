import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "OpenForge — Prompt to Print",
  description:
    "Turn text or images into 3D-printable models with OpenSCAD and local or subscription LLMs. Made for the Bambu Lab P1S.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body className="min-h-screen text-zinc-200 antialiased">{children}</body>
    </html>
  );
}
