import { readFileSync } from 'fs';

test('canonical Docker aliases match and production starts compiled Node without development dependencies', () => {
  const docker = readFileSync('docker/backend.Dockerfile', 'utf8');
  expect(readFileSync('docker/Dockerfile', 'utf8')).toBe(docker);
  expect(docker).toContain('npm run build:backend'); expect(docker).toContain('CMD ["node", "dist/index.js"]');
  expect(docker).toContain('--omit=dev --ignore-scripts --workspaces=false'); expect(docker).not.toContain('ts-node');
  for (const pattern of ['**/node_modules', '**/.git', '**/.env', '**/.env.*', '**/*.pem', '**/*.key', '**/*.jks', '**/*.keystore', 'android']) expect(readFileSync('.dockerignore', 'utf8')).toContain(pattern);
});
