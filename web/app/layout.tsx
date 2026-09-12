import type { Metadata, Viewport } from 'next';
import './globals.css';
import { Providers } from './providers';

export const metadata: Metadata = {
  title: 'Nexus — Encrypted Messaging',
  description: 'End-to-end encrypted web messaging with ghost chats and video calls',
  manifest: '/manifest.json',
};

export const viewport: Viewport = {
  themeColor: '#14092B',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body className="bg-whatsapp-dark text-white antialiased">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
