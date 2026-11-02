import type { DetailedHTMLProps, HTMLAttributes } from 'react';

declare module 'react' {
  namespace JSX {
    interface IntrinsicElements {
      'frontdesk-chat': DetailedHTMLProps<HTMLAttributes<HTMLElement>, HTMLElement> & { api?: string };
    }
  }
}
