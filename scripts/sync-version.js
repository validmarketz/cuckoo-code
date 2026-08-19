/**
 * from GitHub Actions of tag 名（GITHUB_REF_NAME）extract版this号，
 * 同步to package.json and package-lock.json。
 * 用法：node scripts/sync-version.js
 */
const fs = require('fs');
const path = require('path');

const tag = process.env.GITHUB_REF_NAME || '';
const version = tag.replace(/^v/, '').trim();

if (!version || !/^\d+\.\d+\.\d+/.test(version)) {
  console.error('[sync-version] None法from tag extract版this号: ' + JSON.stringify(tag));
  process.exit(1);
}

const root = path.join(__dirname, '..');

// 更新 package.json
const pkgPath = path.join(root, 'package.json');
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
pkg.version = version;
fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
console.log('[sync-version] package.json -> ' + version);

// 更新 package-lock.json
const lockPath = path.join(root, 'package-lock.json');
if (fs.existsSync(lockPath)) {
  const lock = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
  if (lock.version) lock.version = version;
  if (lock.packages && lock.packages['']) {
    lock.packages[''].version = version;
  }
  fs.writeFileSync(lockPath, JSON.stringify(lock, null, 2) + '\n');
  console.log('[sync-version] package-lock.json -> ' + version);
}
