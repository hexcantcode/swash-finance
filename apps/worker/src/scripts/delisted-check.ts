import { closeDb } from '../db.js';
import { hl } from '../hl.js';

async function main() {
  const m: any = await hl().meta();
  const universe = m.data.universe;
  console.log('main universe size:', universe.length);
  // Show entries with isDelisted true
  const delisted = universe
    .map((u: any, i: number) => ({ i, name: u.name, isDelisted: u.isDelisted }))
    .filter((x: any) => x.isDelisted);
  console.log('delisted in main:', delisted.length);
  for (const d of delisted.slice(0, 10)) console.log(' ', d);
  // For each HIP-3 dex check delisted
  const dexResp = await hl().perpDexs();
  for (const d of dexResp.data) {
    if (!d?.name) continue;
    const meta: any = await (hl() as any).client.meta({ dex: d.name });
    const u = meta.universe ?? [];
    const dl = u.map((x: any, i: number) => ({ i, name: x.name, isDelisted: x.isDelisted })).filter((x: any) => x.isDelisted);
    console.log(`dex=${d.name} delisted: ${dl.length}/${u.length}`, dl.slice(0, 3));
  }
  await closeDb();
}
main().catch((e) => { console.error(e); process.exit(1); });
