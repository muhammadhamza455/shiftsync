'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { db } from '@/lib/db';
import { requireViewer } from '@/lib/auth/session';

const schema = z.object({
  emailSimulation: z.boolean(),
  mutedTypes: z.record(z.string(), z.boolean()),
});

export async function saveNotificationPreferencesAction(
  raw: unknown,
): Promise<{ ok: boolean; message?: string }> {
  try {
    const viewer = await requireViewer();
    const input = schema.parse(raw);

    await db.notificationPreference.upsert({
      where: { userId: viewer.id },
      create: {
        userId: viewer.id,
        emailSimulation: input.emailSimulation,
        mutedTypes: input.mutedTypes,
      },
      update: {
        emailSimulation: input.emailSimulation,
        mutedTypes: input.mutedTypes,
      },
    });

    revalidatePath('/settings');
    return { ok: true };
  } catch (error) {
    if (error instanceof z.ZodError) {
      return { ok: false, message: 'Those settings are not valid.' };
    }
    console.error('[settings]', error);
    return { ok: false, message: 'Could not save your preferences.' };
  }
}
