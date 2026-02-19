#!/usr/bin/env node

import { CosmosEventParser } from './cosmos-event-parser.js';

// Common IBC token configurations for Osmosis
const IBC_TOKENS = {
	// ATOM
	atom: {
		denom: 'ibc/27394FB092D2ECCD56123C74F36E4C1F926001CEADA9CA97EA622B25F41E5EB2',
		symbol: 'ATOM',
		decimals: 6,
		minWhaleAmount: 1000 // 1000 ATOM
	},
	// USDC (from Noble)
	usdc: {
		denom: 'ibc/498A0751C798A0D9A389AA3691123DADA57DAA4FE165D5C75894505B876BA6E4',
		symbol: 'USDC',
		decimals: 6,
		minWhaleAmount: 10000 // 10,000 USDC
	},
	// JUNO
	juno: {
		denom: 'ibc/46B44899322F3CD854D2D46DEEF881958467CDD4B3B10086DA49296BBED94BED',
		symbol: 'JUNO',
		decimals: 6,
		minWhaleAmount: 5000 // 5,000 JUNO
	},
	// STARS
	stars: {
		denom: 'ibc/987C17B11ABC2B20019178ACE62929FE9840202CE79498E29FE8E5CB02B7C0A4',
		symbol: 'STARS',
		decimals: 6,
		minWhaleAmount: 100000 // 100,000 STARS
	},
	// SCRT
	scrt: {
		denom: 'ibc/0954E1C28EB7AF5B72D24F3BC2B47BBB2FDF91BDDFD57B74B99E133AED40972A',
		symbol: 'SCRT',
		decimals: 6,
		minWhaleAmount: 10000 // 10,000 SCRT
	},
	// EVMOS
	evmos: {
		denom: 'ibc/6AE98883D4D5D5FF9E50D7130F1305DA2FFA0C652D1DD9C123657C6B4EB2DF8A',
		symbol: 'EVMOS',
		decimals: 18,
		minWhaleAmount: 10000 // 10,000 EVMOS
	},
	// OSMO (native)
	osmo: {
		denom: 'uosmo',
		symbol: 'OSMO',
		decimals: 6,
		minWhaleAmount: 10000 // 10,000 OSMO
	}
};

class WhaleWatcher {
	constructor(options = {}) {
		this.parser = new CosmosEventParser({
			baseUrl: options.baseUrl || 'https://rest.lavenderfive.com:443',
			chain: 'osmosis',
			rateLimitDelay: options.rateLimitDelay || 2000,
			pageLimit: options.pageLimit || 100,
			maxPages: options.maxPages || 5
		});
		
		this.tokens = options.tokens || IBC_TOKENS;
		this.customThresholds = options.customThresholds || {};
		this.checkInterval = options.checkInterval || 60000; // 1 minute default
		this.notifyCallback = options.notifyCallback || this.defaultNotify;
	}

	defaultNotify(whaleTransfer) {
		console.log('\n🐋 WHALE ALERT 🐋');
		console.log(`Token: ${whaleTransfer.symbol}`);
		console.log(`Amount: ${whaleTransfer.formattedAmount}`);
		console.log(`From: ${whaleTransfer.from}`);
		console.log(`To: ${whaleTransfer.to}`);
		console.log(`Tx: ${whaleTransfer.txHash}`);
		console.log(`Time: ${whaleTransfer.timestamp}`);
		console.log('─'.repeat(50));
	}

	formatAmount(amount, decimals) {
		const divisor = Math.pow(10, decimals);
		return (parseInt(amount) / divisor).toLocaleString();
	}

	isWhaleTransfer(amount, tokenConfig) {
		const minAmount = this.customThresholds[tokenConfig.symbol] || tokenConfig.minWhaleAmount;
		const actualAmount = parseInt(amount) / Math.pow(10, tokenConfig.decimals);
		return actualAmount >= minAmount;
	}

	async checkToken(tokenKey, tokenConfig) {
		console.log(`Checking ${tokenConfig.symbol} transfers...`);
		
		try {
			// Query bank sends with the specific denom
			const txs = await this.parser.fetchTransactions({
				action: '/cosmos.bank.v1beta1.MsgSend',
				customEvents: {
					'coin_spent.denom': tokenConfig.denom
				}
			});
			
			const whaleTransfers = [];
			
			txs.forEach(tx => {
				const parsed = this.parser.parseTransaction(tx);
				
				// Check messages for transfers
				parsed.messages.forEach(msg => {
					if (msg.type === '/cosmos.bank.v1beta1.MsgSend') {
						const tokenAmount = msg.data.amount?.find(a => a.denom === tokenConfig.denom);
						
						if (tokenAmount && this.isWhaleTransfer(tokenAmount.amount, tokenConfig)) {
							whaleTransfers.push({
								symbol: tokenConfig.symbol,
								from: msg.data.from_address,
								to: msg.data.to_address,
								amount: tokenAmount.amount,
								formattedAmount: this.formatAmount(tokenAmount.amount, tokenConfig.decimals),
								denom: tokenConfig.denom,
								txHash: parsed.hash,
								timestamp: parsed.timestamp,
								height: parsed.height
							});
						}
					}
				});
				
				// Also check IBC transfers
				parsed.messages.forEach(msg => {
					if (msg.type === '/ibc.applications.transfer.v1.MsgTransfer') {
						const tokenAmount = msg.data.token;
						
						if (tokenAmount?.denom === tokenConfig.denom && 
							this.isWhaleTransfer(tokenAmount.amount, tokenConfig)) {
							whaleTransfers.push({
								symbol: tokenConfig.symbol,
								from: msg.data.sender,
								to: `${msg.data.receiver} (via IBC)`,
								amount: tokenAmount.amount,
								formattedAmount: this.formatAmount(tokenAmount.amount, tokenConfig.decimals),
								denom: tokenConfig.denom,
								txHash: parsed.hash,
								timestamp: parsed.timestamp,
								height: parsed.height,
								ibcTransfer: true,
								destChannel: msg.data.source_channel
							});
						}
					}
				});
			});
			
			return whaleTransfers;
		} catch (error) {
			console.error(`Error checking ${tokenConfig.symbol}:`, error.message);
			return [];
		}
	}

	async checkAllTokens() {
		const allWhaleTransfers = [];
		
		for (const [tokenKey, tokenConfig] of Object.entries(this.tokens)) {
			const transfers = await this.checkToken(tokenKey, tokenConfig);
			allWhaleTransfers.push(...transfers);
			
			// Rate limiting between token checks
			await this.parser.sleep(this.parser.rateLimitDelay);
		}
		
		// Sort by timestamp
		allWhaleTransfers.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
		
		return allWhaleTransfers;
	}

	async watchContinuously() {
		console.log('Starting whale watcher...');
		console.log(`Monitoring ${Object.keys(this.tokens).length} tokens`);
		console.log(`Check interval: ${this.checkInterval / 1000} seconds\n`);
		
		// Track seen transactions to avoid duplicates
		const seenTxs = new Set();
		
		while (true) {
			try {
				const whaleTransfers = await this.checkAllTokens();
				
				// Filter out already seen transactions
				const newTransfers = whaleTransfers.filter(t => {
					if (seenTxs.has(t.txHash)) {
						return false;
					}
					seenTxs.add(t.txHash);
					return true;
				});
				
				// Notify for new transfers
				newTransfers.forEach(transfer => {
					this.notifyCallback(transfer);
				});
				
				if (newTransfers.length === 0) {
					console.log(`No new whale transfers found at ${new Date().toLocaleString()}`);
				}
				
				// Clean up old transactions (keep last 1000)
				if (seenTxs.size > 1000) {
					const txArray = Array.from(seenTxs);
					txArray.splice(0, txArray.length - 1000).forEach(tx => seenTxs.delete(tx));
				}
				
			} catch (error) {
				console.error('Error during check:', error.message);
			}
			
			// Wait for next check
			await this.parser.sleep(this.checkInterval);
		}
	}

	async getRecentWhales(hours = 24) {
		console.log(`Finding whale transfers from the last ${hours} hours...`);
		
		const whaleTransfers = await this.checkAllTokens();
		const cutoffTime = new Date(Date.now() - hours * 60 * 60 * 1000);
		
		return whaleTransfers.filter(t => new Date(t.timestamp) > cutoffTime);
	}
}

// CLI interface
if (import.meta.url === `file://${process.argv[1]}`) {
	const args = process.argv.slice(2);
	
	if (args.includes('--help') || args.includes('-h')) {
		console.log(`
Osmosis Whale Watcher - Monitor large transfers of multiple IBC tokens

Usage:
  whale-watcher.js                     - Start continuous monitoring
  whale-watcher.js --once              - Check once and exit
  whale-watcher.js --hours <n>         - Get whales from last n hours
  whale-watcher.js --token <symbol>    - Monitor specific token only
  whale-watcher.js --threshold <token> <amount> - Set custom threshold

Examples:
  whale-watcher.js                     # Monitor all tokens continuously
  whale-watcher.js --once              # Single check of all tokens
  whale-watcher.js --hours 6           # Get whales from last 6 hours
  whale-watcher.js --token ATOM        # Monitor only ATOM
  whale-watcher.js --threshold OSMO 50000  # Alert on OSMO transfers > 50k

Monitored tokens:
${Object.entries(IBC_TOKENS).map(([k, v]) => `  ${v.symbol}: ${v.minWhaleAmount.toLocaleString()} ${v.symbol}`).join('\n')}
		`);
		process.exit(0);
	}
	
	// Parse command line options
	const options = {
		tokens: { ...IBC_TOKENS }
	};
	
	// Check for specific token
	const tokenIndex = args.indexOf('--token');
	if (tokenIndex !== -1 && args[tokenIndex + 1]) {
		const symbol = args[tokenIndex + 1].toUpperCase();
		const tokenEntry = Object.entries(IBC_TOKENS).find(([k, v]) => v.symbol === symbol);
		if (tokenEntry) {
			options.tokens = { [tokenEntry[0]]: tokenEntry[1] };
		} else {
			console.error(`Unknown token: ${symbol}`);
			process.exit(1);
		}
	}
	
	// Check for custom threshold
	const thresholdIndex = args.indexOf('--threshold');
	if (thresholdIndex !== -1 && args[thresholdIndex + 1] && args[thresholdIndex + 2]) {
		const symbol = args[thresholdIndex + 1].toUpperCase();
		const amount = parseFloat(args[thresholdIndex + 2]);
		options.customThresholds = { [symbol]: amount };
	}
	
	const watcher = new WhaleWatcher(options);
	
	async function run() {
		try {
			if (args.includes('--once')) {
				const transfers = await watcher.checkAllTokens();
				console.log(`\nFound ${transfers.length} whale transfers:`);
				transfers.forEach(t => watcher.defaultNotify(t));
			} else if (args.includes('--hours')) {
				const hoursIndex = args.indexOf('--hours');
				const hours = parseInt(args[hoursIndex + 1]) || 24;
				const transfers = await watcher.getRecentWhales(hours);
				console.log(`\nFound ${transfers.length} whale transfers in the last ${hours} hours:`);
				transfers.forEach(t => watcher.defaultNotify(t));
			} else {
				// Continuous monitoring
				await watcher.watchContinuously();
			}
		} catch (error) {
			console.error('Error:', error.message);
			process.exit(1);
		}
	}
	
	run();
}

export { WhaleWatcher, IBC_TOKENS };