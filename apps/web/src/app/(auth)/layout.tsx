import { Check } from 'lucide-react';
import Link from 'next/link';
import { Logo } from '@/components/logo';

const POINTS = [
  'Answers visitors only from your own information',
  'Says “I don’t know” instead of guessing',
  'Takes enquiries and hands over to your team',
];

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
      <aside className="hidden flex-col justify-between bg-primary p-10 text-primary-foreground lg:flex">
        <Link href="/" aria-label="Frontdesk home" className="w-fit rounded-md bg-white/10 p-1.5 pr-3">
          <Logo />
        </Link>
        <div className="max-w-md">
          <p className="text-3xl leading-tight font-semibold tracking-[-0.025em]">
            A receptionist for your website that never makes things up.
          </p>
          <ul className="mt-6 grid gap-3 text-[15px] text-primary-foreground/85">
            {POINTS.map((p) => (
              <li key={p} className="flex gap-2.5">
                <Check className="mt-0.5 size-4 shrink-0" aria-hidden />
                {p}
              </li>
            ))}
          </ul>
        </div>
        <p className="text-[13px] text-primary-foreground/75">Free and open source (AGPL-3.0). Self-hosted.</p>
      </aside>
      <main className="flex min-h-dvh flex-col items-center justify-center gap-8 px-4 py-10">
        <Link href="/" className="lg:hidden" aria-label="Frontdesk home">
          <Logo />
        </Link>
        <div className="w-full max-w-sm">{children}</div>
      </main>
    </div>
  );
}
