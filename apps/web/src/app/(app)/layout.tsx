import { MeProvider } from '@/components/session';
import { Toaster } from '@/components/ui/sonner';

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <MeProvider>
      {children}
      <Toaster position="top-center" />
    </MeProvider>
  );
}
