import type { Metadata, Viewport } from "next";
import { Baloo_2, Nunito } from "next/font/google";
import "./globals.css";
import { Providers } from "@/components/Providers";

const baloo = Baloo_2({
  subsets: ["latin"],
  weight: ["500", "600", "700", "800"],
  variable: "--font-baloo",
  display: "swap",
});

const nunito = Nunito({
  subsets: ["latin"],
  weight: ["400", "600", "700", "800"],
  variable: "--font-nunito",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Tiruno — Learn with Tiru",
  description: "A playful, mascot-led learning app. Streaks, hearts, and Tiru the bear.",
  icons: {
    icon: [{ url: "/mascot/poses/happy.png", type: "image/png" }],
    apple: "/mascot/poses/happy.png",
  },
};

export const viewport: Viewport = {
  themeColor: "#FF7A1A",
};

const noFlashTheme = `(function(){try{var s=localStorage.getItem('tiruno-game-v3');if(s){var t=JSON.parse(s).state.theme;if(t==='dark')document.documentElement.classList.add('dark');}}catch(e){}})();`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: noFlashTheme }} />
      </head>
      <body className={`${baloo.variable} ${nunito.variable} font-body antialiased`}>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
