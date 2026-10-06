/**
 * Vercel serverless CORS proxy for Cosmos RPC/LCD endpoints.
 * Forwards read-only requests to preset public endpoints with bounded responses.
 *
 * @param {import('@vercel/node').VercelRequest} req
 * @param {import('@vercel/node').VercelResponse} res
 */
const MAX_RESPONSE_BYTES = 1024 * 1024;

const ENDPOINT_PRESETS = [
	['rpc', 'https://rpc.archive.osmosis.zone'],
	['rpc', 'https://osmosis-rpc.polkachu.com'],
	['rpc', 'https://rpc.lavenderfive.com/osmosis'],
	['rpc', 'https://cosmos-rpc.polkachu.com'],
	['rpc', 'https://rpc-cosmoshub.ecostake.com'],
	['rpc', 'https://rpc.cosmos.directory/cosmoshub'],
	['rpc', 'https://rpc.lavenderfive.com/cosmoshub'],
	['rpc', 'https://rpc.stargaze-apis.com'],
	['rpc', 'https://rpc.cosmos.directory/juno'],
	['rpc', 'https://rpc.cosmos.directory/neutron'],
	['rest', 'https://lcd.osmosis.zone'],
	['rest', 'https://osmosis-api.polkachu.com'],
	['rest', 'https://rest.lavenderfive.com/osmosis'],
	['rest', 'https://cosmos-api.polkachu.com'],
	['rest', 'https://rest-cosmoshub.ecostake.com'],
	['rest', 'https://rest.cosmos.directory/cosmoshub'],
	['rest', 'https://rest.lavenderfive.com/cosmoshub'],
	['rest', 'https://rest.stargaze-apis.com'],
	['rest', 'https://rest.cosmos.directory/juno'],
	['rest', 'https://rest.cosmos.directory/neutron'],
].map(([kind, url]) => {
	const parsed = new URL(url);
	return {
		kind,
		origin: parsed.origin,
		basePath: parsed.pathname.replace(/\/$/, ''),
	};
});

const READ_ONLY_RPC_PATHS = new Set([
	'/status',
	'/block',
	'/block_results',
	'/validators',
	'/tx_search',
]);

function findEndpointPreset(parsed) {
	return ENDPOINT_PRESETS
		.filter(preset => preset.origin === parsed.origin)
		.filter(preset => !preset.basePath ||
			parsed.pathname === preset.basePath ||
			parsed.pathname.startsWith(`${preset.basePath}/`))
		.sort((left, right) => right.basePath.length - left.basePath.length)[0] || null;
}

/**
 * Classify any HTTPS target as an allowed read-only endpoint.
 * Known presets keep their strict basePath handling; unknown origins are
 * allowed only when the path is a read-only Cosmos/Tendermint shape, so
 * custom endpoints entered in the explorer work without turning this into
 * a general-purpose open proxy.
 * Returns null when the target is not allowed.
 */
function classifyEndpoint(parsed) {
	const preset = findEndpointPreset(parsed);
	if (preset) {
		return preset;
	}
	const path = parsed.pathname;
	if (path.startsWith('/cosmos/') || path.startsWith('/ibc/')) {
		return { kind: 'rest', origin: parsed.origin, basePath: '' };
	}
	// cosmos.directory aggregate REST: rest.cosmos.directory/<chain>/cosmos|ibc/...
	if (parsed.origin === 'https://rest.cosmos.directory') {
		const [chain, root] = path.split('/').filter(Boolean);
		if (chain && (root === 'cosmos' || root === 'ibc')) {
			return { kind: 'rest', origin: parsed.origin, basePath: `/${chain}` };
		}
	}
	const lastSegment = `/${path.split('/').filter(Boolean).pop() || ''}`;
	if (READ_ONLY_RPC_PATHS.has(lastSegment)) {
		const basePath = path.slice(0, path.length - lastSegment.length).replace(/\/$/, '');
		return { kind: 'rpc', origin: parsed.origin, basePath };
	}
	return null;
}

function isReadOnlyPath(parsed, preset) {
	const relativePath = parsed.pathname.slice(preset.basePath.length) || '/';
	if (preset.kind === 'rpc') {
		return READ_ONLY_RPC_PATHS.has(relativePath);
	}
	return relativePath.startsWith('/cosmos/') || relativePath.startsWith('/ibc/');
}

class ResponseTooLargeError extends Error {}

async function readBoundedBody(response) {
	const contentLength = Number.parseInt(response.headers.get('content-length') || '', 10);
	if (Number.isFinite(contentLength) && contentLength > MAX_RESPONSE_BYTES) {
		throw new ResponseTooLargeError();
	}

	if (!response.body) return '';

	const reader = response.body.getReader();
	const chunks = [];
	let byteLength = 0;

	while (true) {
		const { done, value } = await reader.read();
		if (done) break;
		byteLength += value.byteLength;
		if (byteLength > MAX_RESPONSE_BYTES) {
			await reader.cancel();
			throw new ResponseTooLargeError();
		}
		chunks.push(value);
	}

	const body = new Uint8Array(byteLength);
	let offset = 0;
	for (const chunk of chunks) {
		body.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return new TextDecoder().decode(body);
}

export default async function handler(req, res) {
	const corsHeaders = {
		'Access-Control-Allow-Origin': '*',
		'Access-Control-Allow-Methods': 'GET, OPTIONS',
		'Access-Control-Allow-Headers': 'Content-Type',
	};
	for (const [key, value] of Object.entries(corsHeaders)) {
		res.setHeader(key, value);
	}

	if (req.method === 'OPTIONS') {
		res.writeHead(204, corsHeaders);
		res.end();
		return;
	}
	if (req.method !== 'GET') {
		res.status(405).json({ error: 'Only GET requests are allowed' });
		return;
	}

	const targetUrl = req.query.url;
	if (!targetUrl || typeof targetUrl !== 'string') {
		res.status(400).json({ error: 'Missing "url" query parameter' });
		return;
	}

	let parsed;
	try {
		parsed = new URL(targetUrl);
	} catch {
		res.status(400).json({ error: 'Invalid URL' });
		return;
	}

	if (parsed.protocol !== 'https:' || parsed.username || parsed.password) {
		res.status(400).json({ error: 'Only credential-free HTTPS URLs are allowed' });
		return;
	}
	const preset = classifyEndpoint(parsed);
	if (!preset) {
		res.status(403).json({ error: 'Target endpoint is not allowed' });
		return;
	}
	if (!isReadOnlyPath(parsed, preset)) {
		res.status(403).json({ error: 'Target endpoint path is not allowed' });
		return;
	}

	try {
		const upstream = await fetch(parsed.href, {
			method: 'GET',
			headers: { 'Accept': 'application/json' },
			redirect: 'manual',
			signal: AbortSignal.timeout(30000),
		});

		const contentType = upstream.headers.get('content-type') || 'application/json';
		const body = await readBoundedBody(upstream);

		res.setHeader('Content-Type', contentType);
		res.status(upstream.status).send(body);
	} catch (err) {
		if (err instanceof ResponseTooLargeError) {
			res.status(413).json({ error: `Upstream response exceeds ${MAX_RESPONSE_BYTES} bytes` });
			return;
		}
		res.status(502).json({ error: `Upstream error: ${err.message}` });
	}
}
