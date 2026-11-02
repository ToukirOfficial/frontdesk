// Serves the built widget at /widget.js. The widget package builds first (turbo ^build).
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';

const from = new URL('../../../packages/widget/dist/widget.js', import.meta.url);
const to = new URL('../public/widget.js', import.meta.url);
if (!existsSync(from)) {
  console.warn('widget.js not built yet: run `pnpm --filter @frontdesk/widget build`');
} else {
  mkdirSync(new URL('../public/', import.meta.url), { recursive: true });
  copyFileSync(from, to);
}
