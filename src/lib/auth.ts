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
        // Contas aceitas no login por credenciais. A conta "demo" pode ser
        // sobrescrita por env vars; a conta de teste é fixa no código para
        // garantir um acesso conhecido em qualquer ambiente (local e Vercel),
        // sem depender de configurar variáveis no painel da Vercel.
        const contas = [
          {
            email: process.env.AUTH_DEMO_EMAIL ?? 'demo@govhealth.ai',
            password: process.env.AUTH_DEMO_PASSWORD ?? 'demo123',
            name: 'Demo User',
          },
          { email: 'teste@govhealth.ai', password: 'Teste@2026', name: 'Usuário de Teste' },
        ]

        const conta = contas.find(
          (c) => c.email === credentials?.email && c.password === credentials?.password,
        )
        if (conta) {
          return { id: conta.email, name: conta.name, email: conta.email, image: null }
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
