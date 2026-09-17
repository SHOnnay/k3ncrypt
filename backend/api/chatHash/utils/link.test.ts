import { randomUUID } from 'crypto';

import generateLink from './link';

jest.mock('crypto', () => ({
  randomUUID: jest.fn().mockReturnValue('hash'),
}));

test('chat link generation', () => {
  const generatedLink = generateLink('a'.repeat(64));
  expect(generatedLink).toMatchObject({
    hash: 'hash',
    expired: false,
    deleted: false,
    controlCapabilityHash: 'a'.repeat(64),
  });
  expect(generatedLink).not.toHaveProperty('pin');
  expect(generatedLink).not.toHaveProperty('pinCreatedAt');

  expect(randomUUID).toBeCalledTimes(1);
});
