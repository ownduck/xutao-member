import { config } from 'dotenv';
import postgres from 'postgres';

config({ path: '.env' });

const sql = postgres(process.env.DATABASE_URL!);

async function main() {
  await sql`
    CREATE TABLE IF NOT EXISTS cron_job_lock (
      job_key text PRIMARY KEY,
      owner text NOT NULL,
      locked_at timestamptz NOT NULL,
      locked_until timestamptz NOT NULL
    )
  `;
  console.log('cron_job_lock-ok');
  await sql.end();
}

main().catch(async (err) => {
  console.error(err);
  await sql.end();
  process.exit(1);
});
