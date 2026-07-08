"use client";

import { usePathname } from "next/navigation";
import { Topbar, titleFromPathname } from "./topbar";

export function TopbarClient({ userName }: { userName: string }) {
  const pathname = usePathname();
  return <Topbar title={titleFromPathname(pathname)} userName={userName} />;
}
