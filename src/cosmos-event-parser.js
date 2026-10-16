#!/usr/bin/env node

import { resolveLcd } from './cli-args.js';

export class CosmosEventParser {
	constructor(options = {}) {
		this.baseUrl = (options.baseUrl || 'https://lcd.osmosis.zone').replace(/\/+$/, '');
		this.chain = options.chain || 'osmosis';
		this.rateLimitDelay = options.rateLimitDelay || 1000;
		this.pageLimit = options.pageLimit || 100;
		this.maxPages = options.maxPages || null;
	}

	async sleep(ms) {
		return new Promise(resolve => setTimeout(resolve, ms));
	}

	/**
	 * Builds a CometBFT query string from filter params, joined with AND.
	 * Cross-event AND never matches (see docs/query-capabilities.md), so keep
	 * conditions on a single event type.
	 * @returns {string}
	 */
	buildEventQuery(params) {
		const conditions = [];
		
		if (params.sender) {
			conditions.push(`message.sender='${params.sender}'`);
		}
		if (params.action) {
			conditions.push(`message.action='${params.action}'`);
		}
		if (params.module) {
			conditions.push(`message.module='${params.module}'`);
		}
		if (params.recipient) {
			conditions.push(`transfer.recipient='${params.recipient}'`);
		}
		if (params.amount) {
			conditions.push(`transfer.amount='${params.amount}'`);
		}
		if (params.denom) {
			conditions.push(`coin_spent.denom='${params.denom}'`);
		}
		if (params.sourceChannel) {
			conditions.push(`send_packet.packet_src_channel='${params.sourceChannel}'`);
		}
		if (params.destChannel) {
			conditions.push(`send_packet.packet_dst_channel='${params.destChannel}'`);
		}
		
		// Add custom events
		if (params.customEvents) {
			Object.entries(params.customEvents).forEach(([key, value]) => {
				conditions.push(`${key}='${value}'`);
			});
		}
		
		return conditions.join(' AND ');
	}

	async fetchWithRetry(url, retries = 3) {
		for (let i = 0; i < retries; i++) {
			try {
				const response = await fetch(url);
				if (!response.ok) {
					throw new Error(`HTTP ${response.status}: ${response.statusText}`);
				}
				return await response.json();
			} catch (error) {
				console.error(`Attempt ${i + 1} failed:`, error.message);
				if (i < retries - 1) {
					await this.sleep(this.rateLimitDelay * (i + 1));
				} else {
					throw error;
				}
			}
		}
	}

	async fetchTransactions(params = {}) {
		const transactions = [];
		let page = 1;
		let hasMore = true;
		
		while (hasMore && (!this.maxPages || page <= this.maxPages)) {
			const query = this.buildEventQuery(params);
			const url = new URL(`${this.baseUrl}/cosmos/tx/v1beta1/txs`);
			// ponytail: `query` is the current SDK param (v0.50+); pre-v0.47 chains used `events=`
			if (query) url.searchParams.set('query', query);
			url.searchParams.set('pagination.limit', String(this.pageLimit));
			url.searchParams.set('pagination.page', String(page));
			url.searchParams.set('order_by', 'ORDER_BY_DESC');
			
			console.log(`Fetching page ${page}...`);
			
			try {
				const response = await this.fetchWithRetry(url);
				
				if (response.txs && response.txs.length > 0) {
					transactions.push(...response.txs);
					console.log(`Found ${response.txs.length} transactions on page ${page}`);
				}
				
				// Check if there are more pages
				if (!response.pagination || 
					!response.pagination.next_key || 
					response.txs.length < this.pageLimit) {
					hasMore = false;
				}
				
				page++;
				
				// Rate limiting
				if (hasMore) {
					await this.sleep(this.rateLimitDelay);
				}
			} catch (error) {
				console.error(`Failed to fetch page ${page}:`, error.message);
				hasMore = false;
			}
		}
		
		return transactions;
	}

	parseTransaction(tx) {
		const parsed = {
			hash: tx.txhash,
			height: tx.height,
			timestamp: tx.timestamp,
			code: tx.code || 0,
			success: !tx.code || tx.code === 0,
			messages: [],
			events: [],
			memo: tx.tx?.body?.memo || '',
			fee: tx.tx?.auth_info?.fee || {},
			gas: {
				wanted: tx.gas_wanted,
				used: tx.gas_used
			}
		};
		
		// Parse messages
		if (tx.tx?.body?.messages) {
			parsed.messages = tx.tx.body.messages.map(msg => ({
				type: msg['@type'],
				data: msg
			}));
		}
		
		// Parse events from logs
		if (tx.logs) {
			tx.logs.forEach(log => {
				if (log.events) {
					log.events.forEach(event => {
						const parsedEvent = {
							type: event.type,
							attributes: {}
						};
						
						event.attributes.forEach(attr => {
							parsedEvent.attributes[attr.key] = attr.value;
						});
						
						parsed.events.push(parsedEvent);
					});
				}
			});
		}
		
		return parsed;
	}

	async findTransfersToAddress(address, additionalParams = {}) {
		console.log(`Finding transfers to address: ${address}`);
		
		const params = {
			...additionalParams,
			recipient: address
		};
		
		const transactions = await this.fetchTransactions(params);
		const transfers = [];
		
		transactions.forEach(tx => {
			const parsed = this.parseTransaction(tx);
			
			// Look for transfer events
			parsed.events.forEach(event => {
				if (event.type === 'transfer' && event.attributes.recipient === address) {
					transfers.push({
						txHash: parsed.hash,
						height: parsed.height,
						timestamp: parsed.timestamp,
						sender: event.attributes.sender,
						recipient: event.attributes.recipient,
						amount: event.attributes.amount,
						success: parsed.success,
						memo: parsed.memo
					});
				}
			});
			
			// Also check messages for bank sends
			parsed.messages.forEach(msg => {
				if (msg.type === '/cosmos.bank.v1beta1.MsgSend' && 
					msg.data.to_address === address) {
					transfers.push({
						txHash: parsed.hash,
						height: parsed.height,
						timestamp: parsed.timestamp,
						sender: msg.data.from_address,
						recipient: msg.data.to_address,
						amount: msg.data.amount.map(a => `${a.amount}${a.denom}`).join(','),
						success: parsed.success,
						memo: parsed.memo
					});
				}
			});
		});
		
		// Remove duplicates
		const uniqueTransfers = transfers.filter((transfer, index, self) =>
			index === self.findIndex(t => t.txHash === transfer.txHash && 
				t.sender === transfer.sender && 
				t.recipient === transfer.recipient)
		);
		
		return uniqueTransfers;
	}

	async queryMultipleEventTypes(queries) {
		const results = {};
		
		for (const [name, params] of Object.entries(queries)) {
			console.log(`\nQuerying ${name}...`);
			try {
				results[name] = await this.fetchTransactions(params);
				console.log(`Found ${results[name].length} transactions for ${name}`);
			} catch (error) {
				console.error(`Failed to query ${name}:`, error.message);
				results[name] = [];
			}
			
			// Rate limiting between queries
			await this.sleep(this.rateLimitDelay);
		}
		
		return results;
	}

	async getAddressActivity(address) {
		console.log(`Getting complete activity for address: ${address}`);
		
		const activity = await this.queryMultipleEventTypes({
			sent: {
				sender: address,
				action: '/cosmos.bank.v1beta1.MsgSend'
			},
			received: {
				recipient: address
			},
			delegations: {
				sender: address,
				action: '/cosmos.staking.v1beta1.MsgDelegate'
			},
			undelegations: {
				sender: address,
				action: '/cosmos.staking.v1beta1.MsgUndelegate'
			},
			rewards: {
				sender: address,
				action: '/cosmos.distribution.v1beta1.MsgWithdrawDelegatorReward'
			},
			ibcSent: {
				sender: address,
				action: '/ibc.applications.transfer.v1.MsgTransfer'
			}
		});
		
		// Process received transfers separately to get detailed info
		activity.received = await this.findTransfersToAddress(address);
		
		return activity;
	}
}

// CLI interface
if (import.meta.url === `file://${process.argv[1]}`) {
	const args = process.argv.slice(2);

	if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
		console.log(`
Usage:
  cosmos-event-parser.js <address>                    - Get all activity for an address
  cosmos-event-parser.js --received <address>         - Find all transfers received by address
  cosmos-event-parser.js --sent <address>             - Find all transfers sent by address
  cosmos-event-parser.js --failed <address>           - Find failed transactions from address

Options:
  --lcd <url>    Cosmos LCD/REST endpoint (default: https://lcd.osmosis.zone,
                 or the COSMOS_LCD environment variable)

Examples:
  cosmos-event-parser.js osmo1...
  cosmos-event-parser.js --lcd https://lcd.osmosis.zone --received osmo1...
		`);
		process.exit(0);
	}

	let baseUrl;
	try {
		baseUrl = resolveLcd(args);
	} catch (error) {
		console.error(`Error: ${error.message}`);
		process.exit(1);
	}

	const parser = new CosmosEventParser({
		baseUrl,
		rateLimitDelay: 1000,
		pageLimit: 50,
		maxPages: 10
	});
	
	async function run() {
		try {
			if (args[0] === '--received' && args[1]) {
				const transfers = await parser.findTransfersToAddress(args[1]);
				console.log(`\nFound ${transfers.length} incoming transfers:`);
				transfers.forEach(t => {
					console.log(`${t.timestamp} | ${t.sender} -> ${t.amount} | ${t.txHash}`);
				});
			} else if (args[0] === '--sent' && args[1]) {
				const txs = await parser.fetchTransactions({
					sender: args[1],
					action: '/cosmos.bank.v1beta1.MsgSend'
				});
				console.log(`\nFound ${txs.length} sent transactions`);
				txs.forEach(tx => {
					const parsed = parser.parseTransaction(tx);
					console.log(`${parsed.timestamp} | ${parsed.success ? 'SUCCESS' : 'FAILED'} | ${parsed.hash}`);
				});
			} else if (args[0] === '--failed' && args[1]) {
				const txs = await parser.fetchTransactions({ sender: args[1] });
				const failed = txs.filter(tx => tx.code && tx.code !== 0);
				console.log(`\nFound ${failed.length} failed transactions:`);
				failed.forEach(tx => {
					const parsed = parser.parseTransaction(tx);
					console.log(`${parsed.timestamp} | Code: ${tx.code} | ${parsed.hash}`);
				});
			} else {
				const activity = await parser.getAddressActivity(args[0]);
				console.log('\n=== Address Activity Summary ===');
				console.log(`Sent: ${activity.sent.length} transactions`);
				console.log(`Received: ${activity.received.length} transfers`);
				console.log(`Delegations: ${activity.delegations.length}`);
				console.log(`Undelegations: ${activity.undelegations.length}`);
				console.log(`Rewards claimed: ${activity.rewards.length}`);
				console.log(`IBC transfers: ${activity.ibcSent.length}`);
			}
		} catch (error) {
			console.error('Error:', error.message);
			process.exit(1);
		}
	}
	
	run();
}