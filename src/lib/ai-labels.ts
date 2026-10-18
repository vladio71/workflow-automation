/**
 * Small helpers for displaying Gemini requests, shared by server and browser (no server-only).
 */

/** "gemini-3.5-flash-lite" -> "3.5 Flash Lite" */
export function modelLabel(model: string): string {
  return model
    .replace(/^gemini-/, '')
    .split('-')
    .map((word) => (word.length > 0 ? word.charAt(0).toUpperCase() + word.slice(1) : word))
    .join(' ');
}

/** Request id the browser polls status by. randomUUID exists only on localhost/https, hence the fallback. */
export function newJobId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}
