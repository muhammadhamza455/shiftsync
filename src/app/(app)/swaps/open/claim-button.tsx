'use client';

import { useTransition } from 'react';
import { HandHeart } from 'lucide-react';
import { claimDropAction } from '../actions';
import { Button } from '@/components/ui';
import { useRealtime } from '@/components/realtime-provider';

export function ClaimButton({ requestId }: { requestId: string }) {
  const { pushToast } = useRealtime();
  const [pending, startTransition] = useTransition();

  return (
    <Button
      variant="primary"
      size="sm"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          const res = await claimDropAction(requestId);
          pushToast(
            res.ok
              ? {
                  title: 'Shift claimed',
                  body: 'Your manager has been asked to approve it.',
                  tone: 'success',
                }
              : { title: res.message ?? 'Could not claim it', tone: 'error' },
          );
        })
      }
    >
      <HandHeart className="size-3.5" />
      {pending ? 'Claiming…' : 'Pick it up'}
    </Button>
  );
}
