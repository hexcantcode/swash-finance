import { closeDb } from '../db.js';
import { hl } from '../hl.js';

async function main() {
  const m = await hl().meta();
  const names: string[] = (m.data.universe ?? []).map((u: any) => u.name);
  console.log('main perp universe count:', names.length);
  // numeric-only-name perps
  const numeric = names.filter((n) => /^[0-9]+$/.test(n));
  console.log('numeric-named perps:', numeric);
  // hash-prefixed?
  const hashy = names.filter((n) => n.startsWith('#'));
  console.log('# perps:', hashy);
  // any starting with non-letter
  const oddly = names.filter((n) => !/^[A-Za-z]/.test(n));
  console.log('non-letter-starting perp names:', oddly);
  // see entries 240-260 to see what's near index 250
  console.log('universe[245..255] names:');
  for (let i = 245; i < 255 && i < names.length; i++) {
    console.log(`  [${i}] ${names[i]}`);
  }
  await closeDb();
}
main().catch((e) => { console.error(e); process.exit(1); });
