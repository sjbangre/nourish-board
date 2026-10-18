import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = { title: 'Nourish Board · A stronger family', description: 'Your family’s private nutrition and fitness dashboard.' };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) { return <html lang="en" style={{ colorScheme: 'dark' }}><body>{children}</body></html>; }
