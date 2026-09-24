import { Injectable, Logger } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { db } from '../db/index.js';

export type CronLockHandle = { jobKey: string; owner: string };

/**
 * Postgres lease lock: overlapping ticks skip (no queue / no backlog).
 * If the holder dies, lock expires after leaseSeconds.
 */
@Injectable()
export class CronLockService {
  private readonly logger = new Logger(CronLockService.name);

  async tryAcquire(
    jobKey: string,
    leaseSeconds: number,
  ): Promise<CronLockHandle | null> {
    const owner = randomUUID();
    const result = await db.execute(sql`
      INSERT INTO cron_job_lock (job_key, owner, locked_at, locked_until)
      VALUES (
        ${jobKey},
        ${owner},
        NOW(),
        NOW() + (${leaseSeconds}::int * INTERVAL '1 second')
      )
      ON CONFLICT (job_key) DO UPDATE
      SET
        owner = EXCLUDED.owner,
        locked_at = EXCLUDED.locked_at,
        locked_until = EXCLUDED.locked_until
      WHERE cron_job_lock.locked_until < NOW()
      RETURNING job_key
    `);

    const rows = result as unknown as Array<{ job_key: string }>;
    if (!rows?.length) {
      this.logger.warn(`cron lock busy, skip job=${jobKey}`);
      return null;
    }
    return { jobKey, owner };
  }

  async release(handle: CronLockHandle): Promise<void> {
    await db.execute(sql`
      UPDATE cron_job_lock
      SET locked_until = NOW()
      WHERE job_key = ${handle.jobKey}
        AND owner = ${handle.owner}
    `);
  }
}
