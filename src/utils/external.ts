import { invoke } from '@tauri-apps/api/core';

// ============================================================================
// Opening a link from a note
//
// The webview must never navigate. It IS the app — following a link inside it would
// replace the calendar with a web page, and there is no chrome to come back from. So
// links are handed to the operating system and the window stays exactly where it is.
//
// Vetted in Rust rather than here, and that is the important part: this file runs in
// the webview and could in principle be bypassed, so it is a convenience, not a
// boundary. The allowlist that matters lives in `vet` in src-tauri/src/lib.rs.
// ============================================================================

/**
 * Open an http/https link in the default browser.
 *
 * Resolves to an error MESSAGE rather than throwing, because every caller is a click
 * handler and an unhandled rejection in one of those is invisible. A link that cannot
 * be opened should say so on the toast.
 *
 * Outside Tauri — the browser dev server — `invoke` is unavailable, and this reports
 * that plainly instead of failing in a way that looks like the link was bad.
 */
export async function openExternal(url: string): Promise<string | null> {
  try {
    await invoke('open_external', { url });
    return null;
  } catch (e) {
    return typeof e === 'string' ? e : 'That link could not be opened.';
  }
}
