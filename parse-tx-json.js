#!/usr/bin/env node

import fs from 'fs';
import { readFile } from 'fs/promises';

class TxParser {
	parseTransaction(tx) {
		const parsed = {
			hash: tx.txhash || tx.hash,
			height: tx.height,
			timestamp: tx.timestamp,
			code: tx.code || 0,
			success: !tx.code || tx.code === 0,
			rawLog: tx.raw_log || '',
			memo: tx.tx?.body?.memo || '',
			fee: tx.tx?.auth_info?.fee || {},
			gas: {
				wanted: tx.gas_wanted,
				used: tx.gas_used
			},
			messages: [],
			events: []
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
	
	getSender(tx) {
		// Check messages for sender
		if (tx.messages && tx.messages.length > 0) {
			const msg = tx.messages[0].data;
			return msg.from_address || msg.sender || msg.signer || null;
		}
		
		// Check events for sender
		for (const event of tx.events) {
			if (event.attributes.sender) {
				return event.attributes.sender;
			}
		}
		
		return null;
	}
	
	formatAmount(amount) {
		if (Array.isArray(amount)) {
			return amount.map(coin => `${coin.amount}${coin.denom}`).join(', ');
		}
		return amount || 'N/A';
	}
	
	getErrorMessage(tx) {
		if (tx.success) return null;
		
		// Try to extract error from raw log
		if (tx.rawLog) {
			const match = tx.rawLog.match(/failed to execute message[^:]*: (.+?)(?::|$)/);
			if (match) return match[1];
			
			// Look for other error patterns
			if (tx.rawLog.includes('insufficient funds')) return 'Insufficient funds';
			if (tx.rawLog.includes('account sequence mismatch')) return 'Sequence mismatch';
			if (tx.rawLog.includes('invalid coins')) return 'Invalid coins';
			if (tx.rawLog.includes('unauthorized')) return 'Unauthorized';
			
			// Return first 100 chars of raw log if no pattern matched
			return tx.rawLog.substring(0, 100) + (tx.rawLog.length > 100 ? '...' : '');
		}
		
		return `Error code: ${tx.code}`;
	}
}

async function main() {
	const args = process.argv.slice(2);
	
	if (args.length === 0) {
		console.log(`
Usage:
  parse-tx-json.js <json_file>                     - Parse all transactions
  parse-tx-json.js <json_file> --failed            - Show only failed transactions
  parse-tx-json.js <json_file> --sender <address>  - Filter by sender address
  parse-tx-json.js <json_file> --failed --sender <address> - Failed txs from specific sender

Examples:
  parse-tx-json.js transactions.json
  parse-tx-json.js transactions.json --failed
  parse-tx-json.js transactions.json --sender cosmos1cff2uvc2zgep5xlha939vjk08g07rlw6d7sjvw
  parse-tx-json.js transactions.json --failed --sender cosmos1cff2uvc2zgep5xlha939vjk08g07rlw6d7sjvw
		`);
		process.exit(0);
	}
	
	const jsonFile = args[0];
	const showFailed = args.includes('--failed');
	const senderIndex = args.indexOf('--sender');
	const filterSender = senderIndex !== -1 ? args[senderIndex + 1] : null;
	
	try {
		// Read and parse JSON file
		console.log(`Reading ${jsonFile}...`);
		const data = await readFile(jsonFile, 'utf8');
		const jsonData = JSON.parse(data);
		
		// Handle different JSON structures
		let transactions = [];
		if (Array.isArray(jsonData)) {
			transactions = jsonData;
		} else if (jsonData.txs) {
			transactions = jsonData.txs;
		} else if (jsonData.tx_responses) {
			transactions = jsonData.tx_responses;
		} else if (jsonData.transactions) {
			transactions = jsonData.transactions;
		} else {
			console.error('Unknown JSON structure. Expected array or object with txs/tx_responses/transactions field.');
			process.exit(1);
		}
		
		console.log(`Found ${transactions.length} total transactions\n`);
		
		const parser = new TxParser();
		let filteredTxs = [];
		
		// Parse and filter transactions
		for (const tx of transactions) {
			const parsed = parser.parseTransaction(tx);
			const sender = parser.getSender(parsed);
			
			// Apply filters
			if (showFailed && parsed.success) continue;
			if (filterSender && sender !== filterSender) continue;
			
			filteredTxs.push({ parsed, sender, raw: tx });
		}
		
		// Display results
		console.log(`Filtered transactions: ${filteredTxs.length}\n`);
		
		if (filteredTxs.length === 0) {
			console.log('No transactions match the specified criteria.');
			return;
		}
		
		// Summary statistics
		if (showFailed) {
			const errorTypes = {};
			filteredTxs.forEach(({ parsed }) => {
				const error = parser.getErrorMessage(parsed);
				errorTypes[error] = (errorTypes[error] || 0) + 1;
			});
			
			console.log('Failed Transaction Summary:');
			console.log('==========================');
			Object.entries(errorTypes)
				.sort((a, b) => b[1] - a[1])
				.forEach(([error, count]) => {
					console.log(`${count} - ${error}`);
				});
			console.log('\n');
		}
		
		// Detailed transaction list
		console.log('Transaction Details:');
		console.log('===================');
		
		filteredTxs.forEach(({ parsed, sender }, index) => {
			console.log(`\n[${index + 1}] Transaction ${parsed.hash}`);
			console.log(`    Height: ${parsed.height}`);
			console.log(`    Time: ${parsed.timestamp}`);
			console.log(`    Status: ${parsed.success ? 'SUCCESS' : `FAILED (code: ${parsed.code})`}`);
			console.log(`    Sender: ${sender || 'Unknown'}`);
			console.log(`    Gas: ${parsed.gas.used}/${parsed.gas.wanted}`);
			
			if (!parsed.success) {
				console.log(`    Error: ${parser.getErrorMessage(parsed)}`);
			}
			
			// Show message details
			parsed.messages.forEach((msg, i) => {
				console.log(`    Message ${i + 1}: ${msg.type}`);
				
				// Show key details based on message type
				if (msg.type === '/cosmos.bank.v1beta1.MsgSend') {
					console.log(`      From: ${msg.data.from_address}`);
					console.log(`      To: ${msg.data.to_address}`);
					console.log(`      Amount: ${parser.formatAmount(msg.data.amount)}`);
				} else if (msg.type === '/cosmos.staking.v1beta1.MsgDelegate') {
					console.log(`      Delegator: ${msg.data.delegator_address}`);
					console.log(`      Validator: ${msg.data.validator_address}`);
					console.log(`      Amount: ${parser.formatAmount(msg.data.amount)}`);
				} else if (msg.type === '/ibc.applications.transfer.v1.MsgTransfer') {
					console.log(`      From: ${msg.data.sender}`);
					console.log(`      To: ${msg.data.receiver}`);
					console.log(`      Amount: ${parser.formatAmount(msg.data.token)}`);
					console.log(`      Channel: ${msg.data.source_channel}`);
				}
			});
			
			if (parsed.memo) {
				console.log(`    Memo: ${parsed.memo}`);
			}
		});
		
		// Export option
		if (args.includes('--export')) {
			const exportFile = `filtered-txs-${Date.now()}.json`;
			await fs.promises.writeFile(
				exportFile, 
				JSON.stringify(filteredTxs.map(({ raw }) => raw), null, 2)
			);
			console.log(`\nExported filtered transactions to: ${exportFile}`);
		}
		
	} catch (error) {
		console.error('Error:', error.message);
		process.exit(1);
	}
}

main();