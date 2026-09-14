import * as fs from 'node:fs';
import * as path from 'node:path';
import { cmsPathForPattern, scanPagesDir, type ScannedPageRoute } from '@patstore/octane-pages-plugin';
import { scanTsrxContent } from './scan-content.js';
import { extractImportSpecifiers, resolveImportSpecifier } from './resolve-imports.js';
import type { CmsManifest, CmsPageManifest } from './types.js';

/** Picks the first route pattern (across a file's `(lang)/`/`$lang/` variants) that resolves to a CMS path. */
function cmsPathForFile(routes: ScannedPageRoute[]): string | null {
	for (const route of routes) {
		const cmsPath = cmsPathForPattern(route.pattern);
		if (cmsPath) {
			return cmsPath;
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
 * CMS content path. A page's `(lang)/` / `$lang/` prefix variants collapse
 * into a single manifest entry — language differentiation happens at sync
 * time via PatStore's `lang` field, not via separate paths. Dynamic segments
 * other than `$lang` are kept as template literals (e.g. `/athletes/$slug`)
 * so one `Webpage` record can hold shared copy for every slug instance.
 * Splat routes (`.../$`) are skipped.
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
		const cmsPath = cmsPathForFile(fileRoutes);
		if (!cmsPath) {
			continue;
		}

		const absolutePath = path.join(pagesDir, file);
		const fields = scanFileWithImports(absolutePath, aliases, cache);

		if (Object.keys(fields).length > 0) {
			pages[cmsPath] = fields;
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
