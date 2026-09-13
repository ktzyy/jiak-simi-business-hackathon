import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";

const leagueSpartan = localFont({
  src: [
    { path: "../../public/fonts/league-spartan-regular.ttf", weight: "400", style: "normal" },
    { path: "../../public/fonts/league-spartan-bold.ttf", weight: "700", style: "normal" },
    { path: "../../public/fonts/league-spartan-black.ttf", weight: "900", style: "normal" },
  ],
  variable: "--font-league-spartan",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Jiak Simi for Business",
  description: "Start with a photo of your menu. Let customers order on their phones, and see clearly what to cook next.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${leagueSpartan.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
