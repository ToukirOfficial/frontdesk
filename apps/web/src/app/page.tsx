import {
  ArrowRight,
  BookOpen,
  CalendarCheck,
  CircleHelp,
  Gauge,
  Headset,
  KeyRound,
  ScrollText,
  Server,
  ShieldCheck,
} from 'lucide-react';
import Link from 'next/link';
import { ChatPreview, Terminal } from '@/components/landing';
import { Logo } from '@/components/logo';
import { Button } from '@/components/ui/button';
import { demoKey } from '@/lib/demo';

export const dynamic = 'force-dynamic';

const REPO = 'https://github.com/ToukirOfficial/frontdesk';

const PROVIDERS = ['Anthropic', 'OpenAI', 'Google Gemini', 'Ollama', 'Any OpenAI-compatible API'];

const STEPS = [
  {
    n: '01',
    title: 'Add what you know',
    text: 'FAQs, prices, services and policies as text, PDF or Word files, or import your website. Add your opening hours and contact details once.',
  },
  {
    n: '02',
    title: 'Paste two lines on your site',
    text: 'One tag and one script. Works on WordPress, Laravel or plain HTML. The widget can’t clash with your styles.',
  },
  {
    n: '03',
    title: 'It answers, your team steps in',
    text: 'Visitors get grounded answers around the clock. Enquiries land in your inbox, and your team can take over any chat live.',
  },
];

const FEATURES = [
  { icon: BookOpen, title: 'Answers from your information only', text: 'Every answer comes from your knowledge and business details, with its sources shown.' },
  { icon: CircleHelp, title: 'Honest “I don’t know”', text: 'No invented prices or policies. Gaps go to an Unanswered list, so you know what to add.' },
  { icon: CalendarCheck, title: 'Enquiries and bookings', text: 'Collects enquiries with consent and emails them to you. Shows your booking link or real free times.' },
  { icon: Headset, title: 'Live handover', text: 'Staff see chats as they happen and take over in one click. Nobody online? It takes a message.' },
  { icon: ScrollText, title: 'Your rules, in plain English', text: '“Never give legal advice; offer a consultation.” Presets for clinics, law firms and general businesses.' },
  { icon: ShieldCheck, title: 'Hard to trick', text: 'Resists prompt injection, from visitors and from text inside your own documents. Each business’s data stays separate.' },
  { icon: Gauge, title: 'Costs you control', text: 'Rate limits per visitor and a monthly AI limit per workspace. At the limit, the chat takes messages.' },
  { icon: KeyRound, title: 'Bring your own key', text: 'Use your own AI provider and model. Keys are stored encrypted and never shown again.' },
];

const SELF_HOST = [
  { icon: Server, text: 'Runs on any Linux server with Docker' },
  { icon: KeyRound, text: 'Anthropic, OpenAI, Gemini, or a model you host with Ollama' },
  { icon: ShieldCheck, text: 'AGPL-3.0: free to use, inspect and change' },
];

const FAQ = [
  {
    q: 'Is it really free?',
    a: 'Yes. Frontdesk is open source (AGPL-3.0) and you host it yourself. The only running cost is your AI provider, billed to your own key, or nothing at all with a model you run yourself through Ollama.',
  },
  {
    q: 'Which AI models does it work with?',
    a: 'Anthropic, OpenAI, Google Gemini, or any OpenAI-compatible endpoint, including self-hosted models with Ollama. You choose the provider and model in the dashboard.',
  },
  {
    q: 'What happens when it doesn’t know an answer?',
    a: 'It says so plainly, offers to take a message or find a person, and lists the question under Unanswered so you can add the missing information.',
  },
  {
    q: 'Where is my data stored?',
    a: 'On your own server, in your own database. Knowledge is searched locally, and only the question plus the relevant extracts go to the AI provider you picked.',
  },
  {
    q: 'Will it work on my website?',
    a: 'If you can paste HTML into your site, yes: WordPress, Laravel, Squarespace code blocks or plain HTML. It works on phones, with a keyboard and with screen readers.',
  },
];

function Section({ id, eyebrow, title, intro, children }: { id?: string; eyebrow: string; title: string; intro?: string; children: React.ReactNode }) {
  return (
    <section id={id} className="scroll-mt-20 border-t py-14 sm:py-16">
      <div className="mx-auto max-w-6xl px-4">
        <p className="font-mono text-xs tracking-wider text-primary uppercase">{eyebrow}</p>
        <h2 className="mt-2 max-w-2xl text-2xl font-semibold tracking-[-0.025em] sm:text-3xl">{title}</h2>
        {intro && <p className="mt-3 max-w-2xl text-muted-foreground">{intro}</p>}
        <div className="mt-8">{children}</div>
      </div>
    </section>
  );
}

export default async function HomePage() {
  const demo = (await demoKey()) !== null;
  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-30 border-b bg-background/85 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-4 px-4">
          <Link href="/" aria-label="Frontdesk home">
            <Logo />
          </Link>
          <nav aria-label="Main" className="hidden items-center gap-6 text-sm text-muted-foreground md:flex">
            <a href="#how" className="hover:text-foreground">How it works</a>
            <a href="#features" className="hover:text-foreground">Features</a>
            <a href="#self-host" className="hover:text-foreground">Self-host</a>
            <a href="#faq" className="hover:text-foreground">FAQ</a>
            <a href={REPO} className="hover:text-foreground" rel="noopener noreferrer">GitHub</a>
          </nav>
          <div className="flex items-center gap-1.5">
            <Button asChild variant="ghost">
              <Link href="/login">Log in</Link>
            </Button>
            <Button asChild>
              <Link href="/signup">Get started</Link>
            </Button>
          </div>
        </div>
      </header>

      <main>
        {/* Hero */}
        <section className="relative overflow-hidden">
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 [background-image:linear-gradient(to_right,rgb(22_25_28/0.05)_1px,transparent_1px),linear-gradient(to_bottom,rgb(22_25_28/0.05)_1px,transparent_1px)] [background-size:32px_32px] [mask-image:linear-gradient(to_bottom,black,transparent_85%)]"
          />
          <div className="relative mx-auto grid max-w-6xl items-center gap-10 px-4 py-12 sm:py-16 lg:grid-cols-[1.1fr_1fr] lg:gap-14">
            <div>
              <p className="inline-flex items-center gap-2 rounded-full border bg-card px-3 py-1 font-mono text-[11px] text-muted-foreground">
                <span className="size-1.5 shrink-0 rounded-full bg-primary" aria-hidden />
                <span>Open source · Self-hosted · Bring your own key</span>
              </p>
              <h1 className="mt-5 text-[2.1rem] leading-[1.1] font-semibold tracking-[-0.035em] sm:text-5xl">
                The AI receptionist for your website that never makes things up.
              </h1>
              <p className="mt-4 max-w-xl text-[17px] text-muted-foreground">
                Frontdesk answers visitors’ questions from your own information, takes enquiries and bookings, and hands over to your
                team when it isn’t sure. Built for clinics, solicitors, salons and every small business that answers the same
                questions all day.
              </p>
              <div className="mt-7 flex flex-wrap gap-2.5">
                <Button asChild size="lg" className="h-10 px-4">
                  <Link href="/signup">
                    Get started free <ArrowRight className="size-4" aria-hidden />
                  </Link>
                </Button>
                {demo && (
                  <Button asChild size="lg" variant="outline" className="h-10 px-4">
                    <Link href="/demo">Try the live demo</Link>
                  </Button>
                )}
                <Button asChild size="lg" variant="ghost" className="h-10 px-4">
                  <a href={REPO} rel="noopener noreferrer">
                    View on GitHub
                  </a>
                </Button>
              </div>
              <dl className="mt-9 grid max-w-lg grid-cols-3 gap-4 border-t pt-5">
                {[
                  ['£0', 'licence fee, ever'],
                  ['2 lines', 'to add it to a site'],
                  ['24/7', 'answers, no guessing'],
                ].map(([v, l]) => (
                  <div key={l}>
                    <dt className="sr-only">{l}</dt>
                    <dd className="text-xl font-semibold tracking-tight">{v}</dd>
                    <dd className="text-xs text-muted-foreground">{l}</dd>
                  </div>
                ))}
              </dl>
            </div>
            <div className="flex justify-center lg:justify-end">
              <ChatPreview />
            </div>
          </div>
          <div className="relative border-t bg-card/60">
            <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-4 text-sm">
              <span className="font-mono text-xs text-muted-foreground uppercase">Works with</span>
              {PROVIDERS.map((p) => (
                <span key={p} className="font-medium text-foreground/80">
                  {p}
                </span>
              ))}
            </div>
          </div>
        </section>

        <Section id="how" eyebrow="How it works" title="From your FAQs to a receptionist on your site in an afternoon.">
          <div className="grid gap-4 lg:grid-cols-[1fr_1fr_1fr]">
            {STEPS.map((s) => (
              <div key={s.n} className="rounded-lg border bg-card p-5">
                <p className="font-mono text-xs text-primary">{s.n}</p>
                <h3 className="mt-2 font-semibold">{s.title}</h3>
                <p className="mt-1.5 text-sm text-muted-foreground">{s.text}</p>
              </div>
            ))}
          </div>
          <Terminal
            className="mt-4"
            title="your-website.html"
            lines={[
              '# Paste before </body>. Copy your own key from Assistant → Website widget.',
              '<frontdesk-chat key="fd_pk_…"></frontdesk-chat>',
              '<script src="https://your-frontdesk.example/widget.js" defer></script>',
            ]}
          />
        </Section>

        <Section
          id="features"
          eyebrow="Features"
          title="Everything a good receptionist does. Nothing it shouldn’t."
          intro="Answers, enquiries, bookings and handover in one place, with the guardrails a business needs before it lets AI talk to its customers."
        >
          <div className="grid gap-px overflow-hidden rounded-lg border bg-border sm:grid-cols-2 lg:grid-cols-4">
            {FEATURES.map(({ icon: Icon, title, text }) => (
              <div key={title} className="bg-card p-5">
                <Icon className="size-5 text-primary" aria-hidden />
                <h3 className="mt-3 text-[15px] font-semibold">{title}</h3>
                <p className="mt-1.5 text-sm text-muted-foreground">{text}</p>
              </div>
            ))}
          </div>
        </Section>

        <Section
          eyebrow="Grounded by design"
          title="It can only answer from what you’ve given it."
          intro="Each question searches your knowledge, hands the closest extracts to the model as reference data (never as instructions), and the model reports gaps and sources with structured signals instead of wording the app has to guess at."
        >
          <div className="grid gap-4 lg:grid-cols-2">
            <Terminal
              title="what happens on each question"
              lines={[
                '$ visitor: "Do you take Bupa?"',
                '  search  5 nearest extracts · this business only',
                '  prompt  your rules + preset + extracts as untrusted data',
                '  answer  "Yes. We’re registered with Bupa, AXA Health…"',
                '  cite    → Do you accept health insurance?',
                '',
                '$ visitor: "Do you offer hydrotherapy?"',
                '  search  nothing relevant',
                '  answer  "I’m sorry, I don’t have that information…"',
                '  report  → added to Unanswered',
              ]}
            />
            <ul className="grid content-start gap-3">
              {[
                ['Retrieval per business', 'Every search is scoped to one workspace. One business can never see another’s knowledge.'],
                ['Untrusted data stays data', 'Text inside an imported page or document can’t give the assistant orders.'],
                ['Tested, not promised', 'An evaluation set checks grounded answers, honest “don’t know”, refusing advice and resisting injection, against the model you choose.'],
              ].map(([t, d]) => (
                <li key={t} className="rounded-lg border bg-card p-4">
                  <p className="font-semibold">{t}</p>
                  <p className="mt-1 text-sm text-muted-foreground">{d}</p>
                </li>
              ))}
            </ul>
          </div>
        </Section>

        <section id="self-host" className="scroll-mt-20 bg-[#16191c] py-14 text-white sm:py-16">
          <div className="mx-auto grid max-w-6xl gap-10 px-4 lg:grid-cols-2 lg:items-center">
            <div>
              <p className="font-mono text-xs tracking-wider text-[#5eead4] uppercase">Self-host</p>
              <h2 className="mt-2 text-2xl font-semibold tracking-[-0.025em] sm:text-3xl">Your server. Your data. Your AI key.</h2>
              <p className="mt-3 text-white/70">
                One command runs the whole thing: dashboard, API, background worker, PostgreSQL with pgvector and Redis. A small VPS
                with 2 GB of RAM is enough. It starts without any AI key, and each business can add its own.
              </p>
              <ul className="mt-6 grid gap-2.5 text-sm text-white/80">
                {SELF_HOST.map(({ icon: Icon, text }) => (
                  <li key={text} className="flex items-center gap-2.5">
                    <Icon className="size-4 shrink-0 text-[#5eead4]" aria-hidden />
                    {text}
                  </li>
                ))}
              </ul>
              <div className="mt-7 flex flex-wrap gap-2.5">
                <Button asChild size="lg" className="h-10 bg-white px-4 text-[#16191c] hover:bg-white/90">
                  <a href={`${REPO}#self-host-with-docker`} rel="noopener noreferrer">
                    Read the setup guide
                  </a>
                </Button>
              </div>
            </div>
            <Terminal
              title="~/frontdesk"
              lines={[
                '$ git clone https://github.com/ToukirOfficial/frontdesk',
                '$ cd frontdesk && cp .env.example .env',
                '# add three secrets (openssl rand -hex 32), WEB_URL, SMTP_URL',
                '$ docker compose up -d',
                '  ✓ postgres  ✓ redis  ✓ api  ✓ worker  ✓ web',
                '  Frontdesk is running on http://localhost:8025',
              ]}
            />
          </div>
        </section>

        <Section id="faq" eyebrow="FAQ" title="Questions people ask first.">
          <div className="divide-y rounded-lg border bg-card">
            {FAQ.map((f) => (
              <details key={f.q} className="group px-5 py-4">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-medium [&::-webkit-details-marker]:hidden">
                  {f.q}
                  <span className="font-mono text-muted-foreground transition-transform group-open:rotate-45" aria-hidden>
                    +
                  </span>
                </summary>
                <p className="mt-2 max-w-3xl text-sm text-muted-foreground">{f.a}</p>
              </details>
            ))}
          </div>
        </Section>

        <section className="border-t py-14 sm:py-16">
          <div className="mx-auto flex max-w-6xl flex-col items-start justify-between gap-6 px-4 md:flex-row md:items-center">
            <div>
              <h2 className="text-2xl font-semibold tracking-[-0.025em] sm:text-3xl">Stop losing customers to unanswered questions.</h2>
              <p className="mt-2 text-muted-foreground">Set up your workspace, add your FAQs and see your first grounded answer in minutes.</p>
            </div>
            <div className="flex flex-wrap gap-2.5">
              <Button asChild size="lg" className="h-10 px-4">
                <Link href="/signup">
                  Get started free <ArrowRight className="size-4" aria-hidden />
                </Link>
              </Button>
              {demo && (
                <Button asChild size="lg" variant="outline" className="h-10 px-4">
                  <Link href="/demo">Try the demo</Link>
                </Button>
              )}
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-6 text-sm text-muted-foreground">
          <Logo />
          <p>Free and open source under AGPL-3.0 · Self-hosted · Bring your own key</p>
          <div className="flex gap-4">
            <a href={REPO} className="hover:text-foreground" rel="noopener noreferrer">GitHub</a>
            <Link href="/login" className="hover:text-foreground">Log in</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
