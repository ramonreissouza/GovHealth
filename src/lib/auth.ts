// src/lib/auth.ts
import type { NextAuthOptions } from 'next-auth'
import GoogleProvider from 'next-auth/providers/google'
import CredentialsProvider from 'next-auth/providers/credentials'
import { verificarLogin } from '@/lib/users'
import { registrarAcesso, extrairGeo } from '@/lib/acessos'

export const authOptions: NextAuthOptions = {
  providers: [
    ...(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET
      ? [GoogleProvider({ clientId: process.env.GOOGLE_CLIENT_ID, clientSecret: process.env.GOOGLE_CLIENT_SECRET })]
      : []),
    CredentialsProvider({
      name: 'Email',
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Senha', type: 'password' },
      },
      // Autoriza pela tabela `usuarios` (bcrypt). Conta suspensa/excluída é negada.
      // Registra o acesso (com geo dos headers) — best-effort, não bloqueia o login.
      async authorize(credentials, req) {
        const email = credentials?.email?.trim().toLowerCase()
        const senha = credentials?.password
        if (!email || !senha) return null

        const { user } = await verificarLogin(email, senha)
        if (!user) return null

        try {
          const headers = (req?.headers ?? {}) as Record<string, string | undefined>
          const geo = extrairGeo((n) => headers[n])
          await registrarAcesso({ userId: user.id, nome: user.nome, email: user.email, evento: 'login', geo })
        } catch (e) {
          console.warn('[auth] falha ao registrar acesso:', e)
        }

        return { id: user.id, name: user.nome, email: user.email, image: null, role: user.role }
      },
    }),
  ],

  // Sessão de 7 dias para usuários; a sessão do MASTER é validada com frescor mais
  // curto (8h) no guard do admin (lib/admin-guard) — evita sessão admin longeva.
  session: { strategy: 'jwt', maxAge: 60 * 60 * 24 * 7 },

  pages: { signIn: '/login' },

  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = (user as { id?: string }).id
        token.role = (user as { role?: string }).role ?? 'user'
      }
      return token
    },
    async session({ session, token }) {
      if (session.user) {
        const u = session.user as typeof session.user & { id?: string; role?: string }
        u.id = token.id as string
        u.role = (token.role as string) ?? 'user'
      }
      return session
    },
  },

  secret: process.env.NEXTAUTH_SECRET,
}
