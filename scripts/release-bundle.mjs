import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { ROOT, ok } from './lib.mjs'
import { packBundle } from './update-bundle.mjs'

/**
 * `npm run release:bundle` — packs this checkout into an update bundle file,
 * for the server's first install (deploy/install.sh). Every later update goes
 * through the app itself: Administrator → System update.
 */
const pkg = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'))
const bundle = packBundle(ROOT, { version: pkg.version, label: `${pkg.version} (first install)` })
const stamp = bundle.createdAt.replace(/[-:]/g, '').replace(/\..*$/, '').replace('T', '-')
const file = path.join(ROOT, `adshub-${pkg.version}-${stamp}.bundle`)
writeFileSync(file, bundle.buffer)

ok(`Bundle written: ${path.basename(file)}`)
console.log(`  ${bundle.files} files, ${(bundle.buffer.length / 1024 / 1024).toFixed(2)} MB packed`)
console.log(`  SHA-256 ${bundle.sha256}`)
console.log('')
console.log('  Copy it to the server with deploy/install.sh, then run the installer, e.g.:')
console.log(`    scp ${path.basename(file)} deploy/install.sh root@your-server:/root/`)
console.log(`    ssh root@your-server "bash /root/install.sh --bundle /root/${path.basename(file)} --domain your.domain --email you@example.com"`)
