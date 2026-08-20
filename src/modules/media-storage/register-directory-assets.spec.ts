import { join } from 'node:path';

import { resolveDirectoryAssetPath } from './register-directory-assets';

const root = join(process.cwd(), 'swagger-ui');

describe('resolveDirectoryAssetPath', () => {
  it('accepts a file in the assets root', () => {
    expect(resolveDirectoryAssetPath(root, 'swagger-ui.css')).toBe(
      join(root, 'swagger-ui.css'),
    );
  });

  it('rejects traversal and nested paths', () => {
    expect(resolveDirectoryAssetPath(root, '../package.json')).toBeNull();
    expect(resolveDirectoryAssetPath(root, 'vendor/secret.js')).toBeNull();
  });

  it('rejects unknown extensions and package.json', () => {
    expect(resolveDirectoryAssetPath(root, 'readme.md')).toBeNull();
    expect(resolveDirectoryAssetPath(root, 'package.json')).toBeNull();
  });
});
