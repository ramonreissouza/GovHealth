// src/lib/auth.ts
import type { NextAuthOptions } from 'next-auth'
import GoogleProvider from 'next-auth/providers/google'
import CredentialsProvider from 'next-auth/providers/credentials'

export const authOptions: NextAuthOptions = {
  providers: [
    ...(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET
      ? [
          GoogleProvider({
            clientId: process.env.GOOGLE_CLIENT_ID,
            clientSecret: process.env.GOOGLE_CLIENT_SECRET,
          }),
        ]
      : []),
    CredentialsProvider({
      name: 'Email',
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Senha', type: 'password' },
      },
      async authorize(credentials) {
        const demoEmail = process.env.AUTH_DEMO_EMAIL ?? 'demo@govhealth.ai'
        const demoPassword = process.env.AUTH_DEMO_PASSWORD ?? 'demo123'

        if (
          credentials?.email === demoEmail &&
          credentials?.password === demoPassword
        ) {
          return {
            id: '1',
            name: 'Demo User',
            email: demoEmail,
            image: null,
          }
        }
        return null
      },
    }),
  ],

  session: { strategy: 'jwt' },

  pages: { signIn: '/login' },

  callbacks: {
    async jwt({ token, user }) {
      if (user) token.id = user.id
      return token
    },
    async session({ session, token }) {
      if (session.user) {
        (session.user as typeof session.user & { id: string }).id = token.id as string
      }
      return session
    },
  },

  secret: process.env.NEXTAUTH_SECRET,
}
