import assert from 'node:assert/strict';
import test from 'node:test';

import { parseArgs, parseFeeString, parseHeightRange, parseTime, resolveRange, sumFees, txFeeText } from './fees.js';

// Heights 1..100, one second apart from GENESIS, served via a stubbed RPC.
const GENESIS = Date.parse('2026-01-01T00:00:00Z');
const TIP = 100;
const heightTime = height => new Date(GENESIS + (height - 1) * 1000).toISOString();

async function withFakeRpc(operation) {
	const originalFetch = globalThis.fetch;
	globalThis.fetch = async url => {
		if (url.endsWith('/status')) {
			return new Response(JSON.stringify({ result: { sync_info: { latest_block_height: String(TIP) } } }));
		}
		const height = Number(new URL(url).searchParams.get('height'));
		if (!(height >= 1 && height <= TIP)) {
			return new Response(JSON.stringify({ error: { message: 'height is not available' } }));
		}
		return new Response(JSON.stringify({ result: { block: { header: { time: heightTime(height) } } } }));
	};
	try {
		return await operation();
	} finally {
		globalThis.fetch = originalFetch;
	}
}

test('parses date-only and naive times as UTC', () => {
	assert.equal(parseTime('2026-09-27'), Date.parse('2026-09-27T00:00:00Z'));
	assert.equal(parseTime('2026-09-27 17:32:00'), Date.parse('2026-09-27T17:32:00Z'));
	assert.equal(parseTime('2026-09-27T17:32:00.941Z'), Date.parse('2026-09-27T17:32:00.941Z'));
	assert.throws(() => parseTime('yesterday'), /Invalid time/);
});

test('parses height ranges and positional args', () => {
	assert.deepEqual(parseHeightRange('100-200'), { fromHeight: 100, toHeight: 200 });
	assert.equal(parseHeightRange('100'), null);
	assert.equal(parseArgs(['latest']).height, null);
	assert.equal(parseArgs(['42']).height, 42);
	assert.deepEqual(parseArgs(['1-2']), {
		rpc: 'https://osmosis-rpc.polkachu.com',
		from: null,
		to: null,
		height: null,
		help: false,
		fromHeight: 1,
		toHeight: 2,
	});
	assert.throws(() => parseArgs(['1-2', '--from', '2026-09-27']), /not both/);
});

test('resolveRange maps a time range to block heights', async () => {
	await withFakeRpc(async () => {
		const range = await resolveRange('http://rpc.test', {
			from: heightTime(6),
			to: heightTime(20),
		});
		assert.deepEqual(range, { fromHeight: 6, toHeight: 20, tip: TIP });
	});
});

test('resolveRange rejects a --from beyond the chain tip instead of scanning the tip', async () => {
	await withFakeRpc(async () => {
		await assert.rejects(
			resolveRange('http://rpc.test', { from: heightTime(TIP + 100), to: null }),
			/No blocks at or after --from/,
		);
	});
});

test('resolveRange rejects --from after --to before touching the RPC', async () => {
	let fetchCalls = 0;
	const originalFetch = globalThis.fetch;
	globalThis.fetch = async () => { fetchCalls++; return new Response('{}'); };
	try {
		await assert.rejects(
			resolveRange('http://rpc.test', { from: heightTime(20), to: heightTime(10) }),
			/--from must not be after --to/,
		);
	} finally {
		globalThis.fetch = originalFetch;
	}
	assert.equal(fetchCalls, 0);
});

test('sums multi-denom fees including failed transactions', () => {
	const txResults = [
		{ code: 0, events: [{ type: 'tx', attributes: [{ key: 'fee', value: '11236uosmo' }] }] },
		{ code: 11, events: [{ type: 'fee_pay', attributes: [{ key: 'fee', value: '381uatom' }] }] },
		{ code: 0, events: [{ type: 'tx', attributes: [{ key: 'signature', value: 'abc' }] }] },
	];

	const { totals, feeEvents } = sumFees(txResults);

	assert.equal(feeEvents, 2);
	assert.equal(totals.get('uosmo'), 11236n);
	assert.equal(totals.get('uatom'), 381n);
});

test('prefers the tx event over fee_pay and decodes base64 attributes', () => {
	const base64 = value => Buffer.from(value).toString('base64');
	assert.equal(txFeeText({
		events: [
			{ type: 'tx', attributes: [{ key: base64('fee'), value: base64('1000uosmo') }] },
			{ type: 'fee_pay', attributes: [{ key: 'fee', value: '1000uosmo' }] },
		],
	}), '1000uosmo');

	assert.deepEqual(parseFeeString('1uatom,200uosmo'), [['uatom', 1n], ['uosmo', 200n]]);
	assert.deepEqual(parseFeeString(''), []);
	assert.equal(txFeeText({ events: [] }), null);
});
