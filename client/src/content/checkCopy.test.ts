import { checkCopy, checkName, checkState } from './checkCopy';

describe('check copy', () => {
  it('reads generic room labels as "your contact" and capitalises sentence starts', () => {
    expect(checkName('Contact · 00DB')).toBe('your contact');
    expect(checkName('Mum')).toBe('Mum');
    expect(checkCopy.changed('your contact')).toMatch(/^Your contact’s security number changed\..*someone is trying to listen in/);
  });
  it('maps contact state to exactly one pill state', () => {
    expect(checkState({ verification: 'verified', changeStatus: 'unchanged', identityId: 'x' })).toBe('checked');
    expect(checkState({ verification: 'verified', changeStatus: 'changed-pending-review', identityId: 'x' })).toBe('changed');
    expect(checkState({ verification: 'unverified', changeStatus: 'unchanged', identityId: 'x' })).toBe('unchecked');
    expect(checkState(undefined)).toBe('unavailable');
  });
  it('never uses technical words', () => {
    const all = JSON.stringify(Object.values(checkCopy).map((value) => typeof value === 'function' ? value('Mum') : value));
    expect(all).not.toMatch(/fingerprint|payload|pinned|identity key|verif/i);
  });
});
