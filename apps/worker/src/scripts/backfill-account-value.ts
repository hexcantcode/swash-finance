import { eq, isNull, and, isNotNull, inArray } from 'drizzle-orm';
import { wallets } from '@copytrade/db';
import { db, closeDb } from '../db.js';
import { hl } from '../hl.js';
import { log } from '../log.js';

/** One-off: pull clearinghouseState for scored wallets missing account_value and set it. */
async function main(): Promise<void> {
  const rows = await db()
    .select({ address: wallets.address })
    .from(wallets)
    .where(and(isNotNull(wallets.score), isNull(wallets.accountValue)));
  log.info({ count: rows.length }, 'backfill-account-value.start');
  let ok = 0, fail = 0;
  for (const r of rows) {
    try {
      const st = await hl().clearinghouseState(r.address);
      const av = st.data?.marginSummary?.accountValue;
      if (av != null) {
        await db().update(wallets).set({ accountValue: String(av), updatedAt: new Date() }).where(eq(wallets.address, r.address));
        ok += 1;
      } else fail += 1;
    } catch (err) {
      fail += 1;
      log.warn({ address: r.address, err: err instanceof Error ? err.message : String(err) }, 'backfill.fail');
    }
  }
  log.info({ ok, fail }, 'backfill-account-value.done');
}
void inArray;
main().catch((e) => { log.error({ err: e instanceof Error ? e.stack : e }, 'fatal'); process.exitCode = 1; }).finally(closeDb);
