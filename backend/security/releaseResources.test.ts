import { readFileSync } from 'fs';

test('Android backup policy excludes credential/device-protected domains and release never uses debug signing', () => {
  const domains = ['root', 'file', 'database', 'sharedpref', 'external', 'device_root', 'device_file', 'device_database', 'device_sharedpref'];
  const extraction = readFileSync('android/app/src/main/res/xml/data_extraction_rules.xml', 'utf8');
  for (const mode of ['cloud-backup', 'device-transfer']) {
    const section = extraction.split(`<${mode}>`)[1].split(`</${mode}>`)[0];
    for (const domain of domains) expect(section).toContain(`<exclude domain="${domain}" path="." />`);
  }
  for (const domain of domains) expect(readFileSync('android/app/src/main/res/xml/backup_rules.xml', 'utf8')).toContain(`<exclude domain="${domain}" path="." />`);
  const build = readFileSync('android/app/build.gradle.kts', 'utf8');
  expect(build).toContain('versionCode = 3'); expect(build).toContain('versionName = "0.1.0-beta.3"');
  expect(build).not.toContain('signingConfigs.getByName("debug")');
});
test('canonical Docker aliases match and production starts compiled Node without development dependencies', () => {
  const docker = readFileSync('docker/backend.Dockerfile', 'utf8');
  expect(readFileSync('docker/Dockerfile', 'utf8')).toBe(docker);
  expect(docker).toContain('npm run build:backend'); expect(docker).toContain('CMD ["node", "dist/index.js"]');
  expect(docker).toContain('--omit=dev --ignore-scripts --workspaces=false'); expect(docker).not.toContain('ts-node');
  for (const pattern of ['**/node_modules', '**/.git', '**/.env', '**/.env.*', '**/*.pem', '**/*.key', '**/*.jks', '**/*.keystore', 'android']) expect(readFileSync('.dockerignore', 'utf8')).toContain(pattern);
});
