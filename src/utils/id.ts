// Single source of unique IDs. crypto.randomUUID is available in the Tauri
// webview (and all modern browsers); collision-free, unlike Math.random slices.
export function uid(): string {
  return crypto.randomUUID();
}
