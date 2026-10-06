import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

// The explorer is a single HTML file with no build step, so the pure endpoint
// helpers are exercised by evaluating just that section with stubbed globals.
const html = readFileSync(new URL('./index.html', import.meta.url), 'utf8');
const START = 'const COSMOS_DIRECTORY_CHAINS = [';
const END = 'function normalizeEndpointUrl';
const start = html.indexOf(START);
const end = html.indexOf(END);
assert.ok(start >= 0 && end > start, 'endpoint section not found in index.html');

function memoryStorage(initial = {}) {
	const store = { ...initial };
	return {
		getItem: key => (key in store ? store[key] : null),
		setItem: (key, value) => { store[key] = String(value); },
	};
}

function loadEndpointHelpers(localStorage) {
	const documentStub = { createElement: () => ({ value: '', textContent: '' }) };
	const factory = new Function(
		'document',
		'localStorage',
		`${html.slice(start, end)}
		return { directoryChainsFromRegistry, readDirectoryCache, isDirectoryCacheFresh, buildEndpointLists, populateEndpointSelect, COSMOS_DIRECTORY_CHAINS, DIRECTORY_CACHE_TTL_MS };`,
	);
	return factory(documentStub, localStorage);
}

function fakeSelect(value = '') {
	return {
		value,
		options: [],
		set innerHTML(_) { this.options = []; },
		appendChild(option) { this.options.push(option); },
	};
}

test('directoryChainsFromRegistry keeps live proxy chains and flags missing sides', () => {
	const { directoryChainsFromRegistry } = loadEndpointHelpers(memoryStorage());
	const chains = directoryChainsFromRegistry([
		{ name: 'osmosis', pretty_name: 'Osmosis', status: 'live', proxy_status: { rpc: true, rest: true } },
		{ name: 'sei', pretty_name: 'Sei', status: 'live', proxy_status: { rpc: false, rest: true } },
		{ name: 'okex', pretty_name: 'OKEx', status: 'live', proxy_status: { rpc: true, rest: false } },
		{ name: 'stopped', pretty_name: 'Stopped', status: 'stopped', proxy_status: { rpc: true, rest: true } },
		{ name: 'bare', pretty_name: 'Bare', status: 'live' },
	]);

	assert.deepEqual(chains, [
		{ slug: 'okex', label: 'OKEx', rest: false },
		{ slug: 'osmosis', label: 'Osmosis' },
		{ slug: 'sei', label: 'Sei', rpc: false },
	]);
});

test('buildEndpointLists excludes chains missing the matching aggregate', () => {
	const { buildEndpointLists } = loadEndpointHelpers(memoryStorage());
	const lists = buildEndpointLists([
		{ slug: 'osmosis', label: 'Osmosis' },
		{ slug: 'sei', label: 'Sei', rpc: false },
		{ slug: 'okex', label: 'OKEx', rest: false },
	]);

	assert.ok(lists.rpc.some(ep => ep.url === 'https://rpc.cosmos.directory/osmosis'));
	assert.ok(!lists.rpc.some(ep => ep.url.endsWith('/sei')));
	assert.ok(lists.lcd.some(ep => ep.url === 'https://rest.cosmos.directory/sei'));
	assert.ok(!lists.lcd.some(ep => ep.url.endsWith('/okex')));
});

test('readDirectoryCache rejects empty or untimestamped entries and honors the TTL', () => {
	const key = 'cosmos-explorer-directory-chains';
	const empty = loadEndpointHelpers(memoryStorage({
		[key]: JSON.stringify({ ts: Date.now(), chains: [] }),
	}));
	assert.equal(empty.readDirectoryCache(), null);

	const helpers = loadEndpointHelpers(memoryStorage({
		[key]: JSON.stringify({ ts: Date.now(), chains: [{ slug: 'x', label: 'X' }] }),
	}));
	const cached = helpers.readDirectoryCache();
	assert.ok(cached);
	assert.equal(helpers.isDirectoryCacheFresh(cached), true);
	assert.equal(helpers.isDirectoryCacheFresh({ ts: Date.now() - helpers.DIRECTORY_CACHE_TTL_MS - 1 }), false);
});

test('populateEndpointSelect preserves a surviving selection and clears a stale one', () => {
	const { populateEndpointSelect } = loadEndpointHelpers(memoryStorage());
	const url = 'https://rpc.cosmos.directory/osmosis';

	const kept = fakeSelect(url);
	populateEndpointSelect(kept, [{ label: 'Osmosis (cosmos.directory)', url }]);
	assert.equal(kept.value, url);
	assert.equal(kept.options[0].textContent, 'Custom URL');

	const stale = fakeSelect('https://rpc.example/gone');
	populateEndpointSelect(stale, [{ label: 'Osmosis (cosmos.directory)', url }]);
	assert.equal(stale.value, '');
});
