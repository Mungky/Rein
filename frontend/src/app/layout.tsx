import type { Metadata } from "next";
import { DM_Sans, JetBrains_Mono } from "next/font/google";
import { ThemeProvider } from "@/components/providers/theme-provider";
import { SupabaseProvider } from "@/components/providers/supabase-provider";
import { PermissionsProvider } from "@/components/providers/permissions-provider";
import "./globals.css";

const dmSans = DM_Sans({
  variable: "--font-dm-sans",
  subsets: ["latin"],
  display: "swap",
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains-mono",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "REIN — Remula Inti Rekayasa",
  description: "Sistem ERP/CRM internal untuk Remula Inti Rekayasa",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="id"
      data-theme="light"
      suppressHydrationWarning
      className={`${dmSans.variable} ${jetbrainsMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <ThemeProvider>
          <SupabaseProvider>
            <PermissionsProvider>{children}</PermissionsProvider>
          </SupabaseProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}