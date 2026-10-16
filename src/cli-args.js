export const DEFAULT_LCD = 'https://lcd.osmosis.zone';

/**
 * Resolve an LCD/REST endpoint from CLI args and the environment.
 * Accepts `--lcd <url>` or `--lcd=<url>`, otherwise falls back to `COSMOS_LCD`,
 * otherwise `DEFAULT_LCD`. Consumed flag tokens are removed from `args`.
 * @param {string[]} args - Mutable process.argv slice
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {string} endpoint URL without a trailing slash
 * @throws {Error} when `--lcd` is present without a value
 */
export function resolveLcd(args, env = process.env) {
	const equals = args.findIndex(arg => arg.startsWith('--lcd='));
	if (equals !== -1) {
		const value = args[equals].slice('--lcd='.length);
		args.splice(equals, 1);
		if (!value) throw new Error('--lcd requires a URL');
		return value.replace(/\/+$/, '');
	}

	const index = args.indexOf('--lcd');
	if (index !== -1) {
		const value = args[index + 1];
		if (!value || value.startsWith('-')) throw new Error('--lcd requires a URL');
		args.splice(index, 2);
		return value.replace(/\/+$/, '');
	}

	return (env.COSMOS_LCD || DEFAULT_LCD).replace(/\/+$/, '');
}
