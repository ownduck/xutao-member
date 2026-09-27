import { config } from 'dotenv';
import postgres from 'postgres';

config({ path: '.env' });

const sql = postgres(process.env.DATABASE_URL!);

async function main() {
  await sql`
    ALTER TABLE goods_order
    ADD COLUMN IF NOT EXISTS cancel_status integer NOT NULL DEFAULT 0
  `;
  console.log('goods_order.cancel_status-ok');
  await sql.end();
}

main().catch(async (err) => {
  console.error(err);
  await sql.end();
  process.exit(1);
});
