import { cn } from '@/lib/utils';

/** A static picture of the real widget mid-conversation. Everything in it is fictional. */
export function ChatPreview({ className }: { className?: string }) {
  return (
    <div
      className={cn('w-full max-w-[380px] overflow-hidden rounded-xl border bg-card shadow-[0_18px_50px_-20px_rgb(0_0_0/0.28)]', className)}
      role="img"
      aria-label="Example chat: a visitor asks about prices and gets an answer with its sources; then asks about hydrotherapy and is told honestly the assistant doesn't know, with an offer to take a message."
    >
      <div className="flex items-center gap-2.5 bg-primary px-4 py-3 text-primary-foreground">
        <span className="grid size-8 place-items-center rounded-full bg-white/20 text-sm font-semibold">R</span>
        <div className="min-w-0 flex-1 leading-tight">
          <p className="text-sm font-semibold">Riverside Physio</p>
          <p className="text-xs text-white/80">AI assistant · answers from our own information</p>
        </div>
      </div>
      <div className="grid gap-2.5 bg-[#fafaf8] p-3.5 text-[13.5px] leading-snug" aria-hidden>
        <Bubble side="left">Hello! Ask me about treatments, prices or opening hours.</Bubble>
        <Bubble side="right">How much is a first appointment?</Bubble>
        <Bubble side="left">
          Your first appointment is a 60-minute assessment and treatment, and costs £65. It includes a full assessment and a home
          exercise plan.
          <span className="mt-2 flex flex-wrap gap-1.5">
            <Source>Prices</Source>
            <Source>Your first appointment</Source>
          </span>
        </Bubble>
        <Bubble side="right">Do you offer hydrotherapy?</Bubble>
        <Bubble side="left">
          I’m sorry, I don’t have that information. I can take a message for the team, or pass you to a member of staff.
        </Bubble>
      </div>
      <div className="flex flex-wrap gap-1.5 border-t px-3.5 py-2.5" aria-hidden>
        {['Leave a message', 'Book', 'Talk to a person'].map((c) => (
          <span key={c} className="rounded-full border px-2.5 py-1 text-xs">
            {c}
          </span>
        ))}
      </div>
      <div className="flex items-center gap-2 border-t px-3.5 py-2.5" aria-hidden>
        <span className="flex-1 rounded-md border bg-background px-3 py-2 text-xs text-muted-foreground">Type your message…</span>
        <span className="rounded-md bg-primary px-3 py-2 text-xs font-medium text-primary-foreground">Send</span>
      </div>
    </div>
  );
}

function Bubble({ side, children }: { side: 'left' | 'right'; children: React.ReactNode }) {
  return (
    <p
      className={cn(
        'max-w-[85%] rounded-lg px-3 py-2',
        side === 'left' ? 'justify-self-start border bg-card' : 'justify-self-end bg-[#16191c] text-white',
      )}
    >
      {children}
    </p>
  );
}

function Source({ children }: { children: React.ReactNode }) {
  return <span className="rounded bg-accent px-1.5 py-0.5 text-[11px] font-medium text-accent-foreground">{children}</span>;
}

/** A dark terminal-style panel. `lines` starting with "$ " are commands, "# " comments, the rest output. */
export function Terminal({ title, lines, className }: { title: string; lines: string[]; className?: string }) {
  return (
    <div className={cn('overflow-hidden rounded-lg border border-white/10 bg-[#111417] text-[#d6dbe0]', className)}>
      <div className="flex items-center gap-2 border-b border-white/10 px-3.5 py-2">
        <span className="flex gap-1.5" aria-hidden>
          <span className="size-2.5 rounded-full bg-white/15" />
          <span className="size-2.5 rounded-full bg-white/15" />
          <span className="size-2.5 rounded-full bg-white/15" />
        </span>
        <span className="font-mono text-[11px] text-white/50">{title}</span>
      </div>
      <pre className="overflow-x-auto px-4 py-3.5 font-mono text-[12.5px] leading-relaxed">
        {lines.map((l, i) => (
          <code key={i} className="block">
            {l.startsWith('$ ') ? (
              <>
                <span className="text-[#5eead4]">$</span> {l.slice(2)}
              </>
            ) : l.startsWith('# ') ? (
              <span className="text-white/40">{l}</span>
            ) : (
              <span className="text-white/75">{l || ' '}</span>
            )}
          </code>
        ))}
      </pre>
    </div>
  );
}
