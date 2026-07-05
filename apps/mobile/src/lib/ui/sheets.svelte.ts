/*
 * App-level bottom-sheet state. Sheets render once in +layout.svelte
 * (MobileAppSheets) and any component can open them — cards can't host the
 * sheet themselves because their backdrop-filter creates a containing block
 * that would trap a position:fixed overlay.
 */

import type { TraitKey } from '@copytrade/shared';

export type AppSheet = 'score' | 'mirror' | 'trait' | 'trade';

export interface TradeContext {
  coin: string;
  /** live mark price at open time — the ticket's reference entry. */
  price: number;
}

const state = $state<{ active: AppSheet | null; trait: TraitKey | null; trade: TradeContext | null }>({
  active: null,
  trait: null,
  trade: null,
});

export const appSheet = {
  get active(): AppSheet | null {
    return state.active;
  },
  get trait(): TraitKey | null {
    return state.trait;
  },
  get trade(): TradeContext | null {
    return state.trade;
  },
  open(sheet: Exclude<AppSheet, 'trait' | 'trade'>): void {
    state.active = sheet;
    state.trait = null;
  },
  /** Open the explainer for one trader trait (archetype / size / heat / market). */
  openTrait(trait: TraitKey): void {
    state.active = 'trait';
    state.trait = trait;
  },
  /** Open the trade ticket for one market (asset pages). */
  openTrade(trade: TradeContext): void {
    state.active = 'trade';
    state.trade = trade;
  },
  close(): void {
    state.active = null;
    state.trait = null;
    state.trade = null;
  },
};
