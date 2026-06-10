/*
 * App-level bottom-sheet state. Sheets render once in +layout.svelte
 * (MobileAppSheets) and any component can open them — cards can't host the
 * sheet themselves because their backdrop-filter creates a containing block
 * that would trap a position:fixed overlay.
 */

import type { TraitKey } from '@copytrade/shared';

export type AppSheet = 'score' | 'mirror' | 'trait';

const state = $state<{ active: AppSheet | null; trait: TraitKey | null }>({
  active: null,
  trait: null,
});

export const appSheet = {
  get active(): AppSheet | null {
    return state.active;
  },
  get trait(): TraitKey | null {
    return state.trait;
  },
  open(sheet: Exclude<AppSheet, 'trait'>): void {
    state.active = sheet;
    state.trait = null;
  },
  /** Open the explainer for one trader trait (archetype / size / heat / market). */
  openTrait(trait: TraitKey): void {
    state.active = 'trait';
    state.trait = trait;
  },
  close(): void {
    state.active = null;
    state.trait = null;
  },
};
