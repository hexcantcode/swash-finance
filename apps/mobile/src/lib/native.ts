import { Capacitor } from '@capacitor/core';
import { StatusBar, Style } from '@capacitor/status-bar';

/** True when running inside the Capacitor native shell (vs browser/PWA). */
export const isNative = Capacitor.isNativePlatform();

/**
 * Native-only chrome setup. No-op on web/PWA, so it's safe to call
 * unconditionally at app start. Keeps the dark status bar matching the app's
 * navy theme — a small genuine native touch (also helps clear App Store
 * guideline 4.2's "more than a repackaged website" bar as we add more).
 */
export async function initNative(): Promise<void> {
  if (!isNative) return;
  try {
    await StatusBar.setStyle({ style: Style.Dark });
  } catch {
    /* status bar API unavailable on this surface — ignore */
  }
}
