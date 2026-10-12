import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { QueryProvider } from '@/providers/query-provider';
import '@/styles/globals.css';
export const metadata: Metadata = {
  title: { default: 'CodeBench · Student assessments', template: '%s · CodeBench' },
  description: 'Your space to prepare, take coding assessments and track your progress.',
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
