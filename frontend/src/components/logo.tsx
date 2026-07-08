import Image from "next/image";

/** Logo oficial da Be Fluent — o "B" fluido em âmbar. */
export function LogoMark({ className }: { className?: string }) {
  return (
    <Image
      src="/logo-be-fluent.png"
      alt="Be Fluent"
      width={32}
      height={32}
      className={className ?? "size-8"}
      priority
    />
  );
}

export function Logo({
  className,
  showText = true,
}: {
  className?: string;
  showText?: boolean;
}) {
  return (
    <span className={`inline-flex items-center gap-2 ${className ?? ""}`}>
      <LogoMark />
      {showText && (
        <span className="font-display gradient-text text-xl font-extrabold tracking-tight">
          Be Fluent
        </span>
      )}
    </span>
  );
}
