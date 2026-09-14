/**
 * Reads Vite's `resolve.alias` whether the user authored it as a plain object
 * (`{ '@content': '/abs/path' }`) or as Vite's normalized `{ find, replacement }[]`.
 */
export function aliasesFromViteConfig(alias: unknown): Record<string, string> {
	const aliases: Record<string, string> = {};
	if (!alias) {
		return aliases;
	}

	if (Array.isArray(alias)) {
		for (const entry of alias) {
			if (!entry || typeof entry !== 'object') {
				continue;
			}
			const { find, replacement } = entry as { find: unknown; replacement: unknown };
			if (typeof find === 'string' && typeof replacement === 'string') {
				aliases[find] = replacement;
			}
		}
		return aliases;
	}

	if (typeof alias === 'object') {
		for (const [key, value] of Object.entries(alias)) {
			if (typeof value === 'string') {
				aliases[key] = value;
			}
		}
	}

	return aliases;
}
