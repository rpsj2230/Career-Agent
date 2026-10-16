import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Nav } from "@/components/app/nav";
import { Toaster } from "@/components/ui/sonner";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Career Agent",
  description: "Personal job discovery, resume tailoring and application tracker",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="min-h-full bg-background">
        <div className="mx-auto flex min-h-screen max-w-7xl flex-col gap-4 p-4 md:flex-row md:gap-8 md:p-6">
          <aside className="md:w-52 md:shrink-0">
            <div className="mb-3 px-3 text-lg font-semibold">Career Agent</div>
            <Nav />
          </aside>
          <main className="min-w-0 flex-1">{children}</main>
        </div>
        <Toaster richColors />
      </body>
    </html>
  );
}
