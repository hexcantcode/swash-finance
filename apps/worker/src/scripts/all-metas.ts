import { closeDb } from '../db.js';
import { hl } from '../hl.js';

async function main() {
  const c: any = (hl() as any).client;
  try {
    const m: any = await c.allPerpMetas();
    console.log('allPerpMetas count:', m.length);
    let allNames: string[] = [];
    for (const dexMeta of m) {
      const names = (dexMeta?.universe ?? []).map((u: any) => u.name);
      allNames = allNames.concat(names);
    }
    const hashy = allNames.filter((n: string) => n.startsWith('#'));
    console.log('# coins across all perp metas:', hashy.slice(0, 20));
    // Try to look up #250 specifically
    for (const dexMeta of m) {
      const u = (dexMeta?.universe ?? []) as any[];
      const found = u.find((x: any) => x.name === '#250');
      if (found) {
        console.log('FOUND #250 in dex meta:', dexMeta.dex ?? '(main)', found);
      }
    }
  } catch (e: any) {
    console.log('allPerpMetas FAILED:', e?.message);
  }
  
  // Also check spotMeta - maybe #N is part of it too
  const sm = await hl().spotMeta();
  const universe = sm.data.universe;
  const tokens = sm.data.tokens;
  const hashUniverse = universe.filter((u: any) => u.name.startsWith('#'));
  console.log('# in spotMeta universe:', hashUniverse.slice(0, 10));
  // Tokens with # prefix
  const hashTok = tokens.filter((t: any) => t.name && t.name.startsWith('#'));
  console.log('# in spotMeta tokens:', hashTok.slice(0, 5));
  await closeDb();
}
main().catch((e) => { console.error(e); process.exit(1); });
