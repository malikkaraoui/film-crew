import type { Metadata } from 'next'
import { Geist } from 'next/font/google'
import './globals.css'
import { Topbar } from '@/components/layout/topbar'
import { Sidebar } from '@/components/layout/sidebar'
import { RecoveryBanner } from '@/components/layout/recovery-banner'

const geist = Geist({
  variable: '--font-geist',
  subsets: ['latin'],
})

export const metadata: Metadata = {
  title: 'FILM-CREW',
  description: 'Pipeline de production vidéo courte IA',
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="fr" className={`${geist.variable} h-full antialiased`}>
      <body className="flex h-full flex-col bg-background text-foreground">
        <Topbar />
        <RecoveryBanner />
        <div className="flex flex-1 overflow-hidden">
          <Sidebar />
          <main className="flex-1 overflow-y-auto p-4">
            {children}
          </main>
        </div>
      </body>
    </html>
  )
}
