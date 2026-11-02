import { cn } from '@/lib/utils';

/** A speech bubble with a reception bell inside: the Frontdesk mark. */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" aria-hidden className={cn('size-8 shrink-0', className)}>
      <rect width="32" height="32" rx="8" fill="var(--primary)" />
      <path d="M9 21.5h14" stroke="white" strokeWidth="2" strokeLinecap="round" />
      <path d="M10.5 20a5.5 5.5 0 0 1 11 0" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" />
      <circle cx="16" cy="12.5" r="1.5" fill="white" />
    </svg>
  );
}

export function Logo() {
  return (
    <span className="flex items-center gap-2.5">
      <LogoMark />
      <span className="text-[17px] font-semibold tracking-[-0.02em]">Frontdesk</span>
    </span>
  );
}
