import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import './globals.css';

export const metadata: Metadata = {
  title: 'Assistant de veille GRC',
  description:
    'Chat en langage naturel sur les exigences, risques, échéances et lots d’action de la veille réglementaire.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="fr">
      <body>{children}</body>
    </html>
  );
}
