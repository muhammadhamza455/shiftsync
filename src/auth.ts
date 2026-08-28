import NextAuth from 'next-auth';
import Credentials from 'next-auth/providers/credentials';
import { compare } from 'bcryptjs';
import { z } from 'zod';
import { db } from '@/lib/db';
import { authConfig } from '@/auth.config';

const credentialsSchema = z.object({
  email: z.email().transform((value) => value.trim().toLowerCase()),
  password: z.string().min(1),
});

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  providers: [
    Credentials({
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' },
      },
      async authorize(raw) {
        const parsed = credentialsSchema.safeParse(raw);
        if (!parsed.success) return null;

        const user = await db.user.findUnique({
          where: { email: parsed.data.email },
          select: {
            id: true,
            email: true,
            name: true,
            role: true,
            timezone: true,
            passwordHash: true,
            isActive: true,
          },
        });

        if (!user || !user.isActive) return null;

        const valid = await compare(parsed.data.password, user.passwordHash);
        if (!valid) return null;

        return {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
          timezone: user.timezone,
        };
      },
    }),
  ],
});
