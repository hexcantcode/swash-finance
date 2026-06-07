import { closeDb } from '../db.js';
import { hl } from '../hl.js';

async function main() {
  const sm = await hl().spotMeta();
  const universe = sm.data.universe;
  const tokens = sm.data.tokens;
  // Find by name
  for (const target of ['@107', '@228', '@235', '@234', '@151']) {
    const u = universe.find((x: any) => x.name === target);
    if (!u) { console.log(target, '→ NOT FOUND'); continue; }
    const baseIdx = (u as any).tokens[0];
    const quoteIdx = (u as any).tokens[1];
    const base = tokens[baseIdx];
    const quote = tokens[quoteIdx];
    console.log(target, '→', `${base?.name ?? '?'}/${quote?.name ?? '?'}`);
  }
  await closeDb();
}
main().catch((e) => { console.error(e); process.exit(1); });
