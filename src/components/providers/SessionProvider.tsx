'use client'
// src/components/providers/SessionProvider.tsx
import { SessionProvider as NextAuthSessionProvider } from 'next-auth/react'
import UserDataSync from './UserDataSync'
import SessionHeartbeat from './SessionHeartbeat'

export default function SessionProvider({ children }: { children: React.ReactNode }) {
  return (
    <NextAuthSessionProvider>
      {children}
      <UserDataSync />
      <SessionHeartbeat />
    </NextAuthSessionProvider>
  )
}
