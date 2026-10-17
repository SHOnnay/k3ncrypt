import { trapTabTarget } from './useModalKeyboard';

describe('modal focus trap', () => {
  it('wraps Tab from the last control to the first and Shift+Tab from the first to the last', () => {
    expect(trapTabTarget(4, 3, false)).toBe(0);
    expect(trapTabTarget(4, 0, true)).toBe(3);
  });
  it('leaves ordinary movement inside the panel to the browser', () => {
    expect(trapTabTarget(4, 1, false)).toBeUndefined();
    expect(trapTabTarget(4, 2, true)).toBeUndefined();
  });
  it('pulls focus into the panel when it is outside or on the panel container', () => {
    expect(trapTabTarget(4, -1, false)).toBe(0);
    expect(trapTabTarget(4, -1, true)).toBe(3);
  });
  it('does nothing for a panel without focusable controls', () => {
    expect(trapTabTarget(0, -1, false)).toBeUndefined();
  });
});
