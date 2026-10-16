import assert from 'node:assert/strict';
import test from 'node:test';

import { CosmosEventParser } from './cosmos-event-parser.js';

test('buildEventQuery joins conditions with AND', () => {
	const parser = new CosmosEventParser();
	assert.equal(
		parser.buildEventQuery({ sender: 'osmo1a', action: '/cosmos.bank.v1beta1.MsgSend' }),
		"message.sender='osmo1a' AND message.action='/cosmos.bank.v1beta1.MsgSend'",
	);
});

test('buildEventQuery maps recipient/custom events and is empty without params', () => {
	const parser = new CosmosEventParser();
	assert.equal(parser.buildEventQuery({}), '');
	assert.equal(
		parser.buildEventQuery({ recipient: 'osmo1b', customEvents: { 'coin_spent.denom': 'uosmo' } }),
		"transfer.recipient='osmo1b' AND coin_spent.denom='uosmo'",
	);
});

test('fetchTransactions sends the current query= param, not deprecated events=', async () => {
	const requested = [];
	const originalFetch = globalThis.fetch;
	globalThis.fetch = async (url) => {
		requested.push(String(url));
		return { ok: true, json: async () => ({ txs: [], pagination: {} }) };
	};
	try {
		const parser = new CosmosEventParser({ baseUrl: 'https://example.org' });
		await parser.fetchTransactions({ recipient: 'osmo1b' });
	} finally {
		globalThis.fetch = originalFetch;
	}

	assert.equal(requested.length, 1);
	const url = new URL(requested[0]);
	assert.equal(url.searchParams.get('query'), "transfer.recipient='osmo1b'");
	assert.equal(url.searchParams.get('pagination.limit'), '100');
	assert.ok(!requested[0].includes('events='));
});
