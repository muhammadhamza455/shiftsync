import type { NextAuthConfig } from 'next-auth';
import type { Role } from '@/generated/prisma/enums';

export const PUBLIC_ROUTES = ['/login', '/api/auth'];

export const authConfig = {
  pages: {
    signIn: '/login',
  },
  session: {
    strategy: 'jwt',
    maxAge: 60 * 60 * 24 * 7,
  },
  trustHost: true,
  callbacks: {
    jwt({ token, user }) {
      if (user) {
        token.id = user.id as string;
        token.role = (user as { role: Role }).role;
        token.timezone = (user as { timezone: string }).timezone;
      }
      return token;
    },
    session({ session, token }) {
      if (session.user) {
        session.user.id = token.id as string;
        session.user.role = token.role as Role;
        session.user.timezone = token.timezone as string;
      }
      return session;
    },
    authorized({ auth, request }) {
      const isLoggedIn = Boolean(auth?.user);
      const { pathname } = request.nextUrl;
      if (PUBLIC_ROUTES.some((route) => pathname.startsWith(route))) {
        return true;
      }
      return isLoggedIn;
    },
  },
  providers: [],
} satisfies NextAuthConfig;
