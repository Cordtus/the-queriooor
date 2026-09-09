import assert from 'node:assert/strict';
import test from 'node:test';

import handler from './proxy.js';

function createResponse() {
	return {
		body: null,
		headers: {},
		statusCode: null,
		setHeader(name, value) {
			this.headers[name] = value;
		},
		status(code) {
			this.statusCode = code;
			return this;
		},
		json(body) {
			this.body = body;
			return this;
		},
		send(body) {
			this.body = body;
			return this;
		},
		writeHead(code, headers) {
			this.statusCode = code;
			Object.assign(this.headers, headers);
		},
		end() {},
	};
}

async function withFetch(fakeFetch, operation) {
	const originalFetch = globalThis.fetch;
	globalThis.fetch = fakeFetch;
	try {
		await operation();
	} finally {
		globalThis.fetch = originalFetch;
	}
}

test('rejects methods that could mutate an upstream endpoint', async () => {
	let fetchCalls = 0;
	const response = createResponse();

	await withFetch(async () => {
		fetchCalls += 1;
		return new Response('{}');
	}, async () => {
		await handler({
			method: 'POST',
			query: { url: 'https://lcd.osmosis.zone/cosmos/tx/v1beta1/txs' },
		}, response);
	});

	assert.equal(response.statusCode, 405);
	assert.deepEqual(response.body, { error: 'Only GET requests are allowed' });
	assert.equal(fetchCalls, 0);
});

test('rejects arbitrary targets without making an upstream request', async () => {
	let fetchCalls = 0;
	const response = createResponse();

	await withFetch(async () => {
		fetchCalls += 1;
		return new Response('{}');
	}, async () => {
		await handler({
			method: 'GET',
			query: { url: 'https://example.com/private' },
		}, response);
	});

	assert.equal(response.statusCode, 403);
	assert.deepEqual(response.body, { error: 'Target endpoint is not allowed' });
	assert.equal(fetchCalls, 0);
});

test('rejects mutating GET RPC methods without making an upstream request', async () => {
	let fetchCalls = 0;
	const response = createResponse();

	await withFetch(async () => {
		fetchCalls += 1;
		return new Response('{}');
	}, async () => {
		await handler({
			method: 'GET',
			query: {
				url: 'https://osmosis-rpc.polkachu.com/broadcast_tx_sync?tx=unsafe',
			},
		}, response);
	});

	assert.equal(response.statusCode, 403);
	assert.deepEqual(response.body, { error: 'Target endpoint path is not allowed' });
	assert.equal(fetchCalls, 0);
});

test('forwards bounded JSON responses from a preset endpoint', async () => {
	const response = createResponse();
	let requestedUrl = null;

	await withFetch(async url => {
		requestedUrl = url;
		return new Response('{"result":{"syncing":false}}', {
			status: 200,
			headers: { 'content-type': 'application/json' },
		});
	}, async () => {
		await handler({
			method: 'GET',
			query: { url: 'https://lcd.osmosis.zone/cosmos/base/tendermint/v1beta1/syncing' },
		}, response);
	});

	assert.equal(requestedUrl, 'https://lcd.osmosis.zone/cosmos/base/tendermint/v1beta1/syncing');
	assert.equal(response.statusCode, 200);
	assert.equal(response.body, '{"result":{"syncing":false}}');
});

test('forwards read-only requests to a custom non-preset RPC endpoint', async () => {
	const response = createResponse();
	let requestedUrl = null;

	await withFetch(async url => {
		requestedUrl = url;
		return new Response('{"jsonrpc":"2.0","result":{"height":"1"}}', {
			status: 200,
			headers: { 'content-type': 'application/json' },
		});
	}, async () => {
		await handler({
			method: 'GET',
			query: { url: 'https://rpc.nomic.basementnodes.ca/block_results?height=33137470' },
		}, response);
	});

	assert.equal(requestedUrl, 'https://rpc.nomic.basementnodes.ca/block_results?height=33137470');
	assert.equal(response.statusCode, 200);
	assert.equal(response.body, '{"jsonrpc":"2.0","result":{"height":"1"}}');
});

test('forwards read-only requests to a custom non-preset REST endpoint', async () => {
	const response = createResponse();

	await withFetch(async () => new Response('{"balances":[]}', {
		status: 200,
		headers: { 'content-type': 'application/json' },
	}), async () => {
		await handler({
			method: 'GET',
			query: { url: 'https://custom-rest.example/cosmos/bank/v1beta1/balances/osmo1abc' },
		}, response);
	});

	assert.equal(response.statusCode, 200);
	assert.equal(response.body, '{"balances":[]}');
});

test('rejects a non-read-only path on a custom endpoint', async () => {
	let fetchCalls = 0;
	const response = createResponse();

	await withFetch(async () => {
		fetchCalls += 1;
		return new Response('{}');
	}, async () => {
		await handler({
			method: 'GET',
			query: { url: 'https://rpc.nomic.basementnodes.ca/broadcast_tx_sync?tx=unsafe' },
		}, response);
	});

	assert.equal(response.statusCode, 403);
	assert.deepEqual(response.body, { error: 'Target endpoint is not allowed' });
	assert.equal(fetchCalls, 0);
});

test('rejects an upstream response that exceeds the proxy limit', async () => {
	const response = createResponse();

	await withFetch(async () => new Response('x'.repeat(1_048_577), {
		status: 200,
		headers: { 'content-type': 'application/json' },
	}), async () => {
		await handler({
			method: 'GET',
			query: { url: 'https://lcd.osmosis.zone/cosmos/base/tendermint/v1beta1/syncing' },
		}, response);
	});

	assert.equal(response.statusCode, 413);
	assert.deepEqual(response.body, { error: 'Upstream response exceeds 1048576 bytes' });
});
