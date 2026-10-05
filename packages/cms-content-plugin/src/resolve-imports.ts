import * as fs from 'node:fs';
import * as path from 'node:path';

/** Matches one `import`/`export ... from '<specifier>'` clause, bounded by the statement's own semicolon. */
const IMPORT_SPECIFIER_REGEX = /\b(?:import|export)\b[^;]*?\bfrom\s*['"]([^'"]+)['"]/g;
/** Matches one static `import <clause> from '<specifier>'`. The clause can't span quotes, so side-effect imports don't bleed in. */
const IMPORT_CLAUSE_REGEX = /\bimport\b(?!\s*\()([^;'"]*?)\bfrom\s*['"]([^'"]+)['"]/g;
/** Matches one `export <clause> from '<specifier>'` re-export. */
const REEXPORT_CLAUSE_REGEX = /\bexport\b([^;'"]*?)\bfrom\s*['"]([^'"]+)['"]/g;

const CANDIDATE_SUFFIXES = ['', '.tsrx', '.ts', '.tsx', '/index.tsrx', '/index.ts', '/index.tsx'];

/** `local` of a `export * as NS from '...'` entry — the whole target module stands behind the name. */
export const NAMESPACE_EXPORT = '*';

/** One static `import ... from '<specifier>'`, reduced to the export names it reads. */
export interface ImportedBinding {
	specifier: string;
	/** Export names read from the module — `default` for a default import. */
	names: string[];
	/** `import * as ns from '...'` — the module's whole surface is in scope, so no single name applies. */
	namespace: boolean;
}

/** One `export ... from '<specifier>'`. `names` is `null` for `export * from '...'`. */
export interface ReExportedBinding {
	specifier: string;
	names: Array<{ exported: string; local: string }> | null;
}

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

/** Parses the inside of a `{ a, b as c }` clause into `{ exported, local }` pairs (`local` is the name in the source module). */
function parseNamedClause(list: string): Array<{ exported: string; local: string }> {
	const entries: Array<{ exported: string; local: string }> = [];
	for (const raw of list.split(',')) {
		const part = raw.trim().replace(/^type\s+/, '');
		if (!part) {
			continue;
		}
		const [local, exported] = part.split(/\s+as\s+/).map((segment) => segment.trim());
		if (local) {
			entries.push({ local, exported: exported || local });
		}
	}
	return entries;
}

/**
 * Parses `source`'s static import statements into the export names they read.
 * `import type` clauses are skipped — a type can never render content markers.
 */
export function extractImportBindings(source: string): ImportedBinding[] {
	const bindings: ImportedBinding[] = [];
	let match: RegExpExecArray | null;
	IMPORT_CLAUSE_REGEX.lastIndex = 0;

	while ((match = IMPORT_CLAUSE_REGEX.exec(source))) {
		const [, clause, specifier] = match;
		if (/^\s*type\b/.test(clause)) {
			continue;
		}
		if (clause.includes('*')) {
			bindings.push({ specifier, names: [], namespace: true });
			continue;
		}

		const names: string[] = [];
		const named = /\{([^}]*)\}/.exec(clause);
		if (named) {
			names.push(...parseNamedClause(named[1]).map((entry) => entry.local));
		}
		const defaultBinding = clause.replace(/\{[^}]*\}/, '').replace(/,/g, ' ').trim();
		if (/^[\w$]+$/.test(defaultBinding)) {
			names.push('default');
		}

		bindings.push({ specifier, names, namespace: false });
	}

	return bindings;
}

/** Parses `source`'s `export ... from '...'` re-exports. */
export function extractReExports(source: string): ReExportedBinding[] {
	const reExports: ReExportedBinding[] = [];
	let match: RegExpExecArray | null;
	REEXPORT_CLAUSE_REGEX.lastIndex = 0;

	while ((match = REEXPORT_CLAUSE_REGEX.exec(source))) {
		const [, clause, specifier] = match;
		const namespaceAlias = /\*\s+as\s+([\w$]+)/.exec(clause);
		if (namespaceAlias) {
			reExports.push({ specifier, names: [{ exported: namespaceAlias[1], local: NAMESPACE_EXPORT }] });
			continue;
		}
		if (clause.includes('*')) {
			reExports.push({ specifier, names: null });
			continue;
		}
		const named = /\{([^}]*)\}/.exec(clause);
		reExports.push({ specifier, names: named ? parseNamedClause(named[1]) : [] });
	}

	return reExports;
}

/** Whether `source` declares `exportName` itself, as opposed to re-exporting it from elsewhere. */
export function declaresExport(source: string, exportName: string): boolean {
	if (exportName === 'default') {
		return /\bexport\s+default\b/.test(source);
	}

	const escaped = exportName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	const declaration = new RegExp(
		`\\bexport\\s+(?:declare\\s+)?(?:async\\s+)?(?:function|class|const|let|var)\\s+${escaped}\\b`,
	);
	if (declaration.test(source)) {
		return true;
	}

	const localExportList = /\bexport\s*\{([^}]*)\}(?!\s*from)/g;
	let match: RegExpExecArray | null;
	while ((match = localExportList.exec(source))) {
		if (parseNamedClause(match[1]).some((entry) => entry.exported === exportName)) {
			return true;
		}
	}

	return false;
}

/** `./foo.js` written in a TS source lives on disk as `./foo.ts`/`.tsx`/`.tsrx`. */
function candidatePaths(basePath: string): string[] {
	const candidates = CANDIDATE_SUFFIXES.map((suffix) => basePath + suffix);
	const jsExtension = /\.jsx?$/.exec(basePath);
	if (jsExtension) {
		const withoutExtension = basePath.slice(0, -jsExtension[0].length);
		candidates.push(...['.tsrx', '.ts', '.tsx'].map((extension) => withoutExtension + extension));
	}
	return candidates;
}

function tryResolveFile(basePath: string): string | null {
	for (const candidate of candidatePaths(basePath)) {
		if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
			return candidate;
		}
	}
	return null;
}

/** Base directory for `@alias/subpath` — the alias target when it is a folder, otherwise its parent dir. */
function aliasSubpathBase(target: string): string {
	try {
		if (fs.existsSync(target) && fs.statSync(target).isDirectory()) {
			return target;
		}
	} catch {
		// Missing path on disk — fall back to dirname (file-style alias target).
	}
	return path.dirname(target);
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
			return tryResolveFile(path.join(aliasSubpathBase(target), specifier.slice(alias.length + 1)));
		}
	}

	return null;
}
