import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { QueryProvider } from '@/components/providers/query-provider';
import './globals.css';
export const metadata: Metadata = {
  title: { default: 'Assessment Console', template: '%s | Assessment Console' },
  description: 'Manage assessments, students, and immutable coding questions.',
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
