#!/usr/bin/env node

const crypto = require('crypto');
const https = require('https');

// Configuration
const RPC_URL = 'https://devnet-1-rpc.ib.skip.build';
const LCD_URL = 'https://devnet-1-lcd.ib.skip.build';
const CHAIN_ID = '4321';

// Account info
const PRIVATE_KEY = 'be6785cc861a53269d1cf9c62390f2cf7f6df6a45ef42e992abf29cc6514e2d2';
const ADDRESS = 'cosmos1xsfcdpmvh6xdvmaecll6620yx50x5mjwdcyrls';

// Create secp256k1 keypair from private key
function getKeyPair() {
	const privateKeyBuffer = Buffer.from(PRIVATE_KEY, 'hex');
	const { createPrivateKey, createPublicKey } = require('crypto');
	
	// For simplicity, we'll use the cosmjs library approach
	return {
		privateKey: privateKeyBuffer,
		publicKey: Buffer.from('03118e650f6eba08e8a5776890edcf3c9110846a21248c96fb670df175084e7ff4', 'hex')
	};
}

// Fetch account info
async function getAccountInfo() {
	return new Promise((resolve, reject) => {
		https.get(`${LCD_URL}/cosmos/auth/v1beta1/accounts/${ADDRESS}`, (res) => {
			let data = '';
			res.on('data', chunk => data += chunk);
			res.on('end', () => {
				try {
					const result = JSON.parse(data);
					const account = result.account;
					resolve({
						accountNumber: account.account_number,
						sequence: parseInt(account.sequence)
					});
				} catch (e) {
					reject(e);
				}
			});
		}).on('error', reject);
	});
}

// Create a bank send message
function createBankSendMsg(toAddress, amount) {
	return {
		'@type': '/cosmos.bank.v1beta1.MsgSend',
		from_address: ADDRESS,
		to_address: toAddress,
		amount: [{
			denom: 'uatom',
			amount: amount.toString()
		}]
	};
}

// Create transaction body
function createTxBody(messages, memo = '') {
	return {
		messages,
		memo,
		timeout_height: '0',
		extension_options: [],
		non_critical_extension_options: []
	};
}

// Create auth info
function createAuthInfo(sequence, fee) {
	return {
		signer_infos: [{
			public_key: {
				'@type': '/cosmos.crypto.secp256k1.PubKey',
				key: 'AxGOZQ9uugjopXdokO3PPJEIBGKSINIXL2cN8XUIEH30'
			},
			mode_info: {
				single: {
					mode: 'SIGN_MODE_DIRECT'
				}
			},
			sequence: sequence.toString()
		}],
		fee: {
			amount: [{
				denom: 'uatom',
				amount: fee.amount.toString()
			}],
			gas_limit: fee.gasLimit.toString(),
			payer: '',
			granter: ''
		},
		tip: null
	};
}

// Generate random recipient address
function generateRandomAddress() {
	const randomBytes = crypto.randomBytes(20);
	// Simple bech32-like encoding (not proper bech32, just for testing)
	return 'cosmos1' + randomBytes.toString('hex').substring(0, 38);
}

// Broadcast transaction
async function broadcastTx(txBytes) {
	return new Promise((resolve, reject) => {
		const postData = JSON.stringify({
			tx_bytes: txBytes,
			mode: 'BROADCAST_MODE_SYNC'
		});
		
		const options = {
			hostname: RPC_URL.replace('https://', ''),
			path: '/cosmos/tx/v1beta1/txs',
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'Content-Length': postData.length
			}
		};
		
		const req = https.request(options, (res) => {
			let data = '';
			res.on('data', chunk => data += chunk);
			res.on('end', () => {
				try {
					resolve(JSON.parse(data));
				} catch (e) {
					reject(e);
				}
			});
		});
		
		req.on('error', reject);
		req.write(postData);
		req.end();
	});
}

// Generate test transactions
async function generateTestTransactions() {
	console.log('Fetching account info...');
	const accountInfo = await getAccountInfo();
	console.log(`Account: ${ADDRESS}`);
	console.log(`Current sequence: ${accountInfo.sequence}`);
	
	const transactions = [];
	let currentSequence = accountInfo.sequence;
	
	// Transaction scenarios
	const scenarios = [
		{ name: 'Normal tx 1', amount: 1000000, fee: { amount: 5000, gasLimit: 200000 }, sequenceOffset: 0, valid: true },
		{ name: 'Normal tx 2', amount: 1000000, fee: { amount: 5000, gasLimit: 200000 }, sequenceOffset: 1, valid: true },
		{ name: 'Wrong sequence (too low)', amount: 1000000, fee: { amount: 5000, gasLimit: 200000 }, sequenceOffset: -2, valid: false },
		{ name: 'Normal tx 3', amount: 1000000, fee: { amount: 5000, gasLimit: 200000 }, sequenceOffset: 2, valid: true },
		{ name: 'Insufficient fee', amount: 1000000, fee: { amount: 10, gasLimit: 200000 }, sequenceOffset: 3, valid: false },
		{ name: 'Insufficient gas', amount: 1000000, fee: { amount: 5000, gasLimit: 1000 }, sequenceOffset: 4, valid: false },
		{ name: 'Normal tx 4', amount: 1000000, fee: { amount: 5000, gasLimit: 200000 }, sequenceOffset: 5, valid: true },
		{ name: 'Wrong sequence (duplicate)', amount: 1000000, fee: { amount: 5000, gasLimit: 200000 }, sequenceOffset: 4, valid: false },
		{ name: 'Normal tx 5', amount: 1000000, fee: { amount: 5000, gasLimit: 200000 }, sequenceOffset: 6, valid: true }
	];
	
	console.log('\nGenerating transactions...\n');
	
	for (const scenario of scenarios) {
		const recipient = generateRandomAddress();
		const msg = createBankSendMsg(recipient, scenario.amount);
		const txBody = createTxBody([msg], `Test: ${scenario.name}`);
		const sequence = currentSequence + scenario.sequenceOffset;
		const authInfo = createAuthInfo(sequence, scenario.fee);
		
		// For this demo, we'll create a simplified tx structure
		// In production, you'd need proper protobuf encoding and signing
		const tx = {
			body: txBody,
			auth_info: authInfo,
			signatures: [''] // Would need actual signature
		};
		
		console.log(`${scenario.name}:`);
		console.log(`  Recipient: ${recipient}`);
		console.log(`  Amount: ${scenario.amount} uatom`);
		console.log(`  Sequence: ${sequence}`);
		console.log(`  Fee: ${scenario.fee.amount} uatom`);
		console.log(`  Gas Limit: ${scenario.fee.gasLimit}`);
		console.log(`  Expected: ${scenario.valid ? 'Success' : 'Failure'}`);
		console.log('');
		
		transactions.push({
			scenario: scenario.name,
			tx,
			expectedValid: scenario.valid
		});
	}
	
	console.log('\nNote: This is a demonstration script. To actually broadcast these transactions,');
	console.log('you would need to properly encode them using protobuf and sign with the private key.');
	console.log('Consider using @cosmjs/stargate or similar library for production use.\n');
	
	// Save transaction scenarios for reference
	const fs = require('fs');
	fs.writeFileSync('test-transactions.json', JSON.stringify(transactions, null, 2));
	console.log('Test transaction scenarios saved to test-transactions.json');
}

// Main execution
async function main() {
	try {
		await generateTestTransactions();
	} catch (error) {
		console.error('Error:', error);
		process.exit(1);
	}
}

if (require.main === module) {
	main();
}

module.exports = { generateTestTransactions };