import type { Metadata } from "next";
import { Oswald, Noto_Sans_Devanagari } from "next/font/google";
import "./globals.css";

const headingFont = Oswald({
  variable: "--font-heading",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

const bodyFont = Noto_Sans_Devanagari({
  variable: "--font-body",
  subsets: ["devanagari", "latin"],
  weight: ["400", "500", "600", "700"],
});

export const metadata: Metadata = {
  title: "Kavach AR Safety Training",
  description: "Offline AR safety training and certification app for industrial workers.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${headingFont.variable} ${bodyFont.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col bg-[#0b1220] text-slate-100">{children}</body>
    </html>
  );
}
