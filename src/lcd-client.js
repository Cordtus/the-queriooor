/**
 * Shared Cosmos LCD/REST helpers for the block-scanning CLIs.
 *
 * The base URL is process-global: the CLIs set it once (from `--lcd` /
 * `COSMOS_LCD`) before issuing any request.
 */

let baseUrl = 'https://lcd.osmosis.zone';

export function setLcdBase(url) {
	baseUrl = String(url).replace(/\/+$/, '');
}

async function getJson(url, label) {
	try {
		const response = await fetch(url);
		if (!response.ok) {
			throw new Error(`HTTP ${response.status}: ${response.statusText}`);
		}
		return await response.json();
	} catch (error) {
		console.error(`Failed to fetch ${label}:`, error.message);
		return null;
	}
}

export async function queryLatestBlock() {
	const data = await getJson(`${baseUrl}/cosmos/base/tendermint/v1beta1/blocks/latest`, 'latest block');
	return data?.block ?? null;
}

export async function queryBlockByHeight(height) {
	const data = await getJson(`${baseUrl}/cosmos/base/tendermint/v1beta1/blocks/${height}`, `block ${height}`);
	return data?.block ?? null;
}

export async function queryTransactionByHash(hash) {
	return getJson(`${baseUrl}/cosmos/tx/v1beta1/txs/${hash}`, `tx ${hash}`);
}

export async function queryAccount(address) {
	const data = await getJson(`${baseUrl}/cosmos/auth/v1beta1/accounts/${address}`, 'account');
	return data?.account ?? null;
}
