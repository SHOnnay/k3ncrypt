import { useEffect, useRef, type RefObject } from 'react';

/**
 * Where Tab should go so focus cannot leave a modal panel, or undefined to let the browser decide.
 * `current` is the index of the focused element among the panel's focusable elements, -1 if focus is
 * outside the panel or on the panel itself.
 */
export const trapTabTarget = (count: number, current: number, shift: boolean): number | undefined => {
  if (count <= 0) return undefined;
  if (current < 0) return shift ? count - 1 : 0;
  if (shift && current === 0) return count - 1;
  if (!shift && current === count - 1) return 0;
  return undefined;
};

const FOCUSABLE = 'summary, a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Closed details bodies can retain layout boxes under grid styling but are not tabbable. */
const insideClosedDetailsBody = (item: HTMLElement): boolean => {
  for (let parent = item.parentElement; parent; parent = parent.parentElement) {
    if (parent.tagName !== 'DETAILS' || parent.hasAttribute('open')) continue;
    const summary = Array.from(parent.children).find(child => child.tagName === 'SUMMARY');
    if (!summary?.contains(item)) return true;
  }
  return false;
};

/**
 * Keyboard behavior for a modal panel: Escape closes it, Tab stays inside it, focus moves into it on
 * open and returns to whatever opened it on close.
 */
export const useModalKeyboard = (isOpen: boolean, panel: RefObject<HTMLElement>, onClose: () => void): void => {
  // Callers usually pass an inline arrow. Reading it through a ref keeps the effect (and therefore
  // focus) stable across re-renders instead of re-focusing the panel every time the parent renders.
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    if (!isOpen) return undefined;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : undefined;
    panel.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !event.defaultPrevented) { event.preventDefault(); close.current(); return; }
      if (event.key !== 'Tab' || !panel.current) return;
      const items = Array.from(panel.current.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(item => !item.matches(':disabled') && item.getClientRects().length > 0 && getComputedStyle(item).visibility !== 'hidden' && !item.closest('[inert]') && !insideClosedDetailsBody(item));
      if (!items.length) { event.preventDefault(); panel.current.focus(); return; }
      const target = trapTabTarget(items.length, items.indexOf(document.activeElement as HTMLElement), event.shiftKey);
      if (target !== undefined) { event.preventDefault(); items[target].focus(); }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      if (opener?.isConnected) opener.focus();
    };
  }, [isOpen, panel]);
};
