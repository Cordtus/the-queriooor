import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

// The explorer is a single HTML file with no build step, so the pure endpoint
// helpers are exercised by evaluating just that section with stubbed globals.
const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
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
		return { directoryChainsFromRegistry, readDirectoryCache, isDirectoryCacheFresh, chainsToNetworks, populateNetworkSelect, networkForPair, COSMOS_DIRECTORY_CHAINS, DIRECTORY_CACHE_TTL_MS };`,
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

test('chainsToNetworks pairs the RPC and REST aggregate for the same chain', () => {
	const { chainsToNetworks } = loadEndpointHelpers(memoryStorage());
	const networks = chainsToNetworks([
		{ slug: 'osmosis', label: 'Osmosis' },
		{ slug: 'sei', label: 'Sei', rpc: false },
		{ slug: 'okex', label: 'OKEx', rest: false },
	]);

	assert.deepEqual(networks, [
		{
			slug: 'osmosis',
			label: 'Osmosis',
			rpcUrl: 'https://rpc.cosmos.directory/osmosis',
			restUrl: 'https://rest.cosmos.directory/osmosis',
		},
		{
			slug: 'sei',
			label: 'Sei',
			rpcUrl: '',
			restUrl: 'https://rest.cosmos.directory/sei',
		},
		{
			slug: 'okex',
			label: 'OKEx',
			rpcUrl: 'https://rpc.cosmos.directory/okex',
			restUrl: '',
		},
	]);
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

test('populateNetworkSelect preserves a surviving selection and clears a stale one', () => {
	const { populateNetworkSelect } = loadEndpointHelpers(memoryStorage());
	const networks = [
		{ slug: 'osmosis', label: 'Osmosis', rpcUrl: 'https://rpc.cosmos.directory/osmosis', restUrl: 'https://rest.cosmos.directory/osmosis' },
		{ slug: 'sei', label: 'Sei', rpcUrl: '', restUrl: 'https://rest.cosmos.directory/sei' },
		{ slug: 'okex', label: 'OKEx', rpcUrl: 'https://rpc.cosmos.directory/okex', restUrl: '' },
	];

	const kept = fakeSelect('osmosis');
	populateNetworkSelect(kept, networks);
	assert.equal(kept.value, 'osmosis');
	assert.equal(kept.options[0].textContent, 'Custom endpoints');
	assert.equal(kept.options[1].textContent, 'Osmosis');
	assert.equal(kept.options[2].textContent, 'Sei (REST only)');
	assert.equal(kept.options[3].textContent, 'OKEx (RPC only)');

	const stale = fakeSelect('gone');
	populateNetworkSelect(stale, networks);
	assert.equal(stale.value, '');
});

test('networkForPair matches only the exact chain pair', () => {
	const { networkForPair } = loadEndpointHelpers(memoryStorage());
	const networks = [
		{ slug: 'osmosis', label: 'Osmosis', rpcUrl: 'https://rpc.cosmos.directory/osmosis', restUrl: 'https://rest.cosmos.directory/osmosis' },
		{ slug: 'sei', label: 'Sei', rpcUrl: '', restUrl: 'https://rest.cosmos.directory/sei' },
		{ slug: 'okex', label: 'OKEx', rpcUrl: 'https://rpc.cosmos.directory/okex', restUrl: '' },
	];

	assert.equal(networkForPair(networks, networks[0].rpcUrl, networks[0].restUrl)?.slug, 'osmosis');
	assert.equal(networkForPair(networks, '', networks[1].restUrl)?.slug, 'sei');
	assert.equal(networkForPair(networks, networks[2].rpcUrl, '')?.slug, 'okex');
	assert.equal(networkForPair(networks, networks[0].rpcUrl, networks[1].restUrl), null);
	assert.equal(networkForPair(networks, 'https://custom.example', 'https://rest.cosmos.directory/osmosis'), null);
});
