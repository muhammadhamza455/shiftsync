import type { Role } from '@/generated/prisma/enums';
import type { DefaultSession } from 'next-auth';

declare module 'next-auth' {
  interface Session {
    user: {
      id: string;
      role: Role;
      timezone: string;
    } & DefaultSession['user'];
  }

  interface User {
    role: Role;
    timezone: string;
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    id: string;
    role: Role;
    timezone: string;
  }
}
