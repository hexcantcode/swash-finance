import { closeDb } from '../db.js';
import { hl } from '../hl.js';

async function main() {
  // Per-dex meta — fetch each HIP-3 dex's perp universe and see if # is in it.
  const dexResp = await hl().perpDexs();
  console.log('dexes:', dexResp.data.map((d: any) => d?.name).filter(Boolean));
  for (const d of dexResp.data) {
    if (!d?.name) continue;
    try {
      const m: any = await (hl() as any).client.meta({ dex: d.name });
      const names = (m?.universe ?? []).map((u: any) => u.name);
      console.log(`dex=${d.name} universe count=${names.length} sample:`, names.slice(0, 5));
      const hashy = names.filter((n: string) => n.startsWith('#') || /^[0-9]/.test(n));
      if (hashy.length > 0) console.log(`  hash/numeric names:`, hashy.slice(0, 10));
    } catch (e: any) {
      console.log(`dex=${d.name} ERROR:`, e?.message);
    }
  }
  await closeDb();
}
main().catch((e) => { console.error(e); process.exit(1); });
