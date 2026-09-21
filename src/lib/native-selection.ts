const NATIVE_SELECTION_SELECTOR =
  'input, textarea, [contenteditable=""], [contenteditable="true"], [data-allow-copy="true"]';

/**
 * Text entry and deliberately copyable values retain the browser's native
 * selection menu. Everything else is presentation-only app chrome.
 */
export function allowsNativeSelection(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest(NATIVE_SELECTION_SELECTOR) !== null;
}
