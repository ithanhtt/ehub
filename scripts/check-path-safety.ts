/**
 * Path-safety check — `npm run check:paths`.
 *
 * The Hub accepts a user-supplied endpoint path and sends it with the
 * connection's credentials, so a path that escapes the connector's base URL
 * turns the app into a confused deputy. Every attack shape below has to be
 * refused, and every legitimate shape has to survive — a rule that only does
 * the first half is useless.
 *
 * Offline and instant; safe for CI.
 */
import { resolveCustomPath, isAllowedMethod, SAFE_METHODS } from '@/core/plugins/custom-path'

let failures = 0
let checks = 0

function expectReject(base: string, path: string, label: string) {
  checks += 1
  const result = resolveCustomPath(base, path)
  if (!result.ok) {
    console.log(`  \x1b[32m✓\x1b[0m refused ${label.padEnd(46)} (${result.reason})`)
  } else {
    failures += 1
    console.log(`  \x1b[31m✗\x1b[0m ALLOWED ${label.padEnd(46)} -> ${result.url}`)
  }
}

function expectAllow(base: string, path: string, expected: string, label: string) {
  checks += 1
  const result = resolveCustomPath(base, path)
  if (result.ok && result.url === expected) {
    console.log(`  \x1b[32m✓\x1b[0m allowed ${label.padEnd(46)} -> ${result.url}`)
  } else {
    failures += 1
    console.log(
      `  \x1b[31m✗\x1b[0m ${label.padEnd(54)} got ${result.ok ? result.url : `refused (${result.reason})`}`,
    )
  }
}

const TIKTOK = 'https://business-api.tiktok.com/open_api/v1.3'
const SAPO = 'https://demo.mysapo.net'

console.log('\n\x1b[36mLegitimate paths must still work\x1b[0m')
expectAllow(TIKTOK, '/campaign/get/', 'https://business-api.tiktok.com/open_api/v1.3/campaign/get/', 'leading slash')
expectAllow(TIKTOK, 'campaign/get/', 'https://business-api.tiktok.com/open_api/v1.3/campaign/get/', 'no leading slash')
expectAllow(TIKTOK, '/app/info/', 'https://business-api.tiktok.com/open_api/v1.3/app/info/', 'a real undeclared endpoint')
expectAllow(
  TIKTOK,
  '//campaign/get/'.replace('//', '/'),
  'https://business-api.tiktok.com/open_api/v1.3/campaign/get/',
  'single slash after normalising',
)
expectAllow(SAPO, '/admin/orders.json', 'https://demo.mysapo.net/admin/orders.json', 'sapo admin path')
expectAllow(SAPO, 'admin/orders/123.json', 'https://demo.mysapo.net/admin/orders/123.json', 'nested id path')
expectAllow(
  TIKTOK,
  '/report/integrated/get/',
  'https://business-api.tiktok.com/open_api/v1.3/report/integrated/get/',
  'deep path',
)

console.log('\n\x1b[36mAbsolute and protocol-relative URLs\x1b[0m')
expectReject(TIKTOK, 'https://evil.example/steal', 'absolute https')
expectReject(TIKTOK, 'http://evil.example/steal', 'absolute http')
expectReject(TIKTOK, '//evil.example/steal', 'protocol-relative (the one people forget)')
expectReject(TIKTOK, '///evil.example/steal', 'triple slash')
expectReject(TIKTOK, 'javascript:alert(1)', 'javascript scheme')
expectReject(TIKTOK, 'file:///etc/passwd', 'file scheme')
expectReject(TIKTOK, 'gopher://evil.example/', 'other scheme')

console.log('\n\x1b[36mTraversal out of the base path\x1b[0m')
expectReject(TIKTOK, '../../../admin', 'dot-dot traversal')
// A leading slash cannot reach a sibling: the base prefix is always kept, so
// this lands *inside* v1.3 as a nonsense path the provider will 404. Safe, and
// an earlier version of this file asserted the opposite by mistake.
expectAllow(
  TIKTOK,
  '/open_api/v1.2/campaign/get/',
  'https://business-api.tiktok.com/open_api/v1.3/open_api/v1.2/campaign/get/',
  'leading slash stays inside the base',
)
expectReject(TIKTOK, '..%2f..%2fadmin', 'encoded traversal')
expectReject(TIKTOK, '/../v1.2/x', 'traversal from a leading slash')
expectReject(TIKTOK, 'campaign/../../../../x', 'traversal buried mid-path')

console.log('\n\x1b[36mCredential and header smuggling\x1b[0m')
expectReject(TIKTOK, 'campaign/get/\nX-Evil: 1', 'newline (header injection)')
expectReject(TIKTOK, 'campaign/get/\r\nHost: evil', 'CRLF')
expectReject(TIKTOK, 'campaign' + '\u0000' + '/get/', 'NUL byte (single escape, not literal text)')
expectReject(TIKTOK, 'campaign/get/\u007f', 'DEL')

console.log('\n\x1b[36mInternal targets, reached through the base\x1b[0m')
// These are refused because they are absolute, which is what protects the
// metadata service and localhost without needing an IP blocklist.
expectReject(TIKTOK, 'http://169.254.169.254/latest/meta-data/', 'cloud metadata service')
expectReject(TIKTOK, 'http://localhost:5432/', 'localhost')
expectReject(TIKTOK, 'http://[::1]/', 'IPv6 loopback')
expectReject(TIKTOK, 'http://10.0.0.1/', 'private range')

console.log('\n\x1b[36mDegenerate input\x1b[0m')
expectReject(TIKTOK, '', 'empty path')
expectReject(TIKTOK, '   ', 'whitespace only')
expectReject('not-a-url', '/x', 'unparseable base')
expectReject('ftp://example.com/', '/x', 'non-http base')

console.log('\n\x1b[36mMethods\x1b[0m')
checks += 1
if (SAFE_METHODS.has('GET') && !SAFE_METHODS.has('DELETE')) {
  console.log('  \x1b[32m✓\x1b[0m only GET counts as safe')
} else {
  failures += 1
  console.log('  \x1b[31m✗\x1b[0m the safe-method set is wrong')
}
checks += 1
if (isAllowedMethod('GET') && isAllowedMethod('DELETE') && !isAllowedMethod('TRACE')) {
  console.log('  \x1b[32m✓\x1b[0m the method allow-list is closed')
} else {
  failures += 1
  console.log('  \x1b[31m✗\x1b[0m the method allow-list is wrong')
}

console.log(
  failures === 0
    ? `\n\x1b[32m✓ ${checks} path-safety checks passed\x1b[0m\n`
    : `\n\x1b[31m✗ ${failures} of ${checks} failed\x1b[0m\n`,
)
process.exit(failures === 0 ? 0 : 1)
