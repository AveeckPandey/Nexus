import type { Metadata, Viewport } from 'next';
import './globals.css';
import { Providers } from './providers';

export const metadata: Metadata = {
  title: 'Nexus — Encrypted Messaging',
  description: 'End-to-end encrypted web messaging with ghost chats and video calls',
  manifest: '/manifest.json',
};

export const viewport: Viewport = {
  themeColor: '#E0E5EC',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="bg-[#E0E5EC] text-[#2F343D] antialiased">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
