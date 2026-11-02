import type { ChatMessage, VisitorServerEvents, WidgetConfig, WidgetSession } from '@frontdesk/shared';
import { io, type Socket } from 'socket.io-client';
import { STYLES } from './styles.js';

/**
 * <frontdesk-chat key="fd_pk_…"></frontdesk-chat>
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
}
type VisitorSocket = Socket<VisitorServerEvents, VisitorClientEvents>;

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

  private get key(): string {
    return this.getAttribute('key') ?? '';
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
    style.textContent = STYLES;
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
    titles.append(el('h2', { id: 'fd-title' }, c.name), el('p', {}, 'AI assistant · answers from our own information'));
    const close = el('button', { class: 'close', type: 'button', 'aria-label': 'Close chat' }) as HTMLButtonElement;
    close.innerHTML = ICON_CLOSE; // a constant
    close.addEventListener('click', () => this.toggle(false));
    header.append(titles, close);

    this.log = el('div', { class: 'log', role: 'log', 'aria-live': 'polite', 'aria-label': 'Conversation' });
    this.errorLine = el('p', { class: 'error', role: 'alert' });
    this.errorLine.hidden = true;

    const form = el('form');
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

    const note = el('p', { class: 'note' }, 'Please don’t share sensitive personal details here.');
    this.panel.append(header, this.log, this.errorLine, form, note);
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
      this.input.focus();
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
      s.messages.forEach((m) => this.add(m));
      this.connect(s.token);
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
    this.socket = socket;
  }

  private async send(): Promise<void> {
    const text = this.input.value.trim();
    if (!text || this.busy || !this.socket) return;
    this.busy = true;
    this.sendBtn.disabled = true;
    this.errorLine.hidden = true;
    this.input.value = '';
    const ack = await this.socket
      .timeout(90_000)
      .emitWithAck('message', { text })
      .catch((): AckResult => ({ ok: false, error: 'No answer. Check your connection and try again.' }));
    if (!ack.ok) {
      this.input.value = text;
      this.showError(ack.error ?? 'Your message wasn’t sent.');
    }
    this.busy = false;
    this.sendBtn.disabled = false;
    this.input.focus();
  }

  private add(m: ChatMessage): HTMLElement {
    const bubble = el('div', { class: `msg ${m.role}` });
    if (m.role === 'staff' && m.authorName) bubble.append(el('span', { class: 'who' }, m.authorName));
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
