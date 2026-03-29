#!/usr/bin/env node


async function queryTransactionByHash(hash) {
	const url = `https://devnet-1-lcd.ib.skip.build/cosmos/tx/v1beta1/txs/${hash}`;
	try {
		const response = await fetch(url);
		if (!response.ok) {
			throw new Error(`HTTP ${response.status}: ${response.statusText}`);
		}
		return await response.json();
	} catch (error) {
		console.error(`Failed to fetch tx ${hash}:`, error.message);
		return null;
	}
}

async function queryLatestBlock() {
	const url = 'https://devnet-1-lcd.ib.skip.build/cosmos/base/tendermint/v1beta1/blocks/latest';
	try {
		const response = await fetch(url);
		if (!response.ok) {
			throw new Error(`HTTP ${response.status}: ${response.statusText}`);
		}
		const data = await response.json();
		return data.block;
	} catch (error) {
		console.error('Failed to fetch latest block:', error.message);
		return null;
	}
}

async function queryBlockByHeight(height) {
	const url = `https://devnet-1-lcd.ib.skip.build/cosmos/base/tendermint/v1beta1/blocks/${height}`;
	try {
		const response = await fetch(url);
		if (!response.ok) {
			throw new Error(`HTTP ${response.status}: ${response.statusText}`);
		}
		const data = await response.json();
		return data.block;
	} catch (error) {
		console.error(`Failed to fetch block ${height}:`, error.message);
		return null;
	}
}

async function searchTransactionsByAddress(address, maxBlocks = 999999) {
	console.log(`Searching for transactions involving: ${address}`);
	console.log('Note: This may take a while as we scan recent blocks...\n');

	const latestBlock = await queryLatestBlock();
	if (!latestBlock) {
		console.error('Could not fetch latest block');
		return [];
	}

	const latestHeight = parseInt(latestBlock.header.height);
	const startHeight = Math.max(1, latestHeight - maxBlocks);

	console.log(`Scanning blocks ${latestHeight} down to ${startHeight}...`);

	const transactions = [];
	let blocksScanned = 0;
	let txCount = 0;

	for (let height = latestHeight; height >= startHeight; height--) {
		blocksScanned++;
		if (blocksScanned % 100 === 0) {
			console.log(`Progress: Scanned ${blocksScanned} blocks, found ${transactions.length} matching transactions...`);
		}

		const block = await queryBlockByHeight(height);
		if (!block || !block.data || !block.data.txs || block.data.txs.length === 0) continue;

		// Process each transaction in the block
		for (const txBase64 of block.data.txs) {
			txCount++;
			
			// Calculate tx hash from base64 encoded tx
			const txBytes = Buffer.from(txBase64, 'base64');
			const crypto = await import('crypto');
			const hash = crypto.createHash('sha256').update(txBytes).digest('hex').toUpperCase();
			
			// Query the transaction by hash to get full details
			const txData = await queryTransactionByHash(hash);
			if (!txData || !txData.tx || !txData.tx_response) continue;

			// Check if the address is involved in this transaction
			let addressFound = false;
			
			// Check signers
			if (txData.tx.auth_info && txData.tx.auth_info.signer_infos) {
				for (let i = 0; i < txData.tx.auth_info.signer_infos.length; i++) {
					if (txData.tx.body && txData.tx.body.messages) {
						for (const msg of txData.tx.body.messages) {
							// Check common message types for addresses
							if (msg.from_address === address || msg.to_address === address || 
								msg.sender === address || msg.receiver === address ||
								msg.delegator_address === address || msg.validator_address === address ||
								msg.depositor === address || msg.proposer === address) {
								addressFound = true;
								break;
							}
						}
					}
				}
			}

			// Also check events for the address
			if (!addressFound && txData.tx_response && txData.tx_response.logs) {
				for (const log of txData.tx_response.logs) {
					if (log.events) {
						for (const event of log.events) {
							if (event.attributes) {
								for (const attr of event.attributes) {
									if (attr.value === address) {
										addressFound = true;
										break;
									}
								}
							}
						}
					}
				}
			}

			if (addressFound) {
				transactions.push({
					height,
					hash,
					timestamp: block.header.time,
					messages: txData.tx.body.messages,
					fee: txData.tx.auth_info.fee,
					memo: txData.tx.body.memo,
					gasUsed: txData.tx_response.gas_used,
					gasWanted: txData.tx_response.gas_wanted,
					code: txData.tx_response.code,
					logs: txData.tx_response.logs
				});
			}
		}

		// Rate limiting
		await new Promise(resolve => setTimeout(resolve, 100));
	}

	console.log(`\nScanning complete. Scanned ${blocksScanned} blocks with ${txCount} total transactions.`);
	console.log(`Found ${transactions.length} transactions involving address ${address}`);
	return transactions;
}

async function searchForFirstTransaction() {
	console.log('Searching for the first transaction (sequence 0)...');
	console.log('Scanning blocks from latest height counting down...\n');

	const latestBlock = await queryLatestBlock();
	if (!latestBlock) {
		console.error('Could not fetch latest block');
		return null;
	}

	const latestHeight = parseInt(latestBlock.header.height);
	console.log(`Starting from block height: ${latestHeight}`);

	let blocksScanned = 0;
	let txCount = 0;

	for (let height = latestHeight; height >= 1; height--) {
		blocksScanned++;
		if (blocksScanned % 10 === 0) {
			console.log(`Progress: Scanned ${blocksScanned} blocks, found ${txCount} transactions...`);
		}

		const block = await queryBlockByHeight(height);
		if (!block || !block.data || !block.data.txs || block.data.txs.length === 0) {
			continue;
		}

		// Process each transaction in the block
		for (const txBase64 of block.data.txs) {
			txCount++;
			
			// Calculate tx hash from base64 encoded tx
			const txBytes = Buffer.from(txBase64, 'base64');
			const crypto = await import('crypto');
			const hash = crypto.createHash('sha256').update(txBytes).digest('hex').toUpperCase();
			
			// Query the transaction by hash to get full details
			const txData = await queryTransactionByHash(hash);
			if (!txData || !txData.tx || !txData.tx.auth_info || !txData.tx.auth_info.signer_infos) {
				continue;
			}

			// Check all signers for sequence 0
			for (const signerInfo of txData.tx.auth_info.signer_infos) {
				if (signerInfo.sequence === '0') {
					console.log(`\nFound first transaction with sequence 0!`);
					console.log(`Block Height: ${height}`);
					console.log(`Transaction Hash: ${hash}`);
					console.log(`Total blocks scanned: ${blocksScanned}`);
					console.log(`Total transactions checked: ${txCount}`);
					return {
						height,
						hash,
						transaction: txData
					};
				}
			}
		}

		// Rate limiting
		await new Promise(resolve => setTimeout(resolve, 100));
	}

	console.log(`\nScanned all ${blocksScanned} blocks and ${txCount} transactions.`);
	console.log('No transaction with sequence 0 found.');
	return null;
}

// Alternative: Query account information
async function queryAccount(address) {
	const url = `https://devnet-1-lcd.ib.skip.build/cosmos/auth/v1beta1/accounts/${address}`;
	try {
		const response = await fetch(url);
		if (!response.ok) {
			throw new Error(`HTTP ${response.status}: ${response.statusText}`);
		}
		const data = await response.json();
		return data.account;
	} catch (error) {
		console.error('Failed to fetch account:', error.message);
		return null;
	}
}

// CLI
const args = process.argv.slice(2);

if (args.length === 0) {
	console.log(`
Usage:
  query-txs.js <address>              - Search recent blocks for address activity
  query-txs.js --tx <hash>            - Query specific transaction by hash
  query-txs.js --account <address>    - Query account information
  query-txs.js --latest               - Show latest block info
  query-txs.js --first                - Find the first transaction (sequence 0)

Examples:
  query-txs.js cosmos1cff2uvc2zgep5xlha939vjk08g07rlw6d7sjvw
  query-txs.js --tx 1A2B3C4D...
  query-txs.js --account cosmos1cff2uvc2zgep5xlha939vjk08g07rlw6d7sjvw
  query-txs.js --first
	`);
	process.exit(0);
}

async function main() {
	if (args[0] === '--tx' && args[1]) {
		const result = await queryTransactionByHash(args[1]);
		if (result) {
			console.log(JSON.stringify(result, null, 2));
		}
	} else if (args[0] === '--account' && args[1]) {
		const account = await queryAccount(args[1]);
		if (account) {
			console.log('Account Information:');
			console.log(JSON.stringify(account, null, 2));
		}
	} else if (args[0] === '--latest') {
		const block = await queryLatestBlock();
		if (block) {
			console.log('Latest Block:');
			console.log(`Height: ${block.header.height}`);
			console.log(`Time: ${block.header.time}`);
			console.log(`Transactions: ${block.data.txs ? block.data.txs.length : 0}`);
			console.log(`Chain ID: ${block.header.chain_id}`);
		}
	} else if (args[0] === '--first') {
		const result = await searchForFirstTransaction();
		if (result) {
			console.log('\nFirst transaction details:');
			console.log(JSON.stringify(result.transaction, null, 2));
		}
	} else {
		const transactions = await searchTransactionsByAddress(args[0]);
		if (transactions.length > 0) {
			console.log('\nTransaction Details:');
			console.log('===================');
			for (const tx of transactions) {
				console.log(`\nBlock Height: ${tx.height}`);
				console.log(`Timestamp: ${tx.timestamp}`);
				console.log(`Hash: ${tx.hash}`);
				console.log(`Gas Used: ${tx.gasUsed}/${tx.gasWanted}`);
				console.log(`Fee: ${JSON.stringify(tx.fee)}`);
				if (tx.memo) console.log(`Memo: ${tx.memo}`);
				console.log(`Status: ${tx.code === 0 ? 'Success' : `Failed (code: ${tx.code})`}`);
				console.log('Messages:');
				for (const msg of tx.messages) {
					console.log(`  - ${msg['@type']}`);
				}
				console.log('---');
			}
		}
	}
}

main().catch(console.error);
