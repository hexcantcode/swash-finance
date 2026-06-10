/*
 * App-level bottom-sheet state. Sheets render once in +layout.svelte
 * (MobileAppSheets) and any component can open them — cards can't host the
 * sheet themselves because their backdrop-filter creates a containing block
 * that would trap a position:fixed overlay.
 */

export type AppSheet = 'score' | 'mirror';

const state = $state<{ active: AppSheet | null }>({ active: null });

export const appSheet = {
  get active(): AppSheet | null {
    return state.active;
  },
  open(sheet: AppSheet): void {
    state.active = sheet;
  },
  close(): void {
    state.active = null;
  },
};
