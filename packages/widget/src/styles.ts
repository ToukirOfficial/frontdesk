export const STYLES = `
:host { all: initial; --fd-brand: #0f766e; --fd-ink: #16191c; --fd-muted: #5b6168; --fd-line: #e2e2dd; --fd-bg: #ffffff; --fd-soft: #f4f4f1;
  font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; font-size: 15px; line-height: 1.45; color: var(--fd-ink); }
/* The host page's styles beat :host, and inherited properties (letter-spacing, fonts…) cross the shadow boundary,
   so every element in here resets them. */
*, *::before, *::after { box-sizing: border-box; font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  letter-spacing: normal; word-spacing: normal; text-transform: none; text-indent: 0; text-shadow: none; font-style: normal;
  font-variant: normal; text-decoration: none; }
.panel, .launcher { font-size: 15px; line-height: 1.45; color: var(--fd-ink); text-align: left; }
a { text-decoration: underline; }
.sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
button, textarea, input { font: inherit; color: inherit; }
:focus-visible { outline: 3px solid var(--fd-brand); outline-offset: 2px; }
.launcher { position: fixed; bottom: 20px; z-index: 2147483000; width: 60px; height: 60px; border-radius: 50%; border: 0; cursor: pointer;
  background: var(--fd-brand); color: #fff; box-shadow: 0 6px 24px rgba(0,0,0,.18); display: grid; place-items: center; }
.launcher svg { width: 28px; height: 28px; }
.right { right: 20px; } .left { left: 20px; }
.panel { position: fixed; bottom: 92px; z-index: 2147483001; width: 380px; max-width: calc(100vw - 32px); height: 600px; max-height: calc(100vh - 120px);
  background: var(--fd-bg); border-radius: 16px; box-shadow: 0 12px 48px rgba(0,0,0,.22); display: flex; flex-direction: column; overflow: hidden; }
.panel[hidden] { display: none; }
header { display: flex; align-items: center; gap: 10px; padding: 14px 14px 14px 16px; background: var(--fd-brand); color: #fff; }
header img, .badge { width: 34px; height: 34px; border-radius: 50%; object-fit: cover; background: rgba(255,255,255,.2); flex: none;
  display: grid; place-items: center; font-weight: 600; }
header h2 { margin: 0; font-size: 16px; font-weight: 600; flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
header p { margin: 0; font-size: 12px; opacity: .9; }
.close { border: 0; background: transparent; color: #fff; width: 36px; height: 36px; border-radius: 8px; cursor: pointer; display: grid; place-items: center; }
.close:hover { background: rgba(255,255,255,.15); }
.log { flex: 1; overflow-y: auto; padding: 16px; display: flex; flex-direction: column; gap: 10px; background: var(--fd-soft); }
.msg { max-width: 85%; padding: 9px 12px; border-radius: 14px; white-space: pre-wrap; overflow-wrap: anywhere; }
.msg.visitor { align-self: flex-end; background: var(--fd-brand); color: #fff; border-bottom-right-radius: 4px; }
.msg.assistant, .msg.staff { align-self: flex-start; background: var(--fd-bg); border: 1px solid var(--fd-line); border-bottom-left-radius: 4px; }
.msg.system { align-self: center; background: transparent; color: var(--fd-muted); font-size: 13px; text-align: center; }
.who { display: block; font-size: 12px; color: var(--fd-muted); margin-bottom: 2px; }
.sources { margin: 6px 0 0; padding: 6px 0 0; border-top: 1px solid var(--fd-line); font-size: 12px; color: var(--fd-muted); list-style: none; }
.sources a { color: inherit; }
.typing::after { content: "…"; animation: blink 1s infinite; }
@keyframes blink { 50% { opacity: .2; } }
.error { color: #b42318; font-size: 13px; padding: 0 16px 6px; background: var(--fd-soft); }
form { display: flex; gap: 8px; padding: 10px; border-top: 1px solid var(--fd-line); background: var(--fd-bg); }
textarea { flex: 1; resize: none; border: 1px solid var(--fd-line); border-radius: 10px; padding: 9px 10px; min-height: 42px; max-height: 120px; background: #fff; }
.send { border: 0; border-radius: 10px; background: var(--fd-brand); color: #fff; padding: 0 14px; cursor: pointer; font-weight: 600; }
.send:disabled { opacity: .5; cursor: default; }
.note { margin: 0; padding: 0 12px 8px; font-size: 11px; color: var(--fd-muted); background: var(--fd-bg); }
@media (max-width: 480px) {
  .panel { inset: 0; width: 100%; max-width: none; height: 100%; max-height: none; border-radius: 0; bottom: 0; }
}
@media (prefers-reduced-motion: reduce) { .typing::after { animation: none; } }
`;
export const MORE_STYLES = `
.actions { display: flex; gap: 6px; flex-wrap: wrap; padding: 8px 10px 0; background: var(--fd-bg); border-top: 1px solid var(--fd-line); }
.chip { border: 1px solid var(--fd-line); background: var(--fd-bg); border-radius: 999px; padding: 5px 11px; font-size: 13px; cursor: pointer; }
.chip:hover { border-color: var(--fd-brand); }
.sheet { flex: 1; overflow-y: auto; padding: 16px; display: flex; flex-direction: column; gap: 12px; background: var(--fd-bg); }
.sheet[hidden], .log[hidden], form.chat[hidden], .actions[hidden] { display: none; }
.sheet h3 { margin: 0; font-size: 16px; }
.back { align-self: flex-start; border: 0; background: transparent; color: var(--fd-brand); cursor: pointer; padding: 0; font-weight: 600; }
.field { display: flex; flex-direction: column; gap: 4px; font-size: 14px; }
.field input, .field textarea { border: 1px solid var(--fd-line); border-radius: 8px; padding: 8px 10px; background: #fff; }
.check { display: flex; gap: 8px; align-items: flex-start; font-size: 13px; color: var(--fd-muted); }
.check input { margin-top: 3px; }
.primary { border: 0; border-radius: 10px; background: var(--fd-brand); color: #fff; padding: 10px 14px; cursor: pointer; font-weight: 600; }
.primary:disabled { opacity: .5; }
.option { display: block; width: 100%; text-align: left; border: 1px solid var(--fd-line); background: var(--fd-bg); border-radius: 10px; padding: 10px 12px; cursor: pointer; }
.option:hover { border-color: var(--fd-brand); }
.slots { display: flex; flex-wrap: wrap; gap: 6px; }
.slot { border: 1px solid var(--fd-line); background: var(--fd-bg); border-radius: 8px; padding: 6px 10px; cursor: pointer; }
.slot:hover { border-color: var(--fd-brand); }
.day { margin: 6px 0 4px; font-size: 13px; font-weight: 600; }
.muted { color: var(--fd-muted); font-size: 13px; margin: 0; }
.form-error { color: #b42318; font-size: 13px; margin: 0; }
.banner { margin: 0; padding: 8px 14px; font-size: 13px; line-height: 1.4; border-bottom: 1px solid var(--fd-line, #e5e7eb); background: #f8fafc; display: flex; flex-wrap: wrap; gap: 4px 10px; align-items: center; }
.banner[hidden], .suggest[hidden] { display: none; }
.banner strong { font-weight: 600; }
.linkish { background: none; border: 0; padding: 0; font: inherit; color: var(--fd-brand); text-decoration: underline; cursor: pointer; }
.suggest { display: flex; flex-wrap: wrap; gap: 6px; padding: 8px 12px 0; }
.suggest .chip { text-align: left; }
/* After the first question: one row that scrolls sideways, so the answer keeps the space. */
.suggest.compact { flex-wrap: nowrap; overflow-x: auto; padding-bottom: 6px; scrollbar-width: thin; }
.suggest.compact .chip { flex: 0 0 auto; white-space: nowrap; }
.field select { font: inherit; padding: 8px; border: 1px solid #d0d5dd; border-radius: 8px; background: #fff; }
`;
