import Image from "next/image";

/** The RP mark with the product name under it. The dark mark is used on light pages and the white one on dark pages. */
export function Brand({ size = 72, className = "" }: { size?: number; className?: string }) {
  const h = Math.round(size * (368 / 531));
  return (
    <div className={`flex flex-col items-start gap-1 ${className}`}>
      <Image src="/brand/rp-logo.png" alt="RP" width={size} height={h} priority unoptimized className="dark:hidden" />
      <Image src="/brand/rp-logo-white.png" alt="RP" width={size} height={h} priority unoptimized className="hidden dark:block" />
      <span className="text-base font-semibold leading-tight">Career Agent</span>
    </div>
  );
}
