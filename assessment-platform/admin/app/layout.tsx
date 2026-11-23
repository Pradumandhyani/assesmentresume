import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { QueryProvider } from '@/components/providers/query-provider';
import './globals.css';
export const metadata: Metadata = {
  title: { default: 'RedResume Assessment · Admin', template: '%s | RedResume Assessment' },
  description:
    'The RedResumes workspace for managing assessments, students, questions, and results.',
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
