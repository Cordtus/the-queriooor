#!/usr/bin/env node

import fetch from 'node-fetch';
import fs from 'fs/promises';

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

async function searchAddressTransactions(address, startHeight = null) {
	console.log(`Searching for all transactions involving address: ${address}`);
	console.log('Starting from latest block and counting down...\n');

	// Get latest block if no start height specified
	if (!startHeight) {
		const latestBlock = await queryLatestBlock();
		if (!latestBlock) {
			console.error('Could not fetch latest block');
			return [];
		}
		startHeight = parseInt(latestBlock.header.height);
	}

	console.log(`Starting from block height: ${startHeight}`);
	console.log('Will stop when finding a transaction with sequence 0 (first transaction)\n');

	const transactions = [];
	let blocksScanned = 0;
	let foundFirstTx = false;

	for (let height = startHeight; height >= 1 && !foundFirstTx; height--) {
		blocksScanned++;
		
		// Progress update every 100 blocks
		if (blocksScanned % 100 === 0) {
			console.log(`Progress: Scanned ${blocksScanned} blocks, found ${transactions.length} matching transactions...`);
		}

		const block = await queryBlockByHeight(height);
		if (!block || !block.data || !block.data.txs || block.data.txs.length === 0) {
			continue;
		}

		// Process each transaction in the block
		for (const txBase64 of block.data.txs) {
			// Calculate tx hash from base64 encoded tx
			const txBytes = Buffer.from(txBase64, 'base64');
			const crypto = await import('crypto');
			const hash = crypto.createHash('sha256').update(txBytes).digest('hex').toUpperCase();
			
			// Query the transaction by hash to get full details
			const txData = await queryTransactionByHash(hash);
			if (!txData || !txData.tx || !txData.tx_response) continue;

			// Check if the address is involved in this transaction
			let addressFound = false;
			let isFirstTx = false;
			
			// Check if any signer has sequence 0
			if (txData.tx.auth_info && txData.tx.auth_info.signer_infos) {
				for (const signerInfo of txData.tx.auth_info.signer_infos) {
					if (signerInfo.sequence === '0') {
						isFirstTx = true;
					}
				}
			}
			
			// Check messages for the address
			if (txData.tx.body && txData.tx.body.messages) {
				for (const msg of txData.tx.body.messages) {
					// Check all common address fields
					const addressFields = [
						msg.from_address, msg.to_address,
						msg.sender, msg.receiver,
						msg.delegator_address, msg.validator_address,
						msg.depositor, msg.proposer,
						msg.granter, msg.grantee,
						msg.creator, msg.owner
					];
					
					if (addressFields.includes(address)) {
						addressFound = true;
						break;
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
				console.log(`\nFound transaction at height ${height}: ${hash}`);
				if (isFirstTx) {
					console.log('>>> This is the FIRST transaction (sequence 0) <<<');
				}
				
				// Extract signer addresses and sequences
				const signers = [];
				if (txData.tx.auth_info && txData.tx.auth_info.signer_infos) {
					txData.tx.auth_info.signer_infos.forEach((info, idx) => {
						signers.push({
							sequence: info.sequence,
							mode: info.mode_info
						});
					});
				}

				const txInfo = {
					height,
					hash,
					timestamp: block.header.time,
					messages: txData.tx.body.messages,
					fee: txData.tx.auth_info.fee,
					memo: txData.tx.body.memo,
					signers,
					gasUsed: txData.tx_response.gas_used,
					gasWanted: txData.tx_response.gas_wanted,
					code: txData.tx_response.code,
					logs: txData.tx_response.logs,
					isFirstTx
				};
				
				transactions.push(txInfo);
				
				// If this is the first transaction, we can stop
				if (isFirstTx && addressFound) {
					foundFirstTx = true;
					console.log('\nFound first transaction! Stopping search.');
					break;
				}
			}
		}

		// Rate limiting to avoid overwhelming the API
		await new Promise(resolve => setTimeout(resolve, 100));
	}

	console.log(`\nScanning complete. Scanned ${blocksScanned} blocks.`);
	console.log(`Found ${transactions.length} transactions involving address ${address}`);
	
	return transactions;
}

async function saveTransactions(transactions, address) {
	const filename = `transactions-${address}-${Date.now()}.json`;
	await fs.writeFile(filename, JSON.stringify(transactions, null, 2));
	console.log(`\nSaved ${transactions.length} transactions to ${filename}`);
	return filename;
}

// CLI
const args = process.argv.slice(2);

if (args.length === 0) {
	console.log(`
Usage:
  find-address-txs.js <address>                    - Find all transactions for an address
  find-address-txs.js <address> <start-height>     - Start from specific height

The script will:
  1. Start from the latest block (or specified height)
  2. Count DOWN through blocks
  3. Find all transactions involving the address
  4. Stop when it finds a transaction with sequence 0 (first tx)
  5. Save all found transactions to a JSON file

Examples:
  find-address-txs.js cosmos1cff2uvc2zgep5xlha939vjk08g07rlw6d7sjvw
  find-address-txs.js cosmos1cff2uvc2zgep5xlha939vjk08g07rlw6d7sjvw 500000
	`);
	process.exit(0);
}

async function main() {
	const address = args[0];
	const startHeight = args[1] ? parseInt(args[1]) : null;
	
	try {
		const transactions = await searchAddressTransactions(address, startHeight);
		
		if (transactions.length > 0) {
			// Save to file
			const filename = await saveTransactions(transactions, address);
			
			// Display summary
			console.log('\n=== Transaction Summary ===');
			console.log(`Total transactions found: ${transactions.length}`);
			
			// Show first few transactions
			console.log('\nFirst few transactions:');
			transactions.slice(0, 5).forEach((tx, idx) => {
				console.log(`${idx + 1}. Height: ${tx.height}, Hash: ${tx.hash}`);
				console.log(`   Time: ${tx.timestamp}`);
				console.log(`   Messages: ${tx.messages.map(m => m['@type']).join(', ')}`);
				if (tx.isFirstTx) {
					console.log(`   >>> FIRST TRANSACTION <<<`);
				}
			});
			
			if (transactions.length > 5) {
				console.log(`... and ${transactions.length - 5} more transactions`);
			}
		}
	} catch (error) {
		console.error('Error:', error.message);
		process.exit(1);
	}
}

main().catch(console.error);