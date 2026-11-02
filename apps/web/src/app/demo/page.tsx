import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import Script from 'next/script';
import { DemoLoginButton } from '@/components/demo-login';
import { demoKey } from '@/lib/demo';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Demo: Riverside Physio', robots: { index: false } };

const PRICES = [
  ['Initial assessment and treatment (60 min)', '£65'],
  ['Follow-up treatment (45 min)', '£50'],
  ['Sports massage (45 min)', '£55'],
];

/** A made-up clinic website with the real widget on it. Everything on this page is fictional. */
export default async function DemoPage() {
  const key = await demoKey();
  if (!key) notFound();
  return (
    <div className="min-h-dvh bg-[#fbfaf7] font-serif text-[#22313a]">
      <p className="bg-[#22313a] px-4 py-2 text-center font-sans text-sm text-white">
        This is a demo of Frontdesk on a made-up clinic website. The chat in the corner shows sample answers to suggested questions;
        add your own AI key in the chat for live answers. Conversations reset every night.
      </p>
      <div className="flex justify-center bg-[#22313a] px-4 pb-3 font-sans">
        <DemoLoginButton className="w-full max-w-64 [&_button]:bg-white [&_button]:text-[#22313a]" />
      </div>
      <header className="mx-auto flex max-w-4xl flex-wrap items-center justify-between gap-4 px-4 py-6">
        <p className="text-2xl font-semibold">Riverside Physio</p>
        <nav className="flex gap-5 font-sans text-sm" aria-label="Demo site">
          <span>Treatments</span>
          <span>Prices</span>
          <span>Contact</span>
        </nav>
      </header>
      <main className="mx-auto grid max-w-4xl gap-10 px-4 pb-24">
        <section className="rounded-2xl bg-[#e6efe9] px-6 py-12">
          <h1 className="max-w-xl text-4xl leading-tight font-semibold">Get moving again, without the wait.</h1>
          <p className="mt-4 max-w-xl font-sans text-lg">
            Chartered physiotherapists for back pain, sports injuries and recovery after surgery. No referral needed.
          </p>
        </section>
        <section className="grid gap-6 font-sans sm:grid-cols-3">
          {['Back and neck pain', 'Sports injuries', 'Post-surgery rehab'].map((t) => (
            <div key={t} className="rounded-xl border border-[#d9e2dc] bg-white p-5">
              <h2 className="font-serif text-lg font-semibold">{t}</h2>
              <p className="mt-2 text-sm text-[#55636b]">Assessment, hands-on treatment and an exercise plan that fits your life.</p>
            </div>
          ))}
        </section>
        <section className="font-sans">
          <h2 className="font-serif text-2xl font-semibold">Prices</h2>
          <ul className="mt-4 divide-y rounded-xl border border-[#d9e2dc] bg-white">
            {PRICES.map(([name, price]) => (
              <li key={name} className="flex justify-between gap-4 px-5 py-3">
                <span>{name}</span>
                <span className="font-semibold">{price}</span>
              </li>
            ))}
          </ul>
        </section>
      </main>
      <frontdesk-chat data-key={key} />
      <Script src="/widget.js" strategy="afterInteractive" />
    </div>
  );
}
