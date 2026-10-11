import path from "node:path";
import type { NextConfig } from "next";

// Cabeçalhos de segurança fixos. A Content-Security-Policy (com nonce por
// requisição) é definida em src/proxy.ts; o HSTS vem do Nginx (HTTPS).
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "same-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  { key: "Cross-Origin-Resource-Policy", value: "same-origin" },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  turbopack: {
    root: path.join(__dirname, ".."),
  },
  // Drivers nativos do Node ficam fora do bundle do servidor.
  serverExternalPackages: ["pg", "nodemailer", "bcryptjs", "qrcode"],
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
