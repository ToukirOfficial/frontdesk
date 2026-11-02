import { Check } from 'lucide-react';
import Link from 'next/link';
import { Logo } from '@/components/logo';
import { Button } from '@/components/ui/button';

const POINTS = [
  'Answers from your prices, services, opening hours and policies, and shows its sources',
  'Says “I don’t know” instead of guessing, and offers to take a message',
  'Takes enquiries, offers booking times and hands over to a person live',
  'Free and open source. Your data stays on your own server.',
];

export default function HomePage() {
  return (
    <div className="mx-auto flex min-h-dvh max-w-3xl flex-col px-4 py-6">
      <header className="flex items-center justify-between">
        <Logo />
        <nav className="flex gap-2">
          <Button asChild variant="ghost">
            <Link href="/login">Log in</Link>
          </Button>
          <Button asChild>
            <Link href="/signup">Get started</Link>
          </Button>
        </nav>
      </header>
      <main className="flex flex-1 flex-col justify-center py-16">
        <h1 className="text-4xl leading-tight font-semibold tracking-[-0.03em] sm:text-5xl">
          An AI receptionist for your website that never makes things up.
        </h1>
        <p className="mt-4 max-w-xl text-lg text-muted-foreground">
          Frontdesk answers visitors’ questions from your own information, takes enquiries and hands over to your team
          when it isn’t sure.
        </p>
        <ul className="mt-8 grid gap-3">
          {POINTS.map((p) => (
            <li key={p} className="flex gap-2.5">
              <Check className="mt-1 size-4 shrink-0 text-primary" aria-hidden />
              {p}
            </li>
          ))}
        </ul>
      </main>
      <footer className="text-sm text-muted-foreground">AGPL-3.0 · Self-hosted</footer>
    </div>
  );
}
