import type { Metadata } from "next";
import { headers } from "next/headers";
import { Plus_Jakarta_Sans, Manrope } from "next/font/google";
import "./globals.css";

const jakarta = Plus_Jakarta_Sans({
  variable: "--font-jakarta",
  subsets: ["latin"],
  weight: ["600", "700", "800"],
});

const manrope = Manrope({
  variable: "--font-manrope",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Be Fluent | Gestão Financeira",
  description: "Plataforma de gestão financeira e administrativa da Be Fluent.",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // A CSP usa um nonce novo por requisição (src/proxy.ts), então nenhuma
  // página pode ser pré-renderizada estática: ler os headers força a
  // renderização dinâmica em todo o app.
  await headers();

  return (
    <html
      lang="pt-BR"
      className={`${jakarta.variable} ${manrope.variable} h-full antialiased dark`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
