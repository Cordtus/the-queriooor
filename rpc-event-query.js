#!/usr/bin/env node

import fetch from 'node-fetch';

/**
 * Known Cosmos event types and their queryable attributes.
 * Indexed attributes vary by node configuration -- these are commonly available.
 * @type {Record<string, { label: string, attributes: Record<string, string> }>}
 */
export const EVENT_CATALOG = {
	message: {
		label: 'Message',
		attributes: {
			action: 'Message type (e.g. /cosmos.bank.v1beta1.MsgSend)',
			module: 'Module name (bank, staking, ibc_client, etc.)',
			sender: 'Transaction signer address',
		},
	},
	transfer: {
		label: 'Transfer',
		attributes: {
			recipient: 'Receiving address',
			sender: 'Sending address',
			amount: 'Amount with denom (e.g. 1000uosmo)',
		},
	},
	coin_spent: {
		label: 'Coin Spent',
		attributes: {
			spender: 'Address that spent coins',
			amount: 'Amount spent',
		},
	},
	coin_received: {
		label: 'Coin Received',
		attributes: {
			receiver: 'Address that received coins',
			amount: 'Amount received',
		},
	},
	tx: {
		label: 'Transaction',
		attributes: {
			acc_seq: 'Account/sequence (e.g. osmo1.../42)',
			fee: 'Fee amount',
			signature: 'Transaction signature',
		},
	},
	// IBC
	recv_packet: {
		label: 'IBC Recv Packet',
		attributes: {
			packet_src_channel: 'Source channel (e.g. channel-2)',
			packet_dst_channel: 'Destination channel (e.g. channel-129)',
			packet_src_port: 'Source port (usually transfer)',
			packet_dst_port: 'Destination port (usually transfer)',
			packet_sequence: 'Packet sequence number',
			packet_connection: 'Connection ID',
			connection_id: 'Connection ID (alias)',
		},
	},
	send_packet: {
		label: 'IBC Send Packet',
		attributes: {
			packet_src_channel: 'Source channel',
			packet_dst_channel: 'Destination channel',
			packet_src_port: 'Source port',
			packet_dst_port: 'Destination port',
			packet_sequence: 'Packet sequence number',
			packet_connection: 'Connection ID',
		},
	},
	acknowledge_packet: {
		label: 'IBC Acknowledge Packet',
		attributes: {
			packet_src_channel: 'Source channel',
			packet_dst_channel: 'Destination channel',
			packet_connection: 'Connection ID',
			packet_sequence: 'Packet sequence number',
		},
	},
	write_acknowledgement: {
		label: 'IBC Write Acknowledgement',
		attributes: {
			packet_src_channel: 'Source channel',
			packet_dst_channel: 'Destination channel',
			packet_dst_port: 'Destination port',
			packet_src_port: 'Source port',
			packet_sequence: 'Packet sequence number',
			packet_connection: 'Connection ID',
			connection_id: 'Connection ID (alias)',
		},
	},
	fungible_token_packet: {
		label: 'IBC Fungible Token',
		attributes: {
			receiver: 'Receiver address',
			sender: 'Sender address',
			denom: 'Token denom (source chain, e.g. ugraviton)',
			amount: 'Token amount (micro units)',
			module: 'Module (transfer)',
			success: 'Whether transfer succeeded (true/false)',
		},
	},
	denomination_trace: {
		label: 'IBC Denomination Trace',
		attributes: {
			denom: 'IBC denom on destination chain',
			trace_hash: 'Denomination trace hash',
		},
	},
	update_client: {
		label: 'IBC Update Client',
		attributes: {
			client_id: 'Client ID (e.g. 07-tendermint-1718)',
			client_type: 'Client type',
			consensus_height: 'Consensus height',
		},
	},
	// Staking
	delegate: {
		label: 'Delegate',
		attributes: {
			validator: 'Validator operator address',
			amount: 'Delegation amount',
		},
	},
	unbond: {
		label: 'Unbond',
		attributes: {
			validator: 'Validator operator address',
			amount: 'Unbonding amount',
			completion_time: 'Unbonding completion time',
		},
	},
	redelegate: {
		label: 'Redelegate',
		attributes: {
			source_validator: 'Source validator',
			destination_validator: 'Destination validator',
			amount: 'Redelegation amount',
		},
	},
	withdraw_rewards: {
		label: 'Withdraw Rewards',
		attributes: {
			validator: 'Validator operator address',
			amount: 'Reward amount',
		},
	},
	// Governance
	proposal_vote: {
		label: 'Governance Vote',
		attributes: {
			proposal_id: 'Proposal ID',
			option: 'Vote option',
			voter: 'Voter address',
		},
	},
	// DEX / Osmosis-specific
	token_swapped: {
		label: 'Token Swap',
		attributes: {
			pool_id: 'Pool ID',
			sender: 'Swapper address',
			tokens_in: 'Input tokens',
			tokens_out: 'Output tokens',
			module: 'Module name',
		},
	},
	// CosmWasm
	wasm: {
		label: 'WASM Contract',
		attributes: {
			_contract_address: 'Contract address',
			action: 'Contract action',
			sender: 'Sender address',
			recipient: 'Recipient address',
			amount: 'Amount',
			denom: 'Denom',
		},
	},
};

/**
 * Common Cosmos RPC endpoints with labels.
 * @type {Array<{ label: string, url: string }>}
 */
export const KNOWN_ENDPOINTS = [
	{ label: 'Osmosis Archive', url: 'https://rpc.archive.osmosis.zone' },
	{ label: 'Osmosis (Polkachu)', url: 'https://osmosis-rpc.polkachu.com' },
	{ label: 'Osmosis (Lavender.Five)', url: 'https://rpc.lavenderfive.com:443/osmosis' },
	{ label: 'Cosmos Hub (Polkachu)', url: 'https://cosmos-rpc.polkachu.com' },
	{ label: 'Cosmos Hub Archive', url: 'https://rpc-cosmoshub.ecostake.com' },
];

/**
 * Builds and executes Tendermint RPC /tx_search queries.
 */
export class RpcEventQuery {
	/**
	 * @param {object} options
	 * @param {string} options.rpcUrl - Tendermint RPC endpoint
	 * @param {number} [options.perPage=100] - Results per page (max 100 for RPC)
	 * @param {number} [options.maxPages=50] - Maximum pages to fetch when paginating
	 * @param {number} [options.rateLimitDelay=500] - Delay between paginated requests in ms
	 */
	constructor(options = {}) {
		this.rpcUrl = (options.rpcUrl || KNOWN_ENDPOINTS[0].url).replace(/\/+$/, '');
		this.perPage = Math.min(options.perPage || 100, 100);
		this.maxPages = options.maxPages ?? 50;
		this.rateLimitDelay = options.rateLimitDelay ?? 500;
	}

	/**
	 * Builds a Tendermint query string from an array of conditions.
	 * Each condition is { eventType, attribute, value }.
	 * Produces: "eventType.attribute='value' AND eventType2.attribute2='value2'"
	 * @param {Array<{ eventType: string, attribute: string, value: string }>} conditions
	 * @returns {string}
	 */
	buildQuery(conditions) {
		return conditions
			.filter(c => c.eventType && c.attribute && c.value)
			.map(c => `${c.eventType}.${c.attribute}='${c.value}'`)
			.join(' AND ');
	}

	/**
	 * Attempts to decode a base64 string, returning the original if it's already plaintext.
	 * Older CometBFT (<0.38) base64-encodes attributes; newer versions send plaintext.
	 * Uses a round-trip check to avoid corrupting plaintext that happens to only contain
	 * characters valid in base64 (e.g. "recipient", "sender", "amount").
	 * @param {string} raw
	 * @returns {string}
	 */
	static tryDecodeBase64Node(raw) {
		if (!raw) return '';
		// If it contains characters outside the base64 alphabet, it's plaintext
		if (/[^A-Za-z0-9+/=]/.test(raw)) return raw;
		try {
			const buf = Buffer.from(raw, 'base64');
			// Round-trip check: if re-encoding doesn't match, it wasn't real base64
			if (buf.toString('base64') !== raw) return raw;
			// Strict UTF-8 validation: rejects plaintext words like "transfer" that
			// happen to be valid base64 but decode to invalid UTF-8 byte sequences
			new TextDecoder('utf-8', { fatal: true }).decode(buf);
			return buf.toString('utf-8');
		} catch {
			return raw;
		}
	}

	/**
	 * Decodes event attributes from RPC responses.
	 * Handles both base64-encoded (CometBFT <0.38) and plaintext (>=0.38) formats.
	 * @param {Array<{ key: string, value: string }>} attributes
	 * @returns {Record<string, string>}
	 */
	decodeAttributes(attributes) {
		const decoded = {};
		for (const attr of attributes) {
			const key = RpcEventQuery.tryDecodeBase64Node(attr.key || '');
			const value = RpcEventQuery.tryDecodeBase64Node(attr.value || '');
			decoded[key] = value;
		}
		return decoded;
	}

	/**
	 * Parses a raw RPC transaction result into a structured object.
	 * @param {object} tx - Raw tx object from /tx_search result
	 * @returns {object} Parsed transaction
	 */
	parseTx(tx) {
		const txResult = tx.tx_result || {};
		const events = (txResult.events || []).map(ev => ({
			type: ev.type,
			attributes: this.decodeAttributes(ev.attributes || []),
		}));

		return {
			hash: tx.hash,
			height: parseInt(tx.height, 10),
			code: txResult.code || 0,
			success: !txResult.code || txResult.code === 0,
			gasWanted: txResult.gas_wanted,
			gasUsed: txResult.gas_used,
			events,
			log: txResult.log || '',
		};
	}

	/**
	 * Executes a single-page /tx_search request.
	 * @param {string} query - Tendermint query string
	 * @param {object} [options]
	 * @param {number} [options.page=1] - Page number (1-indexed)
	 * @param {number} [options.perPage] - Results per page
	 * @param {'asc'|'desc'} [options.orderBy='desc'] - Sort order
	 * @returns {Promise<{ txs: object[], totalCount: number }>}
	 */
	async searchPage(query, options = {}) {
		const page = options.page || 1;
		const perPage = Math.min(options.perPage || this.perPage, 100);
		const orderBy = options.orderBy || 'desc';

		const params = new URLSearchParams({
			query: `"${query}"`,
			per_page: String(perPage),
			page: String(page),
			order_by: `"${orderBy}"`,
		});

		const url = `${this.rpcUrl}/tx_search?${params}`;
		const response = await fetch(url);

		if (!response.ok) {
			throw new Error(`RPC error: ${response.status} ${response.statusText}`);
		}

		const data = await response.json();

		if (data.error) {
			throw new Error(`RPC query error: ${data.error.message || JSON.stringify(data.error)}`);
		}

		const result = data.result || {};
		return {
			txs: (result.txs || []).map(tx => this.parseTx(tx)),
			totalCount: parseInt(result.total_count || '0', 10),
		};
	}

	/**
	 * Fetches all pages for a query, respecting maxPages and rate limits.
	 * @param {string} query - Tendermint query string
	 * @param {object} [options]
	 * @param {'asc'|'desc'} [options.orderBy='desc'] - Sort order
	 * @param {function} [options.onPage] - Callback per page: (pageNum, txs, totalCount) => void
	 * @returns {Promise<{ txs: object[], totalCount: number }>}
	 */
	async searchAll(query, options = {}) {
		const allTxs = [];
		let page = 1;
		let totalCount = 0;

		while (page <= this.maxPages) {
			const result = await this.searchPage(query, {
				page,
				orderBy: options.orderBy || 'desc',
			});

			totalCount = result.totalCount;
			allTxs.push(...result.txs);

			if (options.onPage) {
				options.onPage(page, result.txs, totalCount);
			}

			const totalPages = Math.ceil(totalCount / this.perPage);
			if (page >= totalPages) break;

			page++;
			await new Promise(resolve => setTimeout(resolve, this.rateLimitDelay));
		}

		return { txs: allTxs, totalCount };
	}

	/**
	 * Convenience: search by conditions array instead of raw query string.
	 * @param {Array<{ eventType: string, attribute: string, value: string }>} conditions
	 * @param {object} [options] - Same options as searchPage
	 * @returns {Promise<{ txs: object[], totalCount: number }>}
	 */
	async search(conditions, options = {}) {
		const query = this.buildQuery(conditions);
		if (!query) {
			throw new Error('At least one complete condition is required');
		}
		return this.searchPage(query, options);
	}
}

// CLI interface
if (typeof process !== 'undefined' && import.meta.url === `file://${process.argv[1]}`) {
	const args = process.argv.slice(2);

	if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
		console.log(`
Cosmos RPC Event Query - Search transactions via Tendermint RPC /tx_search

Usage:
  rpc-event-query.js --query "event.attr='value' AND event2.attr2='value2'"
  rpc-event-query.js --event transfer --attr recipient --value <address>
  rpc-event-query.js --event fungible_token_packet --attr receiver --value <address>

Options:
  --rpc <url>          RPC endpoint (default: ${KNOWN_ENDPOINTS[0].url})
  --query <string>     Raw Tendermint query string
  --event <type>       Event type (e.g. transfer, recv_packet)
  --attr <name>        Attribute name (e.g. recipient, packet_dst_channel)
  --value <val>        Attribute value
  --per-page <n>       Results per page, max 100 (default: 100)
  --page <n>           Page number (default: 1)
  --order <asc|desc>   Sort order (default: desc)
  --all                Fetch all pages
  --json               Output raw JSON

Event Types:
${Object.entries(EVENT_CATALOG).map(([k, v]) => `  ${k.padEnd(28)} ${v.label}`).join('\n')}
		`);
		process.exit(0);
	}

	function getArg(flag) {
		const idx = args.indexOf(flag);
		return idx !== -1 && args[idx + 1] ? args[idx + 1] : null;
	}

	const rpcUrl = getArg('--rpc') || KNOWN_ENDPOINTS[0].url;
	const client = new RpcEventQuery({
		rpcUrl,
		perPage: parseInt(getArg('--per-page') || '100', 10),
	});

	const rawQuery = getArg('--query');
	const eventType = getArg('--event');
	const attr = getArg('--attr');
	const value = getArg('--value');
	const page = parseInt(getArg('--page') || '1', 10);
	const orderBy = getArg('--order') || 'desc';
	const fetchAll = args.includes('--all');
	const jsonOut = args.includes('--json');

	const query = rawQuery || client.buildQuery([{ eventType, attribute: attr, value }]);

	if (!query) {
		console.error('Error: provide --query or --event/--attr/--value');
		process.exit(1);
	}

	console.log(`Query: ${query}`);
	console.log(`Endpoint: ${rpcUrl}\n`);

	async function run() {
		try {
			if (fetchAll) {
				const result = await client.searchAll(query, {
					orderBy,
					onPage: (p, txs, total) => {
						console.log(`Page ${p}: ${txs.length} txs (${total} total)`);
					},
				});
				if (jsonOut) {
					console.log(JSON.stringify(result, null, 2));
				} else {
					printResults(result);
				}
			} else {
				const result = await client.searchPage(query, { page, orderBy });
				if (jsonOut) {
					console.log(JSON.stringify(result, null, 2));
				} else {
					printResults(result, page);
				}
			}
		} catch (error) {
			console.error('Error:', error.message);
			process.exit(1);
		}
	}

	function printResults(result, page) {
		const totalPages = Math.ceil(result.totalCount / client.perPage);
		console.log(`\nTotal: ${result.totalCount} transactions`);
		if (page) {
			console.log(`Page ${page} of ${totalPages}`);
		}
		console.log('─'.repeat(80));

		for (const tx of result.txs) {
			console.log(`\n  Height: ${tx.height}  |  ${tx.success ? 'OK' : 'FAILED (code ' + tx.code + ')'}`);
			console.log(`  Hash:   ${tx.hash}`);
			console.log(`  Gas:    ${tx.gasUsed} / ${tx.gasWanted}`);

			for (const ev of tx.events) {
				// Skip noisy event types in display
				if (['tx', 'message', 'coin_spent', 'coin_received', 'coinbase'].includes(ev.type)) continue;
				const attrStr = Object.entries(ev.attributes)
					.filter(([k]) => k !== 'msg_index')
					.map(([k, v]) => {
						const display = v.length > 80 ? v.slice(0, 77) + '...' : v;
						return `${k}=${display}`;
					})
					.join(', ');
				if (attrStr) {
					console.log(`  ${ev.type}: ${attrStr}`);
				}
			}
		}
	}

	run();
}
