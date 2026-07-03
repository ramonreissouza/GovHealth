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
        // Apara espaços/quebras acidentais (teclado mobile, autofill, colar) — as
        // senhas das contas não têm espaço nas bordas, então isso só ajuda.
        const senha = credentials?.password?.trim()
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

        // expira_em já vem como 'YYYY-MM-DD' (parser de DATE em lib/db).
        const expiraEm = user.expira_em ? String(user.expira_em).slice(0, 10) : null

        return {
          id: user.id, name: user.nome, email: user.email, image: null, role: user.role,
          plano: user.plano, status: user.status_assinatura, expiraEm,
        }
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
        const u = user as { id?: string; role?: string; plano?: string | null; status?: string | null; expiraEm?: string | null }
        token.id = u.id
        token.role = u.role ?? 'user'
        token.plano = u.plano ?? null
        token.status = u.status ?? null
        token.expiraEm = u.expiraEm ?? null
      }
      return token
    },
    async session({ session, token }) {
      if (session.user) {
        const u = session.user as typeof session.user & { id?: string; role?: string; plano?: string | null; status?: string | null; expiraEm?: string | null }
        u.id = token.id as string
        u.role = (token.role as string) ?? 'user'
        u.plano = (token.plano as string | null) ?? null
        u.status = (token.status as string | null) ?? null
        u.expiraEm = (token.expiraEm as string | null) ?? null
      }
      return session
    },
  },

  secret: process.env.NEXTAUTH_SECRET,
}
