#!/usr/bin/env node

import { pathToFileURL } from 'node:url';

const DEFAULT_RPC = 'https://osmosis-rpc.polkachu.com';
const CONCURRENCY = 8;

const HELP = `
Usage:
  fees.js [height|latest]           Total fees in one block (default: latest)
  fees.js <from>-<to>               Total fees across an inclusive height range
  fees.js --from <time> --to <time> Total fees across a UTC time range
  fees.js --rpc <url>               Tendermint RPC endpoint (default: ${DEFAULT_RPC})
  fees.js --help

Times accept YYYY-MM-DD or ISO-8601; naive values are treated as UTC.
Reads /block_results fee events, so failed transactions (which still pay) are
included and no off-chain indexer is required. Time ranges binary-search block
heights via /block header timestamps.
`;

export function parseTime(value) {
	let text = String(value).trim().replace(' ', 'T');
	if (/^\d{4}-\d{2}-\d{2}$/.test(text)) text += 'T00:00:00Z';
	else if (!/(Z|[+-]\d{2}:?\d{2})$/.test(text)) text += 'Z';
	const ms = Date.parse(text);
	if (Number.isNaN(ms)) {
		throw new Error(`Invalid time "${value}" (use YYYY-MM-DD or ISO-8601, UTC)`);
	}
	return ms;
}

export function parseHeightRange(value) {
	const match = /^(\d+)-(\d+)$/.exec(value);
	if (!match) return null;
	return { fromHeight: Number(match[1]), toHeight: Number(match[2]) };
}

export function parseFeeString(text) {
	const coins = [];
	for (const part of String(text).split(',')) {
		const match = /^(\d+)(.+)$/.exec(part.trim());
		if (match) coins.push([match[2], BigInt(match[1])]);
	}
	return coins;
}

function decodeAttr(raw) {
	if (!raw) return '';
	if (/[^A-Za-z0-9+/=]/.test(raw)) return raw;
	try {
		const buf = Buffer.from(raw, 'base64');
		if (buf.toString('base64') !== raw) return raw;
		new TextDecoder('utf-8', { fatal: true }).decode(buf);
		return buf.toString('utf-8');
	} catch {
		return raw;
	}
}

export function txFeeText(txResult) {
	let fallback = null;
	for (const event of txResult.events || []) {
		if (event.type !== 'tx' && event.type !== 'fee_pay') continue;
		const feeAttr = (event.attributes || []).find(attr => decodeAttr(attr.key || '') === 'fee');
		if (!feeAttr) continue;
		const value = decodeAttr(feeAttr.value || '');
		// ponytail: newer SDKs put fee on the tx event, older ones on fee_pay; prefer tx to avoid double-counting
		if (event.type === 'tx') return value;
		fallback = value;
	}
	return fallback;
}

export function sumFees(txResults, totals = new Map()) {
	let feeEvents = 0;
	for (const txResult of txResults) {
		const text = txFeeText(txResult);
		if (text == null) continue;
		feeEvents++;
		for (const [denom, amount] of parseFeeString(text)) {
			totals.set(denom, (totals.get(denom) || 0n) + amount);
		}
	}
	return { totals, feeEvents };
}

async function rpc(rpcUrl, path) {
	const response = await fetch(`${rpcUrl}${path}`);
	const payload = await response.json().catch(() => null);
	if (payload?.error) {
		const detail = payload.error.data ? `: ${payload.error.data}` : '';
		throw new Error(`RPC error (${path}): ${payload.error.message || JSON.stringify(payload.error)}${detail}`);
	}
	if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText} (${path})`);
	if (!payload) throw new Error(`Non-JSON response (${path})`);
	return payload.result;
}

async function latestHeight(rpcUrl) {
	const result = await rpc(rpcUrl, '/status');
	return Number(result.sync_info.latest_block_height);
}

async function blockTimeMs(rpcUrl, height) {
	const result = await rpc(rpcUrl, `/block?height=${height}`);
	return Date.parse(result.block.header.time);
}

async function firstHeightAtLeast(rpcUrl, targetMs, tip) {
	let lo = 1;
	let hi = tip;
	while (lo < hi) {
		const mid = Math.floor((lo + hi) / 2);
		let timeMs;
		try {
			timeMs = await blockTimeMs(rpcUrl, mid);
		} catch (error) {
			// ponytail: pruned heights form a prefix, so skip them; other errors are real
			if (!/not available|lowest height/.test(error.message)) throw error;
			lo = mid + 1;
			continue;
		}
		if (timeMs >= targetMs) hi = mid;
		else lo = mid + 1;
	}
	return lo;
}

export function parseArgs(argv) {
	const options = { rpc: DEFAULT_RPC, from: null, to: null, height: null, help: false };
	const positionals = [];
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		if (arg === '--rpc') options.rpc = argv[++i];
		else if (arg === '--from') options.from = argv[++i];
		else if (arg === '--to') options.to = argv[++i];
		else if (arg === '--help' || arg === '-h') options.help = true;
		else positionals.push(arg);
	}
	if (positionals.length > 1) throw new Error(`Unexpected arguments: ${positionals.slice(1).join(' ')}`);
	if (options.from || options.to) {
		if (positionals.length) throw new Error('Use either a positional height/range or --from/--to, not both');
	} else if (positionals.length) {
		const range = parseHeightRange(positionals[0]);
		if (range) {
			options.fromHeight = range.fromHeight;
			options.toHeight = range.toHeight;
		} else if (/^\d+$/.test(positionals[0])) {
			options.height = Number(positionals[0]);
		} else if (positionals[0] !== 'latest') {
			throw new Error(`Invalid height or range "${positionals[0]}"`);
		}
	}
	return options;
}

export async function resolveRange(rpcUrl, options) {
	const fromMs = options.from ? parseTime(options.from) : null;
	const toMs = options.to ? parseTime(options.to) : null;
	if (fromMs != null && toMs != null && fromMs > toMs) {
		throw new Error('--from must not be after --to');
	}
	const tip = await latestHeight(rpcUrl);
	if (options.fromHeight != null) {
		return { fromHeight: options.fromHeight, toHeight: options.toHeight, tip };
	}
	if (options.from || options.to) {
		// ponytail: without --from, start at the first height this node can serve
		const fromHeight = fromMs == null ? await firstHeightAtLeast(rpcUrl, 0, tip) : await firstHeightAtLeast(rpcUrl, fromMs, tip);
		// firstHeightAtLeast clamps to tip, so a future --from would silently scan the tip
		if (fromMs != null && (await blockTimeMs(rpcUrl, fromHeight)) < fromMs) {
			throw new Error('No blocks at or after --from (time is in the future or past the chain tip)');
		}
		let toHeight = tip;
		if (toMs != null) {
			const candidate = await firstHeightAtLeast(rpcUrl, toMs, tip);
			const candidateMs = await blockTimeMs(rpcUrl, candidate);
			toHeight = candidateMs > toMs ? candidate - 1 : candidate;
		}
		return { fromHeight, toHeight, tip };
	}
	const start = options.height == null ? tip : options.height;
	return { fromHeight: start, toHeight: start, tip };
}

async function scan(rpcUrl, fromHeight, toHeight) {
	const totals = new Map();
	let txCount = 0;
	let failedCount = 0;
	let feeEvents = 0;
	let blocks = 0;
	let lastReport = 0;
	const totalBlocks = toHeight - fromHeight + 1;

	for (let from = fromHeight; from <= toHeight; from += CONCURRENCY) {
		const heights = [];
		for (let h = from; h < from + CONCURRENCY && h <= toHeight; h++) heights.push(h);
		const pages = await Promise.all(heights.map(height => rpc(rpcUrl, `/block_results?height=${height}`)));
		for (const page of pages) {
			const txs = page.txs_results || [];
			const block = sumFees(txs, totals);
			txCount += txs.length;
			feeEvents += block.feeEvents;
			failedCount += txs.filter(tx => tx.code !== 0 && tx.code !== undefined).length;
			blocks++;
		}
		if (blocks - lastReport >= 100) {
			lastReport = blocks;
			process.stderr.write(`Scanned ${blocks}/${totalBlocks} blocks...\n`);
		}
	}

	return { totals, txCount, failedCount, feeEvents, blocks: totalBlocks };
}

async function main() {
	const options = parseArgs(process.argv.slice(2));
	if (options.help) {
		process.stdout.write(HELP);
		return;
	}
	const { fromHeight, toHeight, tip } = await resolveRange(options.rpc, options);
	if (toHeight < fromHeight || fromHeight < 1) throw new Error(`No blocks in range ${fromHeight}-${toHeight}`);

	const result = await scan(options.rpc, fromHeight, toHeight);
	const label = fromHeight === toHeight ? `Block ${fromHeight}${fromHeight === tip ? ' (latest)' : ''}` : `Blocks ${fromHeight}-${toHeight}`;
	console.log(`${label}: ${result.blocks} block(s)`);
	console.log(`Transactions: ${result.txCount} (${result.failedCount} failed, fees included; ${result.feeEvents} with fee events)`);
	console.log('Fees paid:');
	if (result.totals.size === 0) console.log('  (none)');
	for (const [denom, amount] of [...result.totals].sort((a, b) => a[0].localeCompare(b[0]))) {
		console.log(`  ${denom} ${amount}`);
	}
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	main().catch(error => {
		console.error(`Error: ${error.message}`);
		process.exit(1);
	});
}
