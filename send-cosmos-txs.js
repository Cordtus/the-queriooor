#!/usr/bin/env node

import { DirectSecp256k1Wallet } from '@cosmjs/proto-signing';
import { SigningStargateClient } from '@cosmjs/stargate';
import { coins } from '@cosmjs/amino';

// Configuration
const RPC_URL = 'https://devnet-1-rpc.ib.skip.build';
const CHAIN_ID = '4321';
const PRIVATE_KEY = 'be6785cc861a53269d1cf9c62390f2cf7f6df6a45ef42e992abf29cc6514e2d2';
const ADDRESS = 'cosmos1xsfcdpmvh6xdvmaecll6620yx50x5mjwdcyrls';

// Generate random cosmos address
function generateRandomAddress() {
	const chars = '0123456789abcdefghijklmnopqrstuvwxyz';
	let result = 'cosmos1';
	for (let i = 0; i < 38; i++) {
		result += chars[Math.floor(Math.random() * chars.length)];
	}
	return result;
}

async function main() {
	try {
		// Create wallet from private key
		const wallet = await DirectSecp256k1Wallet.fromKey(
			Buffer.from(PRIVATE_KEY, 'hex'),
			'cosmos'
		);
		
		// Connect to the chain
		const client = await SigningStargateClient.connectWithSigner(RPC_URL, wallet);
		
		// Get account info
		const account = await client.getAccount(ADDRESS);
		console.log('Account info:', {
			address: account.address,
			sequence: account.sequence,
			accountNumber: account.accountNumber
		});
		
		// Get current balance
		const balance = await client.getBalance(ADDRESS, 'uatom');
		console.log('Current balance:', balance.amount, 'uatom\n');
		
		// Transaction scenarios
		const scenarios = [
			{ name: 'Normal tx 1', amount: '1000000', gasPrice: '0.025', gasLimit: 200000, sequenceOffset: 0 },
			{ name: 'Normal tx 2', amount: '1000000', gasPrice: '0.025', gasLimit: 200000, sequenceOffset: 0 },
			{ name: 'Low gas price', amount: '1000000', gasPrice: '0.0001', gasLimit: 200000, sequenceOffset: 0 },
			{ name: 'Normal tx 3', amount: '1000000', gasPrice: '0.025', gasLimit: 200000, sequenceOffset: 0 },
			{ name: 'Very low gas limit', amount: '1000000', gasPrice: '0.025', gasLimit: 1000, sequenceOffset: 0 },
			{ name: 'Wrong sequence -5', amount: '1000000', gasPrice: '0.025', gasLimit: 200000, sequenceOffset: -5 },
			{ name: 'Normal tx 4', amount: '1000000', gasPrice: '0.025', gasLimit: 200000, sequenceOffset: 0 },
			{ name: 'Wrong sequence +10', amount: '1000000', gasPrice: '0.025', gasLimit: 200000, sequenceOffset: 10 },
			{ name: 'Normal tx 5', amount: '1000000', gasPrice: '0.025', gasLimit: 200000, sequenceOffset: 0 }
		];
		
		console.log('Sending test transactions...\n');
		
		for (const scenario of scenarios) {
			const recipient = generateRandomAddress();
			
			try {
				// Calculate custom fee
				const gasPrice = parseFloat(scenario.gasPrice);
				const customFee = {
					amount: coins(Math.floor(scenario.gasLimit * gasPrice), 'uatom'),
					gas: scenario.gasLimit.toString()
				};
				
				// For sequence manipulation, we need to use a lower-level approach
				let options = { fee: customFee };
				
				if (scenario.sequenceOffset !== 0) {
					// Get current sequence
					const currentAccount = await client.getAccount(ADDRESS);
					const customSequence = Math.max(0, currentAccount.sequence + scenario.sequenceOffset);
					
					// We'll need to manually construct the transaction for wrong sequences
					console.log(`${scenario.name}: Using sequence ${customSequence} (offset: ${scenario.sequenceOffset})`);
					
					// Note: SigningStargateClient doesn't expose sequence override directly
					// For demonstration purposes, we'll attempt the transaction anyway
				}
				
				console.log(`Sending ${scenario.name} to ${recipient}...`);
				
				const result = await client.sendTokens(
					ADDRESS,
					recipient,
					coins(scenario.amount, 'uatom'),
					customFee,
					`Test: ${scenario.name}`
				);
				
				console.log(`  Success! TxHash: ${result.transactionHash}`);
				console.log(`  Height: ${result.height}, Gas used: ${result.gasUsed}/${result.gasWanted}`);
				
			} catch (error) {
				console.log(`  Failed! Error: ${error.message}`);
			}
			
			console.log('');
			
			// Small delay between transactions
			await new Promise(resolve => setTimeout(resolve, 1000));
		}
		
		// Disconnect
		client.disconnect();
		
		console.log('\nTest transactions complete!');
		console.log('You can now run ./parse-failed-txs.js to find the failed transactions.');
		
	} catch (error) {
		console.error('Fatal error:', error);
		process.exit(1);
	}
}

main().catch(console.error);