#!/usr/bin/env node

import { pathToFileURL } from 'node:url';

const DEFAULT_BASE_URL = 'https://apis.mintscan.io';
const DEFAULT_NETWORK = 'osmosis';
const DEFAULT_DENOM = 'uosmo';
const DEFAULT_PAGE_SIZE = 50;
const DEFAULT_RATE_LIMIT_MS = 250;
const FALLBACK_ENV_VARS = ['MINT_TOKEN', 'MINTSCAN_API_KEY'];

function printUsage() {
	console.log(`
Usage:
  mintscan-distributions.js <address> [options]

Options:
  --network <name>          Mintscan network slug (default: osmosis)
  --denom <denom>           Base denom to total (default: uosmo)
  --take <n>                Account tx page size (default: 50)
  --max-pages <n>           Stop after N account-history pages
  --from <datetime>         Mintscan fromDateTime filter
  --to <datetime>           Mintscan toDateTime filter
  --delay <ms>              Delay between API calls (default: 250)
  --json                    Print the full summary as JSON
  --help                    Show this message

Environment:
  Set one of ${FALLBACK_ENV_VARS.join(', ')} with a Mintscan bearer token.

Examples:
  mintscan-distributions.js osmo1f3w7ved2murkx4rg9qw8fyk5mfk2285hzzsxh5
  mintscan-distributions.js osmo1... --from "2026-01-01" --to "2026-02-01 23:59:59"
	`);
}

function parseArgs(argv) {
	const options = {
		address: null,
		network: DEFAULT_NETWORK,
		denom: DEFAULT_DENOM,
		take: DEFAULT_PAGE_SIZE,
		maxPages: null,
		fromDateTime: null,
		toDateTime: null,
		delayMs: DEFAULT_RATE_LIMIT_MS,
		json: false,
	};

	for (let index = 0; index < argv.length; index++) {
		const arg = argv[index];
		if (!arg.startsWith('--') && !options.address) {
			options.address = arg;
			continue;
		}

		switch (arg) {
			case '--network':
				options.network = argv[++index];
				break;
			case '--denom':
				options.denom = argv[++index];
				break;
			case '--take':
				options.take = parseInteger(argv[++index], '--take');
				break;
			case '--max-pages':
				options.maxPages = parseInteger(argv[++index], '--max-pages');
				break;
			case '--from':
				options.fromDateTime = argv[++index];
				break;
			case '--to':
				options.toDateTime = argv[++index];
				break;
			case '--delay':
				options.delayMs = parseInteger(argv[++index], '--delay');
				break;
			case '--json':
				options.json = true;
				break;
			case '--help':
				options.help = true;
				break;
			default:
				throw new Error(`Unknown argument: ${arg}`);
		}
	}

	return options;
}

function parseInteger(rawValue, flagName) {
	const value = Number.parseInt(rawValue, 10);
	if (!Number.isFinite(value) || value < 0) {
		throw new Error(`${flagName} must be a non-negative integer`);
	}
	return value;
}

function getToken() {
	for (const name of FALLBACK_ENV_VARS) {
		if (process.env[name]) {
			return {
				name,
				value: process.env[name],
			};
		}
	}

	throw new Error(`Missing Mintscan token. Set one of: ${FALLBACK_ENV_VARS.join(', ')}`);
}

function sleep(ms) {
	return new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchJson(url, tokenValue) {
	const response = await fetch(url, {
		headers: {
			accept: 'application/json',
			authorization: `Bearer ${tokenValue}`,
		},
	});

	const text = await response.text();
	let payload = null;
	if (text) {
		try {
			payload = JSON.parse(text);
		} catch {
			payload = {
				raw: text,
			};
		}
	}

	if (!response.ok) {
		const error = new Error(`HTTP ${response.status} ${response.statusText}`);
		error.status = response.status;
		error.payload = payload;
		error.url = url;
		throw error;
	}

	return payload;
}

function buildAccountTransactionsUrl(options, searchAfter = null) {
	const url = new URL(`${DEFAULT_BASE_URL}/v1/${options.network}/accounts/${options.address}/transactions`);
	url.searchParams.set('take', String(options.take));

	if (options.fromDateTime) {
		url.searchParams.set('fromDateTime', options.fromDateTime);
	}
	if (options.toDateTime) {
		url.searchParams.set('toDateTime', options.toDateTime);
	}
	if (searchAfter) {
		url.searchParams.set('searchAfter', searchAfter);
	}

	return url;
}

function buildTxDetailCandidates(network, hash) {
	return [
		new URL(`${DEFAULT_BASE_URL}/v1/${network}/txs/${hash}`),
		new URL(`${DEFAULT_BASE_URL}/v1/search/transactions/${hash}`),
	];
}

function pickFirstArray(payload, candidates) {
	for (const path of candidates) {
		const value = path.reduce((current, key) => current?.[key], payload);
		if (Array.isArray(value)) {
			return value;
		}
	}

	return null;
}

function getNestedValue(payload, candidates) {
	for (const path of candidates) {
		const value = path.reduce((current, key) => current?.[key], payload);
		if (value !== undefined && value !== null && value !== '') {
			return value;
		}
	}

	return null;
}

function pickTransactions(payload) {
	if (Array.isArray(payload)) {
		return payload;
	}

	return pickFirstArray(payload, [
		['data', 'items'],
		['data', 'transactions'],
		['data', 'txs'],
		['items'],
		['transactions'],
		['txs'],
		['result'],
	]) || [];
}

function pickSearchAfter(payload) {
	return getNestedValue(payload, [
		['pagination', 'searchAfter'],
		['pagination', 'nextKey'],
		['data', 'pagination', 'searchAfter'],
		['data', 'pagination', 'nextKey'],
		['meta', 'pagination', 'searchAfter'],
		['searchAfter'],
	]);
}

function pickHash(tx) {
	return getNestedValue(tx, [
		['hash'],
		['txHash'],
		['txhash'],
		['transactionHash'],
		['header', 'hash'],
	]);
}

function pickMessages(payload) {
	const direct = pickFirstArray(payload, [
		['tx', 'body', 'messages'],
		['data', 'tx', 'body', 'messages'],
		['tx', 'messages'],
		['data', 'tx', 'messages'],
		['messages'],
	]);
	if (direct) {
		return direct;
	}

	return findArraysDeep(payload, value =>
		Array.isArray(value) &&
		value.every(item => item && typeof item === 'object') &&
		value.some(item => item['@type'])
	)[0] || [];
}

function pickLogs(payload) {
	return pickFirstArray(payload, [
		['tx_response', 'logs'],
		['data', 'tx_response', 'logs'],
		['logs'],
		['data', 'logs'],
	]) || [];
}

function findArraysDeep(value, predicate, seen = new Set()) {
	if (!value || typeof value !== 'object' || seen.has(value)) {
		return [];
	}
	seen.add(value);

	const matches = [];
	if (predicate(value)) {
		matches.push(value);
	}

	if (Array.isArray(value)) {
		for (const item of value) {
			matches.push(...findArraysDeep(item, predicate, seen));
		}
		return matches;
	}

	for (const nested of Object.values(value)) {
		matches.push(...findArraysDeep(nested, predicate, seen));
	}

	return matches;
}

function normalizeAddress(address) {
	return typeof address === 'string' ? address.trim() : '';
}

function toCoinArray(value) {
	if (!value) return [];
	if (Array.isArray(value)) return value;
	if (typeof value === 'object' && value.amount !== undefined && value.denom) return [value];
	return [];
}

function sumDenom(coins, denom) {
	return toCoinArray(coins)
		.filter(coin => coin?.denom === denom)
		.reduce((total, coin) => total + BigInt(coin.amount || 0), 0n);
}

function formatBaseDenom(amount, denom) {
	const negative = amount < 0n;
	const absolute = negative ? -amount : amount;
	const raw = absolute.toString().padStart(7, '0');
	const whole = raw.slice(0, -6) || '0';
	const fractional = raw.slice(-6).replace(/0+$/, '');
	const pretty = fractional ? `${whole}.${fractional}` : whole;
	const displayDenom = denom.startsWith('u') ? denom.slice(1).toUpperCase() : denom;
	return `${negative ? '-' : ''}${pretty} ${displayDenom}`;
}

function buildDistributionRecord(txHash, msgType, amount, recipient, source, note = null) {
	return {
		txHash,
		msgType,
		recipient,
		amount: amount.toString(),
		source,
		note,
	};
}

function parseTransferEvents(logs, address, denom, txHash) {
	const distributions = [];

	for (const log of logs) {
		for (const event of log?.events || []) {
			if (event?.type !== 'transfer') {
				continue;
			}

			let sender = null;
			let recipient = null;
			let amount = null;
			for (const attr of event.attributes || []) {
				if (attr.key === 'sender') {
					sender = attr.value;
				} else if (attr.key === 'recipient') {
					recipient = attr.value;
				} else if (attr.key === 'amount') {
					amount = attr.value;
				}

				if (sender && recipient && amount) {
					if (normalizeAddress(sender) === address && normalizeAddress(recipient) !== address) {
						for (const coin of parseAmountString(amount)) {
							if (coin.denom === denom) {
								distributions.push(buildDistributionRecord(
									txHash,
									'event.transfer',
									BigInt(coin.amount),
									recipient,
									'event',
									'Fallback transfer-event match',
								));
							}
						}
					}
					sender = null;
					recipient = null;
					amount = null;
				}
			}
		}
	}

	return distributions;
}

function parseAmountString(rawAmount) {
	return rawAmount
		.split(',')
		.map(part => part.trim())
		.filter(Boolean)
		.map(part => {
			const match = part.match(/^(\d+)([a-zA-Z0-9/._:-]+)$/);
			if (!match) {
				return null;
			}
			return {
				amount: match[1],
				denom: match[2],
			};
		})
		.filter(Boolean);
}

function collectMessageDistributions(messages, address, denom, txHash, depth = 0) {
	const records = [];
	const normalizedAddress = normalizeAddress(address);
	if (depth > 5) {
		return records;
	}

	for (const msg of messages) {
		const type = msg?.['@type'] || msg?.type || 'unknown';

		if (type === '/cosmos.bank.v1beta1.MsgSend') {
			if (normalizeAddress(msg.from_address) !== normalizedAddress) {
				continue;
			}

			const amount = sumDenom(msg.amount, denom);
			if (amount > 0n && normalizeAddress(msg.to_address) !== normalizedAddress) {
				records.push(buildDistributionRecord(txHash, type, amount, msg.to_address, 'message'));
			}
			continue;
		}

		if (type === '/cosmos.bank.v1beta1.MsgMultiSend') {
			const sourceInput = (msg.inputs || [])
				.filter(input => normalizeAddress(input.address) === normalizedAddress)
				.reduce((total, input) => total + sumDenom(input.coins, denom), 0n);
			if (sourceInput === 0n) {
				continue;
			}

			const selfOutputs = (msg.outputs || [])
				.filter(output => normalizeAddress(output.address) === normalizedAddress)
				.reduce((total, output) => total + sumDenom(output.coins, denom), 0n);
			const netOutbound = sourceInput > selfOutputs ? sourceInput - selfOutputs : 0n;
			if (netOutbound === 0n) {
				continue;
			}

			const nonSelfOutputs = (msg.outputs || [])
				.filter(output => normalizeAddress(output.address) !== normalizedAddress)
				.map(output => ({
					address: output.address,
					amount: sumDenom(output.coins, denom),
				}))
				.filter(output => output.amount > 0n);

			const singleInput = (msg.inputs || []).length === 1;
			if (singleInput) {
				for (const output of nonSelfOutputs) {
					records.push(buildDistributionRecord(txHash, type, output.amount, output.address, 'message'));
				}
				continue;
			}

			records.push(buildDistributionRecord(
				txHash,
				type,
				netOutbound,
				null,
				'message',
				'Net outbound from a multi-input MsgMultiSend; recipient attribution is ambiguous.',
			));
			continue;
		}

		if (type === '/cosmos.authz.v1beta1.MsgExec') {
			const nestedMessages = Array.isArray(msg.msgs) ? msg.msgs : [];
			if (nestedMessages.length > 0) {
				records.push(...collectMessageDistributions(nestedMessages, address, denom, txHash, depth + 1));
			}
			continue;
		}

		if (type === '/cosmos.bank.v1beta1.MsgInput') {
			continue;
		}
	}

	return records;
}

export function classifyTransactionDistributions(detail, address, denom, txHash) {
	const responseCode = getNestedValue(detail, [
		['tx_response', 'code'],
		['data', 'tx_response', 'code'],
		['txResponse', 'code'],
		['data', 'txResponse', 'code'],
	]);
	if (responseCode !== null && Number(responseCode) !== 0) {
		return [];
	}

	const messageMatches = collectMessageDistributions(
		pickMessages(detail),
		address,
		denom,
		txHash,
	);

	return messageMatches.length > 0
		? messageMatches
		: parseTransferEvents(pickLogs(detail), address, denom, txHash);
}

async function fetchAllAccountTransactions(options, tokenValue) {
	const items = [];
	const seenCursors = new Set();
	let searchAfter = null;
	let page = 0;

	while (true) {
		page += 1;
		if (options.maxPages && page > options.maxPages) {
			break;
		}

		const payload = await fetchJson(buildAccountTransactionsUrl(options, searchAfter), tokenValue);
		const pageItems = pickTransactions(payload);
		items.push(...pageItems);

		const nextSearchAfter = pickSearchAfter(payload);
		if (!nextSearchAfter || seenCursors.has(nextSearchAfter) || pageItems.length === 0) {
			break;
		}

		seenCursors.add(nextSearchAfter);
		searchAfter = nextSearchAfter;
		await sleep(options.delayMs);
	}

	return items;
}

async function fetchTransactionDetail(network, hash, tokenValue) {
	let lastError = null;

	for (const url of buildTxDetailCandidates(network, hash)) {
		try {
			return await fetchJson(url, tokenValue);
		} catch (error) {
			lastError = error;
			if (error.status !== 404) {
				break;
			}
		}
	}

	throw lastError;
}

function summarizeDistributions(distributions, denom) {
	const total = distributions.reduce((sum, record) => sum + BigInt(record.amount), 0n);
	return {
		total,
		formatted: formatBaseDenom(total, denom),
		count: distributions.length,
	};
}

export function prepareDistributionSummary(distributions, denom) {
	return {
		distributions: [...distributions],
		summary: summarizeDistributions(distributions, denom),
	};
}

export function auditExitCode(detailErrors) {
	return detailErrors.length === 0 ? 0 : 2;
}

async function main() {
	const options = parseArgs(process.argv.slice(2));
	if (options.help || !options.address) {
		printUsage();
		process.exit(options.help ? 0 : 1);
	}

	const token = getToken();
	const address = normalizeAddress(options.address);
	const summaries = await fetchAllAccountTransactions({ ...options, address }, token.value);

	const txHashes = dedupeValues(summaries.map(pickHash).filter(Boolean));
	const distributions = [];
	const detailErrors = [];

	for (let index = 0; index < txHashes.length; index++) {
		const hash = txHashes[index];
		try {
			const detail = await fetchTransactionDetail(options.network, hash, token.value);
			distributions.push(...classifyTransactionDistributions(
				detail,
				address,
				options.denom,
				hash,
			));
		} catch (error) {
			detailErrors.push({
				hash,
				status: error.status || null,
				message: error.payload?.message || error.message,
			});
		}

		if (index < txHashes.length - 1) {
			await sleep(options.delayMs);
		}
	}

	const prepared = prepareDistributionSummary(distributions, options.denom);
	const summary = prepared.summary;
	const result = {
		address,
		network: options.network,
		denom: options.denom,
		tokenEnvVar: token.name,
		accountTransactionCount: summaries.length,
		transactionHashesChecked: txHashes.length,
		distributionCount: summary.count,
		complete: detailErrors.length === 0,
		totalBaseDenom: summary.total.toString(),
		totalDisplay: summary.formatted,
		distributions: prepared.distributions,
		detailErrors,
	};
	process.exitCode = auditExitCode(detailErrors);

	if (options.json) {
		console.log(JSON.stringify(result, null, 2));
		return;
	}

	console.log(`Address: ${result.address}`);
	console.log(`Network: ${result.network}`);
	console.log(`Denom: ${result.denom}`);
	console.log(`Token env var: ${result.tokenEnvVar}`);
	console.log(`Account tx rows fetched: ${result.accountTransactionCount}`);
	console.log(`Unique tx hashes checked: ${result.transactionHashesChecked}`);
	console.log(`Outbound distributions found: ${result.distributionCount}`);
	console.log(`Total outbound: ${result.totalBaseDenom} (${result.totalDisplay})`);

	if (result.distributions.length > 0) {
		console.log('\nMatches:');
		for (const record of result.distributions) {
			const suffix = record.note ? ` [${record.note}]` : '';
			console.log(`- ${record.txHash} ${record.msgType} ${record.amount}${result.denom} -> ${record.recipient || '(multi-input net outbound)'}${suffix}`);
		}
	}

	if (result.detailErrors.length > 0) {
		console.log('\nDetail fetch errors:');
		for (const error of result.detailErrors) {
			console.log(`- ${error.hash}: ${error.status || 'ERR'} ${error.message}`);
		}
	}
}

function dedupeValues(values) {
	return [...new Set(values)];
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	main().catch(error => {
		if (error.status && error.payload?.message) {
			console.error(`Mintscan request failed: ${error.status} ${error.payload.message}`);
		} else {
			console.error(`Error: ${error.message}`);
		}
		process.exit(1);
	});
}
