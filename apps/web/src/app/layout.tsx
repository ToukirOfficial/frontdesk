import type { Metadata, Viewport } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import './globals.css';
import { cn } from '@/lib/utils';

const geist = Geist({ subsets: ['latin'], variable: '--font-sans' });
const geistMono = Geist_Mono({ subsets: ['latin'], variable: '--font-mono' });

export const metadata: Metadata = {
  title: { default: 'Frontdesk: open-source AI receptionist', template: '%s | Frontdesk' },
  description:
    'A free, self-hosted AI receptionist for small business websites. Answers only from your own information.',
};

export const viewport: Viewport = { themeColor: '#f7f7f5' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-GB" className={cn('font-sans antialiased', geist.variable, geistMono.variable)}>
      <body>{children}</body>
    </html>
  );
}
