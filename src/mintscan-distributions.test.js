import assert from 'node:assert/strict';
import test from 'node:test';

import {
	auditExitCode,
	classifyTransactionDistributions,
	prepareDistributionSummary,
} from './mintscan-distributions.js';

const address = 'osmo1sender';
const denom = 'uosmo';

test('uses message accounting instead of duplicate transfer events', () => {
	const detail = {
		tx: {
			body: {
				messages: [{
					'@type': '/cosmos.bank.v1beta1.MsgSend',
					from_address: address,
					to_address: 'osmo1recipient',
					amount: [{ denom, amount: '1250000' }],
				}],
			},
		},
		tx_response: {
			logs: [{
				events: [{
					type: 'transfer',
					attributes: [
						{ key: 'sender', value: address },
						{ key: 'recipient', value: 'osmo1recipient' },
						{ key: 'amount', value: '1250000uosmo' },
					],
				}],
			}],
		},
	};

	assert.deepEqual(classifyTransactionDistributions(detail, address, denom, 'TX1'), [{
		txHash: 'TX1',
		msgType: '/cosmos.bank.v1beta1.MsgSend',
		recipient: 'osmo1recipient',
		amount: '1250000',
		source: 'message',
		note: null,
	}]);
});

test('counts nested authz sends and excludes inbound transfers', () => {
	const detail = {
		tx: {
			body: {
				messages: [{
					'@type': '/cosmos.authz.v1beta1.MsgExec',
					msgs: [
						{
							'@type': '/cosmos.bank.v1beta1.MsgSend',
							from_address: address,
							to_address: 'osmo1outbound',
							amount: [{ denom, amount: '900' }],
						},
						{
							'@type': '/cosmos.bank.v1beta1.MsgSend',
							from_address: 'osmo1other',
							to_address: address,
							amount: [{ denom, amount: '400' }],
						},
					],
				}],
			},
		},
	};

	const records = classifyTransactionDistributions(detail, address, denom, 'TX2');

	assert.equal(records.length, 1);
	assert.equal(records[0].recipient, 'osmo1outbound');
	assert.equal(records[0].amount, '900');
});

test('uses outbound transfer events when messages expose no distribution', () => {
	const detail = {
		tx_response: {
			logs: [{
				events: [{
					type: 'transfer',
					attributes: [
						{ key: 'sender', value: address },
						{ key: 'recipient', value: 'osmo1fallback' },
						{ key: 'amount', value: '7uatom,450uosmo' },
					],
				}],
			}],
		},
	};

	const records = classifyTransactionDistributions(detail, address, denom, 'TX3');

	assert.equal(records.length, 1);
	assert.equal(records[0].recipient, 'osmo1fallback');
	assert.equal(records[0].amount, '450');
	assert.equal(records[0].source, 'event');
});

test('counts repeated equal sends in one transaction separately', () => {
	const repeatedSend = {
		'@type': '/cosmos.bank.v1beta1.MsgSend',
		from_address: address,
		to_address: 'osmo1recipient',
		amount: [{ denom, amount: '100' }],
	};
	const detail = {
		tx: { body: { messages: [repeatedSend, { ...repeatedSend }] } },
	};

	const records = classifyTransactionDistributions(detail, address, denom, 'TX4');
	const result = prepareDistributionSummary(records, denom);

	assert.equal(result.distributions.length, 2);
	assert.equal(result.summary.count, 2);
	assert.equal(result.summary.total, 200n);
});

test('does not count message bodies from failed transactions', () => {
	const detail = {
		tx: {
			body: {
				messages: [{
					'@type': '/cosmos.bank.v1beta1.MsgSend',
					from_address: address,
					to_address: 'osmo1recipient',
					amount: [{ denom, amount: '500' }],
				}],
			},
		},
		tx_response: { code: 5, raw_log: 'insufficient funds' },
	};

	assert.deepEqual(classifyTransactionDistributions(detail, address, denom, 'FAILED'), []);
});

test('reports a non-zero exit code when transaction details are incomplete', () => {
	assert.equal(auditExitCode([]), 0);
	assert.equal(auditExitCode([{ hash: 'MISSING', status: 429 }]), 2);
});

test('attributes each output from a single-input multisend', () => {
	const detail = {
		tx: {
			body: {
				messages: [{
					'@type': '/cosmos.bank.v1beta1.MsgMultiSend',
					inputs: [{ address, coins: [{ denom, amount: '750' }] }],
					outputs: [
						{ address: 'osmo1first', coins: [{ denom, amount: '300' }] },
						{ address: 'osmo1second', coins: [{ denom, amount: '450' }] },
					],
				}],
			},
		},
	};

	const records = classifyTransactionDistributions(detail, address, denom, 'MULTI');

	assert.deepEqual(records.map(record => [record.recipient, record.amount]), [
		['osmo1first', '300'],
		['osmo1second', '450'],
	]);
});
