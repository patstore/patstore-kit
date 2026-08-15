import * as fs from 'node:fs';
import * as path from 'node:path';
import { scanPagesDir, type ScannedPageRoute } from '@patstore/octane-pages-plugin';
import { scanTsrxContent } from './scan-content.js';
import { extractImportSpecifiers, resolveImportSpecifier } from './resolve-imports.js';
import type { CmsManifest, CmsPageManifest } from './types.js';

/**
 * Strips a lone `$lang` segment from a route pattern to get its canonical,
 * language-agnostic path (e.g. `/$lang/artikel` → `/artikel`). Returns
 * `null` when the pattern has *other* dynamic segments (`$post_id`, splat)
 * — those belong to PatStore collections, not page-level CMS content.
 */
function canonicalizePattern(pattern: string): string | null {
	const segments = pattern.split('/').filter(Boolean);
	if (segments.some((segment) => segment.startsWith('$') && segment !== '$lang')) {
		return null;
	}
	const stripped = segments.filter((segment) => segment !== '$lang');
	return stripped.length === 0 ? '/' : `/${stripped.join('/')}`;
}

/** Picks the first route pattern (across a file's `(lang)/`/`$lang/` variants) that resolves to a canonical path. */
function canonicalPathForFile(routes: ScannedPageRoute[]): string | null {
	for (const route of routes) {
		const canonical = canonicalizePattern(route.pattern);
		if (canonical) {
			return canonical;
		}
	}
	return null;
}

const IN_PROGRESS = Symbol('cms-content:scan-in-progress');

/**
 * Scans `filePath`'s own source for CMS marker components (`scanTsrxContent`),
 * then recursively scans every locally-resolvable import (`resolve-imports.ts`)
 * and unions their marker nodes in — `<Section>`/`<Field>` markers carry their
 * own identity regardless of which file authors them, so a page whose content
 * lives entirely in an imported component (e.g. `<Home />`) still gets a full
 * manifest. Memoized by absolute path across the whole `buildManifest` run
 * (a shared component is scanned once no matter how many pages import it),
 * with a cycle guard for import loops.
 */
function scanFileWithImports(
	filePath: string,
	aliases: Record<string, string>,
	cache: Map<string, CmsPageManifest | typeof IN_PROGRESS>,
): CmsPageManifest {
	const cached = cache.get(filePath);
	if (cached === IN_PROGRESS) {
		return {};
	}
	if (cached) {
		return cached;
	}
	cache.set(filePath, IN_PROGRESS);

	const source = fs.readFileSync(filePath, 'utf-8');
	const merged: CmsPageManifest = { ...scanTsrxContent(source) };

	for (const specifier of extractImportSpecifiers(source)) {
		const resolved = resolveImportSpecifier(specifier, filePath, aliases);
		if (resolved) {
			Object.assign(merged, scanFileWithImports(resolved, aliases, cache));
		}
	}

	cache.set(filePath, merged);
	return merged;
}

/**
 * Scans `src/pages/**\/*.tsrx` (and every local component they import,
 * transitively) for CMS marker components and builds a manifest keyed by
 * canonical, language-agnostic path. A page's `(lang)/` / `$lang/` prefix
 * variants collapse into a single manifest entry — language differentiation
 * happens at sync time via PatStore's `lang` field, not via separate paths.
 * Routes with *other* dynamic segments (`$post_id`, splat) are skipped —
 * page-level CMS content only applies to static routes; per-record content
 * belongs to PatStore collections instead.
 *
 * `aliases` (alias prefix → absolute file path, e.g. from Vite's resolved
 * `resolve.alias`) lets the import-follower resolve `@content`/`@ui`/etc.
 * specifiers the same way the app's bundler does.
 */
export function buildManifest(pagesDir: string, aliases: Record<string, string> = {}): CmsManifest {
	const { routes, fileAliases } = scanPagesDir(pagesDir);
	const pages: Record<string, CmsPageManifest> = {};
	const cache = new Map<string, CmsPageManifest | typeof IN_PROGRESS>();

	const routesByFile = new Map<string, ScannedPageRoute[]>();
	for (const route of routes) {
		const forFile = routesByFile.get(route.file) ?? [];
		forFile.push(route);
		routesByFile.set(route.file, forFile);
	}

	for (const [file, fileRoutes] of routesByFile) {
		const canonicalPath = canonicalPathForFile(fileRoutes);
		if (!canonicalPath) {
			continue;
		}

		const absolutePath = path.join(pagesDir, file);
		const fields = scanFileWithImports(absolutePath, aliases, cache);

		if (Object.keys(fields).length > 0) {
			pages[canonicalPath] = fields;
		}
	}

	void fileAliases;
	return { pages };
}

export function writeManifest(outputDir: string, manifest: CmsManifest): void {
	fs.mkdirSync(outputDir, { recursive: true });
	fs.writeFileSync(
		path.join(outputDir, 'cms-manifest.json'),
		JSON.stringify(manifest, null, 2),
		'utf-8',
	);
}
