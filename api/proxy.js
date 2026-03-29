/**
 * Vercel serverless CORS proxy for Cosmos RPC/LCD endpoints.
 * Forwards requests to the target URL and returns the response with CORS headers.
 *
 * @param {import('@vercel/node').VercelRequest} req
 * @param {import('@vercel/node').VercelResponse} res
 */
export default async function handler(req, res) {
	const corsHeaders = {
		'Access-Control-Allow-Origin': '*',
		'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
		'Access-Control-Allow-Headers': 'Content-Type',
	};

	if (req.method === 'OPTIONS') {
		res.writeHead(204, corsHeaders);
		res.end();
		return;
	}

	const targetUrl = req.query.url;
	if (!targetUrl) {
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

	if (!['http:', 'https:'].includes(parsed.protocol)) {
		res.status(400).json({ error: 'Only HTTP(S) URLs allowed' });
		return;
	}

	try {
		const upstream = await fetch(targetUrl, {
			method: req.method,
			headers: { 'Accept': 'application/json' },
			body: req.method === 'POST' ? JSON.stringify(req.body) : undefined,
			signal: AbortSignal.timeout(30000),
		});

		const contentType = upstream.headers.get('content-type') || 'application/json';
		const body = await upstream.text();

		for (const [k, v] of Object.entries(corsHeaders)) {
			res.setHeader(k, v);
		}
		res.setHeader('Content-Type', contentType);
		res.status(upstream.status).send(body);
	} catch (err) {
		for (const [k, v] of Object.entries(corsHeaders)) {
			res.setHeader(k, v);
		}
		res.status(502).json({ error: `Upstream error: ${err.message}` });
	}
}
