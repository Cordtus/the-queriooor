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

function loadEndpointHelpers(localStorage, options = {}) {
	const documentStub = {
		createElement: () => ({ value: '', textContent: '' }),
		getElementById: id => ({
			value: id === 'networkSelect'
				? (options.network ?? '')
				: id === 'rpcUrl' ? (options.rpcUrl ?? '') : '',
		}),
	};
	const proxiedFetch = options.proxiedFetch || (async () => { throw new Error('unexpected proxiedFetch call'); });
	const factory = new Function(
		'document',
		'localStorage',
		'proxiedFetch',
		`${html.slice(start, end)}
		return { directoryChainsFromRegistry, readDirectoryCache, isDirectoryCacheFresh, chainsToNetworks, populateNetworkSelect, networkForPair, pickAlternativeRpc, isTxIndexDisabled, searchTxs, FALLBACK_RPC_CACHE, PREFERRED_RPC, COSMOS_DIRECTORY_CHAINS, DIRECTORY_CACHE_TTL_MS };`,
	);
	return factory(documentStub, localStorage, proxiedFetch);
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

test('pickAlternativeRpc skips the current node, insecure URLs, and directory hosts', () => {
	const { pickAlternativeRpc } = loadEndpointHelpers(memoryStorage());
	const candidates = [
		'https://rpc.cosmos.directory/osmosis',
		'http://insecure.example',
		'https://same.example',
		'https://a.example',
		'https://b.example',
	];

	assert.equal(pickAlternativeRpc(candidates, 'https://same.example', () => 0), 'https://a.example');
	assert.equal(pickAlternativeRpc(candidates, 'https://same.example', () => 0.999), 'https://b.example');
	assert.equal(pickAlternativeRpc([], 'https://same.example'), '');
	assert.equal(pickAlternativeRpc(['https://same.example'], 'https://same.example/'), '');
});

test('isTxIndexDisabled recognizes the missing-index error payload', () => {
	const { isTxIndexDisabled } = loadEndpointHelpers(memoryStorage());

	assert.equal(isTxIndexDisabled({ error: { code: -32603, message: 'Internal error', data: 'transaction indexing is disabled' } }), true);
	assert.equal(isTxIndexDisabled({ error: { message: 'Transaction indexing is disabled' } }), true);
	assert.equal(isTxIndexDisabled({ error: 'tx indexer is not enabled' }), true);
	assert.equal(isTxIndexDisabled({ error: { message: 'Internal error' } }), false);
	assert.equal(isTxIndexDisabled({ result: { txs: [] } }), false);
	assert.equal(isTxIndexDisabled(null), false);
});

const INDEX_ERROR = {
	error: { code: -32603, message: 'Internal error', data: 'transaction indexing is disabled' },
};
const SUCCESS = { result: { total_count: '0', txs: [] } };

function stubResponse({ status = 200, statusText = 'OK', payload }) {
	return {
		ok: status >= 200 && status < 300,
		status,
		statusText,
		json: async () => payload,
	};
}

test('searchTxs retries once through a different node and reuses it for later pages', async () => {
	const calls = [];
	const helpers = loadEndpointHelpers(memoryStorage(), {
		network: 'osmosis',
		proxiedFetch: async url => {
			calls.push(url);
			if (url.startsWith('https://rpc.cosmos.directory/osmosis/tx_search')) {
				return stubResponse({ status: 500, statusText: 'Internal error', payload: INDEX_ERROR });
			}
			if (/^https:\/\/node-[ab]\.example\/tx_search/.test(url)) {
				return stubResponse({ payload: SUCCESS });
			}
			throw new Error(`unexpected URL ${url}`);
		},
	});
	helpers.FALLBACK_RPC_CACHE.set('osmosis', ['https://node-a.example', 'https://node-b.example']);

	const result = await helpers.searchTxs('https://rpc.cosmos.directory/osmosis', 'per_page=1');
	assert.equal(calls.length, 2);
	assert.match(calls[1], /^https:\/\/node-[ab]\.example\/tx_search\?per_page=1$/);
	assert.equal(calls[1], `${result.base}/tx_search?per_page=1`);
	assert.equal(result.retriedFrom, 'rpc.cosmos.directory');
	assert.equal(helpers.PREFERRED_RPC.get('osmosis'), result.base);

	await helpers.searchTxs('https://rpc.cosmos.directory/osmosis', 'per_page=1');
	assert.equal(calls.length, 3);
	assert.equal(calls[2], `${result.base}/tx_search?per_page=1`);
});

test('searchTxs does not retry a non-indexing failure', async () => {
	const calls = [];
	const helpers = loadEndpointHelpers(memoryStorage(), {
		network: 'osmosis',
		proxiedFetch: async url => {
			calls.push(url);
			return stubResponse({ status: 502, statusText: 'Bad Gateway', payload: { error: { message: 'upstream down' } } });
		},
	});
	helpers.FALLBACK_RPC_CACHE.set('osmosis', ['https://node-a.example']);

	await assert.rejects(
		helpers.searchTxs('https://rpc.cosmos.directory/osmosis', 'per_page=1'),
		/HTTP 502: Bad Gateway/,
	);
	assert.equal(calls.length, 1);
});

test('searchTxs explains when no fallback node is available', async () => {
	const helpers = loadEndpointHelpers(memoryStorage(), {
		network: 'osmosis',
		proxiedFetch: async () => stubResponse({ status: 500, statusText: 'Internal error', payload: INDEX_ERROR }),
	});
	helpers.FALLBACK_RPC_CACHE.set('osmosis', []);

	await assert.rejects(
		helpers.searchTxs('https://rpc.cosmos.directory/osmosis', 'per_page=1'),
		/Transaction indexing is disabled on the selected RPC node/,
	);
});
