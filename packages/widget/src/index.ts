import type { BookingService, ChatMessage, DemoKeyInfo, Slots, VisitorServerEvents, WidgetConfig, WidgetSession } from '@frontdesk/shared';
import { io, type Socket } from 'socket.io-client';
import { MORE_STYLES, STYLES } from './styles.js';

/**
 * <frontdesk-chat key="fd_pk_…"></frontdesk-chat>   (or data-key="…" in React, where `key` is reserved)
 * <script src="https://your-frontdesk.example/widget.js" defer></script>
 *
 * A Web Component with its own Shadow DOM, so the host site's CSS can't break it and its CSS can't leak out.
 * Everything visitors or the server send is shown with textContent, never as HTML.
 */

// Where this script was loaded from = the Frontdesk server, unless an `api` attribute says otherwise.
const SCRIPT_ORIGIN = (() => {
  try {
    const src = (document.currentScript as HTMLScriptElement | null)?.src;
    return src ? new URL(src).origin : window.location.origin;
  } catch {
    return window.location.origin;
  }
})();

const ICON_CHAT =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>';
const ICON_CLOSE =
  '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>';

type AckResult = { ok: boolean; error?: string };
interface VisitorClientEvents {
  message: (body: { text: string }, ack: (res: AckResult) => void) => void;
  handover: (ack: (res: AckResult & { available?: boolean }) => void) => void;
}

const money = new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' });
const dayLabel = (iso: string) =>
  new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' }).format(new Date(`${iso}T12:00:00Z`));
const addDays = (iso: string, n: number) => new Date(Date.parse(`${iso}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const todayUk = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London' }).format(new Date());
/** A v4 UUID. crypto.randomUUID only exists on https pages, and some small-business sites are still plain http. */
const uuid = (): string => {
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6]! & 0x0f) | 0x40;
  b[8] = (b[8]! & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
};
type VisitorSocket = Socket<VisitorServerEvents, VisitorClientEvents>;

/** Providers a demo visitor can use with their own key (the API checks this too). */
const DEMO_PROVIDERS = [
  ['anthropic', 'Anthropic (Claude)'],
  ['openai', 'OpenAI'],
  ['gemini', 'Google Gemini'],
] as const;
const providerLabel = (p: string) => DEMO_PROVIDERS.find(([id]) => id === p)?.[1] ?? p;

const store = {
  get(k: string): string | null {
    try {
      return window.localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  set(k: string, v: string): void {
    try {
      window.localStorage.setItem(k, v);
    } catch {
      /* private mode: the chat still works, it just won't resume after a reload */
    }
  },
};

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string> = {}, text?: string) => {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  if (text !== undefined) node.textContent = text;
  return node;
};

class FrontdeskChat extends HTMLElement {
  private readonly root = this.attachShadow({ mode: 'open' });
  private config?: WidgetConfig;
  private socket?: VisitorSocket;
  private started = false;
  private pending?: HTMLElement;
  private busy = false;

  private launcher!: HTMLButtonElement;
  private panel!: HTMLElement;
  private log!: HTMLElement;
  private input!: HTMLTextAreaElement;
  private sendBtn!: HTMLButtonElement;
  private errorLine!: HTMLElement;
  private subtitle!: HTMLElement;
  private actions!: HTMLElement;
  private chatForm!: HTMLFormElement;
  private sheet!: HTMLElement;
  private token = '';
  private lastVisitorText = '';
  private banner!: HTMLElement;
  private suggest!: HTMLElement;
  /** ai or human (a member of staff has the chat). */
  private convMode: WidgetSession['mode'] = 'ai';
  /** Demo only: the visitor's own key for this chat (last 4 characters only). */
  private demoKey: DemoKeyInfo | null = null;

  /** `key` in plain HTML; `data-key` where `key` is reserved (React). */
  private get key(): string {
    return this.getAttribute('key') ?? this.getAttribute('data-key') ?? '';
  }
  private get api(): string {
    return (this.getAttribute('api') ?? SCRIPT_ORIGIN).replace(/\/+$/, '');
  }
  private get storageKey(): string {
    return `frontdesk:${this.key}`;
  }

  async connectedCallback(): Promise<void> {
    if (!/^fd_pk_[a-f0-9]{32}$/.test(this.key)) return;
    try {
      const res = await fetch(`${this.api}/api/widget/${this.key}/config`, { credentials: 'omit' });
      if (!res.ok) return; // not allowed on this site, or unknown key: show nothing
      this.config = (await res.json()) as WidgetConfig;
    } catch {
      return;
    }
    this.render();
  }

  disconnectedCallback(): void {
    this.socket?.disconnect();
  }

  private render(): void {
    const c = this.config!;
    const style = el('style');
    style.textContent = STYLES + MORE_STYLES;
    this.root.append(style);
    this.style.setProperty('--fd-brand', /^#[0-9a-fA-F]{6}$/.test(c.brandColour) ? c.brandColour : '#0f766e');

    this.launcher = el('button', {
      class: `launcher ${c.position}`,
      type: 'button',
      'aria-label': `Chat with ${c.name}`,
      'aria-expanded': 'false',
      'aria-controls': 'fd-panel',
    }) as HTMLButtonElement;
    this.launcher.innerHTML = ICON_CHAT; // a constant
    this.launcher.addEventListener('click', () => this.toggle(true));

    this.panel = el('section', { class: `panel ${c.position}`, id: 'fd-panel', role: 'dialog', 'aria-labelledby': 'fd-title' });
    this.panel.hidden = true;

    const header = el('header');
    if (c.avatarUrl) {
      header.append(el('img', { src: new URL(c.avatarUrl, this.api).toString(), alt: '' }));
    } else {
      header.append(el('span', { class: 'badge', 'aria-hidden': 'true' }, c.name.trim().charAt(0).toUpperCase() || '?'));
    }
    const titles = el('div', { style: 'flex:1;min-width:0' });
    this.subtitle = el('p', {}, 'AI assistant · answers from our own information');
    titles.append(el('h2', { id: 'fd-title' }, c.name), this.subtitle);
    const close = el('button', { class: 'close', type: 'button', 'aria-label': 'Close chat' }) as HTMLButtonElement;
    close.innerHTML = ICON_CLOSE; // a constant
    close.addEventListener('click', () => this.toggle(false));
    header.append(titles, close);

    this.log = el('div', { class: 'log', role: 'log', 'aria-live': 'polite', 'aria-label': 'Conversation' });
    this.errorLine = el('p', { class: 'error', role: 'alert' });
    this.errorLine.hidden = true;

    const form = el('form', { class: 'chat' }) as HTMLFormElement;
    this.chatForm = form;
    const label = el('label', { class: 'sr', for: 'fd-input' }, 'Type your message');
    this.input = el('textarea', { id: 'fd-input', rows: '1', maxlength: '2000', placeholder: 'Type your message…' }) as HTMLTextAreaElement;
    this.sendBtn = el('button', { class: 'send', type: 'submit' }, 'Send') as HTMLButtonElement;
    form.append(label, this.input, this.sendBtn);
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      void this.send();
    });
    this.input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        void this.send();
      }
    });

    this.actions = el('div', { class: 'actions', role: 'group', 'aria-label': 'Other options' });
    const chip = (label: string, fn: () => void) => {
      const b = el('button', { class: 'chip', type: 'button' }, label);
      b.addEventListener('click', fn);
      this.actions.append(b);
    };
    chip('Leave a message', () => this.showEnquiry());
    if (c.booking === 'slotwise') chip('Book', () => void this.showServices());
    if (c.booking === 'link' && c.bookingUrl && /^https?:\/\//.test(c.bookingUrl)) {
      chip('Book', () => window.open(c.bookingUrl!, '_blank', 'noopener'));
    }
    if (c.mode === 'chat') chip('Talk to a person', () => void this.askForPerson());

    this.sheet = el('section', { class: 'sheet', 'aria-live': 'polite' });
    this.sheet.hidden = true;

    this.banner = el('p', { class: 'banner', role: 'status' });
    this.suggest = el('div', { class: 'suggest', role: 'group', 'aria-label': 'Suggested questions' });
    for (const q of c.suggestions) {
      const b = el('button', { class: 'chip', type: 'button' }, q);
      b.addEventListener('click', () => void this.sendText(q));
      this.suggest.append(b);
    }

    const note = el('p', { class: 'note' }, 'Please don’t share sensitive personal details here.');
    this.panel.append(header, this.banner, this.log, this.sheet, this.errorLine, this.suggest, this.actions, form, note);
    // Leave-a-message mode (e.g. the assistant is paused): no chat box, just the form.
    if (c.mode === 'message') this.actions.hidden = true;
    this.updateComposer();
    this.panel.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') this.toggle(false);
    });
    this.root.append(this.launcher, this.panel);
  }

  private toggle(open: boolean): void {
    this.panel.hidden = !open;
    this.launcher.hidden = open && window.matchMedia('(max-width: 480px)').matches;
    this.launcher.setAttribute('aria-expanded', String(open));
    if (open) {
      if (!this.started) void this.start();
      if (!this.chatForm.hidden) this.input.focus();
    } else {
      this.launcher.hidden = false;
      this.launcher.focus();
    }
  }

  private async start(): Promise<void> {
    this.started = true;
    this.add({ id: 'greeting', role: 'assistant', content: this.config!.greeting, authorName: null, sources: [], createdAt: '' });
    try {
      const res = await fetch(`${this.api}/api/widget/${this.key}/session`, {
        method: 'POST',
        credentials: 'omit',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token: store.get(this.storageKey) ?? undefined }),
      });
      if (!res.ok) throw new Error(String(res.status));
      const s = (await res.json()) as WidgetSession;
      store.set(this.storageKey, s.token);
      this.token = s.token;
      s.messages.forEach((m) => this.add(m));
      this.convMode = s.mode;
      this.demoKey = s.demoKey;
      this.updateComposer();
      this.connect(s.token);
      if (this.config!.mode === 'message') this.showEnquiry();
    } catch {
      this.started = false;
      this.showError('The chat couldn’t start. Please try again in a moment.');
    }
  }

  private connect(token: string): void {
    const socket: VisitorSocket = io(`${this.api}/visitor`, {
      path: '/api/socket.io',
      addTrailingSlash: false,
      auth: { token, key: this.key },
      withCredentials: false,
    });
    socket.on('message', (m) => this.add(m));
    socket.on('reply:start', () => {
      this.pending = this.add({ id: 'pending', role: 'assistant', content: '', authorName: null, sources: [], createdAt: '' });
      this.pending.classList.add('typing');
      this.pending.setAttribute('aria-busy', 'true');
    });
    socket.on('reply:delta', ({ text }) => {
      if (!this.pending) return;
      this.pending.classList.remove('typing');
      const body = this.pending.querySelector('.body');
      if (body) body.textContent += text;
      this.scrollToEnd();
    });
    socket.on('reply:end', (m) => {
      this.pending?.remove();
      this.pending = undefined;
      this.add(m);
    });
    socket.on('reply:error', ({ message }) => this.showError(message));
    socket.on('mode', ({ mode, staffName }) => {
      this.subtitle.textContent =
        mode === 'human' && staffName ? `You’re chatting with ${staffName}` : 'AI assistant · answers from our own information';
      this.convMode = mode;
      this.updateComposer();
    });
    socket.on('handover:unavailable', () => this.showEnquiry());
    this.socket = socket;
  }

  /** Whether visitors can type: someone (the assistant or a person) can actually answer free text. */
  private get canType(): boolean {
    const ai = this.config!.ai;
    return this.convMode === 'human' || ai === 'ready' || (ai === 'replay' && this.demoKey !== null);
  }

  /** Chat box, suggestions and the banner follow the AI state: ready, none, demo replay or demo with own key. */
  private updateComposer(): void {
    const c = this.config!;
    const chat = this.sheet.hidden;
    this.chatForm.hidden = !chat || c.mode === 'message' || !this.canType;
    this.suggest.hidden = !chat || c.mode === 'message' || c.ai !== 'replay' || this.demoKey !== null || this.convMode === 'human';
    this.banner.replaceChildren();
    this.banner.hidden = true;
    if (this.convMode === 'human' || c.mode === 'message') return;
    if (c.ai === 'none') {
      this.banner.append(el('strong', {}, 'No AI provider configured.'), ' The assistant can’t answer yet. You can leave a message or ask for a person.');
      this.banner.hidden = false;
    } else if (c.ai === 'replay') {
      const btn = el('button', { class: 'linkish', type: 'button' }, this.demoKey ? 'Remove key' : 'Use your own key');
      if (this.demoKey) {
        this.banner.append(el('strong', {}, 'Live answers'), ` with your ${providerLabel(this.demoKey.provider)} key ending ${this.demoKey.keyLast4}.`, btn);
        btn.addEventListener('click', () => void this.removeOwnKey());
      } else {
        this.banner.append(el('strong', {}, 'Demo: sample answers.'), ' Pick a question below, or ask anything with your own key.', btn);
        btn.addEventListener('click', () => this.showOwnKey());
      }
      this.banner.hidden = false;
    }
  }

  private async send(): Promise<void> {
    const text = this.input.value.trim();
    if (!text) return;
    this.input.value = '';
    if (!(await this.sendText(text))) this.input.value = text;
  }

  private async sendText(text: string): Promise<boolean> {
    if (this.busy || !this.socket) return false;
    this.busy = true;
    this.sendBtn.disabled = true;
    this.errorLine.hidden = true;
    this.lastVisitorText = text;
    const ack = await this.socket
      .timeout(90_000)
      .emitWithAck('message', { text })
      .catch((): AckResult => ({ ok: false, error: 'No answer. Check your connection and try again.' }));
    if (!ack.ok) this.showError(ack.error ?? 'Your message wasn’t sent.');
    this.busy = false;
    this.sendBtn.disabled = false;
    if (!this.chatForm.hidden) this.input.focus();
    return ack.ok;
  }

  /** Demo only: live answers with the visitor's own key, kept for this chat and deleted after 24 hours. */
  private showOwnKey(): void {
    const provider = el('select');
    for (const [id, label] of DEMO_PROVIDERS) provider.append(el('option', { value: id }, label));
    const model = el('input', { type: 'text', maxlength: '120', required: '', autocomplete: 'off', spellcheck: 'false', placeholder: 'The model id from your provider’s docs' }) as HTMLInputElement;
    const key = el('input', { type: 'password', maxlength: '500', required: '', autocomplete: 'off' }) as HTMLInputElement;
    const error = el('p', { class: 'form-error', role: 'alert' });
    const submit = el('button', { class: 'primary', type: 'submit' }, 'Use my key') as HTMLButtonElement;
    const form = el('form');
    form.style.cssText = 'display:flex;flex-direction:column;gap:10px';
    form.append(
      el('p', { class: 'muted' }, 'Get live answers about this demo clinic, paid by your own key. It’s tested with one tiny request, stored encrypted, used only for this chat, never shown again and deleted after 24 hours. Use a key with a low spending limit.'),
      this.field('Provider', provider),
      this.field('Model', model),
      this.field('API key', key),
      error,
      submit,
    );
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      submit.disabled = true;
      submit.textContent = 'Testing…';
      error.textContent = '';
      const res = await this.post<DemoKeyInfo>('demo-key', { token: this.token, provider: provider.value, model: model.value, apiKey: key.value });
      submit.disabled = false;
      submit.textContent = 'Use my key';
      if (!res.ok) {
        error.textContent = res.error;
        return;
      }
      key.value = '';
      this.demoKey = res.data;
      this.openSheet(null);
    });
    this.openSheet('Use your own key', form);
  }

  private async removeOwnKey(): Promise<void> {
    const res = await this.post('demo-key', { token: this.token }, 'DELETE');
    if (!res.ok) return this.showError(res.error);
    this.demoKey = null;
    this.updateComposer();
  }

  private async askForPerson(): Promise<void> {
    if (!this.socket) return;
    const res = await this.socket
      .timeout(10_000)
      .emitWithAck('handover')
      .catch(() => ({ ok: false, error: 'Couldn’t reach the team. Please leave a message instead.' }) as AckResult);
    if (!res.ok) this.showError(res.error ?? 'Something went wrong.');
  }

  /** Swaps the conversation for a form or list; `null` goes back to the chat. */
  private openSheet(title: string | null, ...content: Node[]): void {
    const chat = title === null;
    this.sheet.hidden = chat;
    this.log.hidden = !chat;
    this.actions.hidden = !chat || this.config!.mode === 'message';
    this.errorLine.hidden = true;
    this.updateComposer();
    if (chat) {
      if (!this.chatForm.hidden) this.input.focus();
      return;
    }
    this.sheet.replaceChildren();
    if (this.config!.mode === 'chat') {
      const back = el('button', { class: 'back', type: 'button' }, '← Back to chat');
      back.addEventListener('click', () => this.openSheet(null));
      this.sheet.append(back);
    }
    const h = el('h3', { tabindex: '-1' }, title);
    this.sheet.append(h, ...content);
    h.focus();
  }

  private field(label: string, input: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement): HTMLElement {
    const id = `fd-${label.toLowerCase().replace(/\W+/g, '-')}`;
    input.id = id;
    const wrap = el('div', { class: 'field' });
    wrap.append(el('label', { for: id }, label), input);
    return wrap;
  }

  private consentBox(): { box: HTMLElement; input: HTMLInputElement } {
    const input = el('input', { type: 'checkbox', required: '' }) as HTMLInputElement;
    const box = el('label', { class: 'check' });
    box.append(input, el('span', {}, this.config!.consentText));
    return { box, input };
  }

  private async post<T>(
    path: string,
    body: unknown,
    method: 'POST' | 'DELETE' = 'POST',
  ): Promise<{ ok: true; data: T } | { ok: false; error: string; code?: string }> {
    try {
      const res = await fetch(`${this.api}/api/widget/${this.key}/${path}`, {
        method,
        credentials: 'omit',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = (await res.json().catch(() => ({}))) as { message?: string; errorCode?: string; fields?: Record<string, string> };
      if (res.ok) return { ok: true, data: data as T };
      const first = data.fields ? Object.values(data.fields)[0] : undefined;
      return { ok: false, error: first ?? data.message ?? 'Something went wrong.', code: data.errorCode };
    } catch {
      return { ok: false, error: 'Couldn’t connect. Check your connection and try again.' };
    }
  }

  private showEnquiry(): void {
    const name = el('input', { type: 'text', autocomplete: 'name', maxlength: '100', required: '' }) as HTMLInputElement;
    const email = el('input', { type: 'email', autocomplete: 'email', maxlength: '254' }) as HTMLInputElement;
    const phone = el('input', { type: 'tel', autocomplete: 'tel', maxlength: '20' }) as HTMLInputElement;
    const need = el('textarea', { rows: '4', maxlength: '2000', required: '' }) as HTMLTextAreaElement;
    need.value = this.lastVisitorText;
    const consent = this.consentBox();
    const error = el('p', { class: 'form-error', role: 'alert' });
    const submit = el('button', { class: 'primary', type: 'submit' }, 'Send message') as HTMLButtonElement;
    const form = el('form');
    form.style.cssText = 'display:flex;flex-direction:column;gap:10px';
    form.append(
      el('p', { class: 'muted' }, 'Leave your details and the team will get back to you. Give an email or a phone number.'),
      this.field('Your name', name),
      this.field('Email', email),
      this.field('Phone', phone),
      this.field('How can we help?', need),
      consent.box,
      error,
      submit,
    );
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      submit.disabled = true;
      error.textContent = '';
      const res = await this.post('enquiry', {
        token: this.token,
        name: name.value,
        email: email.value,
        phone: phone.value,
        need: need.value,
        consent: consent.input.checked,
      });
      submit.disabled = false;
      if (!res.ok) {
        error.textContent = res.error;
        return;
      }
      if (this.config!.mode === 'message') {
        this.openSheet('Thank you', el('p', {}, 'Your message has been passed to the team. They’ll get back to you.'));
      } else {
        this.openSheet(null); // the confirmation arrives in the chat
      }
    });
    this.openSheet('Leave a message', form);
  }

  private async showServices(): Promise<void> {
    this.openSheet('Book an appointment', el('p', { class: 'muted' }, 'Loading…'));
    const res = await this.post<{ items: BookingService[] }>('booking/services', { token: this.token });
    if (!res.ok) return this.openSheet('Book an appointment', el('p', { class: 'form-error' }, res.error));
    if (!res.data.items.length) return this.openSheet('Book an appointment', el('p', {}, 'No services can be booked online at the moment.'));
    const list = el('div', { style: 'display:flex;flex-direction:column;gap:8px' });
    for (const svc of res.data.items) {
      const b = el('button', { class: 'option', type: 'button' }, `${svc.name} · ${svc.durationMin} min · ${money.format(svc.pricePence / 100)}`);
      b.addEventListener('click', () => void this.showSlots(svc, todayUk()));
      list.append(b);
    }
    this.openSheet('What would you like to book?', list);
  }

  private async showSlots(svc: BookingService, from: string): Promise<void> {
    this.openSheet(svc.name, el('p', { class: 'muted' }, 'Finding free times…'));
    const to = addDays(from, 6);
    const res = await this.post<Slots>('booking/slots', { token: this.token, serviceId: svc.id, from, to });
    if (!res.ok) return this.openSheet(svc.name, el('p', { class: 'form-error' }, res.error));
    const wrap = el('div');
    const days = res.data.days.filter((d) => d.slots.length);
    if (!days.length) wrap.append(el('p', {}, 'No free times this week.'));
    for (const d of days) {
      wrap.append(el('p', { class: 'day' }, dayLabel(d.date)));
      const row = el('div', { class: 'slots' });
      for (const slot of d.slots) {
        const b = el('button', { class: 'slot', type: 'button', 'aria-label': `${dayLabel(d.date)} at ${slot.localTime}` }, slot.localTime);
        b.addEventListener('click', () => this.showBookingForm(svc, slot.startsAt, `${dayLabel(d.date)} at ${slot.localTime}`));
        row.append(b);
      }
      wrap.append(row);
    }
    const later = el('button', { class: 'chip', type: 'button' }, 'Later dates');
    later.addEventListener('click', () => void this.showSlots(svc, addDays(from, 7)));
    wrap.append(el('p', { class: 'muted', style: 'margin-top:10px' }, 'Times are UK time.'), later);
    this.openSheet(`${svc.name}: choose a time`, wrap);
  }

  private showBookingForm(svc: BookingService, startsAt: string, label: string): void {
    const idempotencyKey = uuid(); // one per attempt: pressing Book twice can't book twice
    const name = el('input', { type: 'text', autocomplete: 'name', maxlength: '100', required: '' }) as HTMLInputElement;
    const email = el('input', { type: 'email', autocomplete: 'email', maxlength: '254', required: '' }) as HTMLInputElement;
    const phone = el('input', { type: 'tel', autocomplete: 'tel', maxlength: '20' }) as HTMLInputElement;
    const consent = this.consentBox();
    const error = el('p', { class: 'form-error', role: 'alert' });
    const submit = el('button', { class: 'primary', type: 'submit' }, 'Book') as HTMLButtonElement;
    const form = el('form');
    form.style.cssText = 'display:flex;flex-direction:column;gap:10px';
    form.append(el('p', {}, `${svc.name}, ${label} (UK time)`), this.field('Your name', name), this.field('Email', email), this.field('Phone (optional)', phone), consent.box, error, submit);
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      submit.disabled = true;
      error.textContent = '';
      const res = await this.post('booking', {
        token: this.token,
        serviceId: svc.id,
        startsAt,
        idempotencyKey,
        name: name.value,
        email: email.value,
        phone: phone.value,
        consent: consent.input.checked,
      });
      submit.disabled = false;
      if (res.ok) return this.openSheet(null); // the confirmation arrives in the chat
      error.textContent = res.error;
      if (res.code === 'SLOT_TAKEN') setTimeout(() => void this.showSlots(svc, todayUk()), 1500);
    });
    this.openSheet('Your details', form);
  }

  private add(m: ChatMessage): HTMLElement {
    const bubble = el('div', { class: `msg ${m.role}` });
    // Staff names, and the label on the demo's replayed sample answers.
    if ((m.role === 'staff' || m.role === 'assistant') && m.authorName) bubble.append(el('span', { class: 'who' }, m.authorName));
    bubble.append(el('span', { class: 'body' }, m.content));
    if (m.sources.length) {
      const list = el('ul', { class: 'sources', 'aria-label': 'Sources' });
      for (const s of m.sources) {
        const li = el('li');
        if (s.url && /^https?:\/\//.test(s.url)) {
          li.append(el('a', { href: s.url, target: '_blank', rel: 'noopener noreferrer' }, s.title));
        } else {
          li.textContent = s.title;
        }
        list.append(li);
      }
      bubble.append(el('span', { class: 'sr' }, 'Sources:'), list);
    }
    this.log.append(bubble);
    this.scrollToEnd();
    return bubble;
  }

  private showError(message: string): void {
    this.errorLine.textContent = message;
    this.errorLine.hidden = false;
  }

  private scrollToEnd(): void {
    this.log.scrollTop = this.log.scrollHeight;
  }
}

if (!customElements.get('frontdesk-chat')) customElements.define('frontdesk-chat', FrontdeskChat);
