import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveLcd, DEFAULT_LCD } from './cli-args.js';

test('reads --lcd with a separate value and strips the trailing slash', () => {
	const args = ['--lcd', 'https://example.org/', 'osmo1x'];
	assert.equal(resolveLcd(args, {}), 'https://example.org');
	assert.deepEqual(args, ['osmo1x']);
});

test('reads the --lcd=url form', () => {
	const args = ['--received', '--lcd=https://a.b/c'];
	assert.equal(resolveLcd(args, {}), 'https://a.b/c');
	assert.deepEqual(args, ['--received']);
});

test('falls back to COSMOS_LCD then the default', () => {
	assert.equal(resolveLcd([], { COSMOS_LCD: 'https://env.example/' }), 'https://env.example');
	assert.equal(resolveLcd([], {}), DEFAULT_LCD);
});

test('rejects a missing or flag-like value', () => {
	assert.throws(() => resolveLcd(['--lcd'], {}), /requires a URL/);
	assert.throws(() => resolveLcd(['--lcd', '--received', 'osmo1x'], {}), /requires a URL/);
});
