import * as fs from 'node:fs';
import * as path from 'node:path';

/** Matches one `import`/`export ... from '<specifier>'` clause, bounded by the statement's own semicolon. */
const IMPORT_SPECIFIER_REGEX = /\b(?:import|export)\b[^;]*?\bfrom\s*['"]([^'"]+)['"]/g;

const CANDIDATE_SUFFIXES = ['', '.tsrx', '.ts', '.tsx', '/index.tsrx', '/index.ts', '/index.tsx'];

/** Extracts every `from '...'` import/export specifier in `source`, in source order. */
export function extractImportSpecifiers(source: string): string[] {
	const specifiers: string[] = [];
	let match: RegExpExecArray | null;
	IMPORT_SPECIFIER_REGEX.lastIndex = 0;
	while ((match = IMPORT_SPECIFIER_REGEX.exec(source))) {
		specifiers.push(match[1]);
	}
	return specifiers;
}

function tryResolveFile(basePath: string): string | null {
	for (const suffix of CANDIDATE_SUFFIXES) {
		const candidate = basePath + suffix;
		if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
			return candidate;
		}
	}
	return null;
}

/**
 * Resolves an import specifier from `importingFile` to an absolute local
 * `.ts`/`.tsrx` file, or `null` when it isn't a local file (bare package
 * imports like `octane`/`gsap`, or an alias/relative path that doesn't
 * resolve to anything on disk) — those are simply not followed further.
 *
 * `aliases` maps an alias prefix (e.g. `@content`) to the absolute path
 * Vite resolves it to (a file, per this project's `resolve.alias` convention
 * of pointing aliases at barrel `index.ts` files).
 */
export function resolveImportSpecifier(
	specifier: string,
	importingFile: string,
	aliases: Record<string, string>,
): string | null {
	if (specifier.startsWith('.')) {
		return tryResolveFile(path.resolve(path.dirname(importingFile), specifier));
	}

	for (const [alias, target] of Object.entries(aliases)) {
		if (specifier === alias) {
			return tryResolveFile(target);
		}
		if (specifier.startsWith(`${alias}/`)) {
			return tryResolveFile(path.join(path.dirname(target), specifier.slice(alias.length + 1)));
		}
	}

	return null;
}
