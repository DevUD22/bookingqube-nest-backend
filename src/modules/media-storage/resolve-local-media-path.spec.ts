import { join } from 'node:path';

import { resolveLocalMediaPath } from './resolve-local-media-path';

const root = join(process.cwd(), 'uploads');

describe('resolveLocalMediaPath', () => {
  it('accepts a nested uuid image key', () => {
    const key = 'events/11111111-1111-1111-1111-111111111111/22222222-2222-2222-2222-222222222222.jpg';
    const resolved = resolveLocalMediaPath(root, key);
    expect(resolved).toBe(join(root, ...key.split('/')));
  });

  it('rejects dot-dot traversal', () => {
    expect(
      resolveLocalMediaPath(
        root,
        'events/../22222222-2222-2222-2222-222222222222.jpg',
      ),
    ).toBeNull();
  });

  it('rejects encoded separators and leftover encoding', () => {
    expect(
      resolveLocalMediaPath(
        root,
        'events%2f../22222222-2222-2222-2222-222222222222.jpg',
      ),
    ).toBeNull();
    expect(
      resolveLocalMediaPath(
        root,
        'events/%2e%2e/22222222-2222-2222-2222-222222222222.jpg',
      ),
    ).toBeNull();
  });

  it('rejects non-image filenames', () => {
    expect(resolveLocalMediaPath(root, 'events/secret.txt')).toBeNull();
    expect(resolveLocalMediaPath(root, 'events/not-a-uuid.png')).toBeNull();
  });
});
