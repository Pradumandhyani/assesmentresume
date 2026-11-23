import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { QueryProvider } from '@/providers/query-provider';
import '@/styles/globals.css';
export const metadata: Metadata = {
  title: { default: 'RedResume Assessment', template: '%s | RedResume Assessment' },
  description:
    'Take coding assessments, show your skills, and track your progress with RedResumes.',
  icons: { icon: '/favicon.svg', apple: '/favicon.svg' },
};
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <QueryProvider>{children}</QueryProvider>
      </body>
    </html>
  );
}
