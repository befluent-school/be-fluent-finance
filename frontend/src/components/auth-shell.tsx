/** Moldura das telas públicas de autenticação (login, recuperação de senha, 2FA). */
export function AuthShell({
  title,
  subtitle,
  wide,
  children,
}: {
  title: string;
  subtitle: string;
  wide?: boolean;
  children: React.ReactNode;
}) {
  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-ink-950 px-4">
      <HexPattern />
      <div className="pointer-events-none absolute left-1/2 top-1/2 h-[600px] w-[600px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-amber-500/[0.07] blur-[120px]" />

      <div
        className={`card-premium animate-rise relative w-full ${wide ? "max-w-md" : "max-w-sm"} rounded-lg p-8 shadow-[var(--shadow-elevated)]`}
      >
        <div className="mb-1 h-1 w-10 rounded-full bg-gradient-to-r from-amber-600 to-amber-400" />
        <h1 className="font-display gradient-text text-3xl font-bold">{title}</h1>
        <p className="mt-1 text-sm text-ink-300">{subtitle}</p>
        {children}
      </div>
    </main>
  );
}

function HexPattern() {
  return (
    <svg
      className="pointer-events-none absolute inset-0 h-full w-full opacity-[0.06]"
      aria-hidden="true"
    >
      <defs>
        <pattern id="hex" width="56" height="98" patternUnits="userSpaceOnUse" patternTransform="scale(1)">
          <path
            d="M28 0 L56 16 L56 49 L28 65 L0 49 L0 16 Z"
            fill="none"
            stroke="#f0a520"
            strokeWidth="1.5"
          />
          <path
            d="M28 65 L56 81 L56 114 L28 130 L0 114 L0 81 Z"
            fill="none"
            stroke="#f0a520"
            strokeWidth="1.5"
          />
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill="url(#hex)" />
    </svg>
  );
}
