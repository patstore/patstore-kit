import * as fs from 'node:fs';
import * as path from 'node:path';
import { scanPagesDir, type ScannedPageRoute } from '@patstore/octane-pages-plugin';
import { scanTsrxContent } from './scan-content.js';
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

/**
 * Scans `src/pages/**\/*.tsrx` for `data-cms` markers and builds a manifest
 * keyed by canonical, language-agnostic path. A page's `(lang)/` / `$lang/`
 * prefix variants collapse into a single manifest entry — language
 * differentiation happens at sync time via PatStore's `lang` field, not via
 * separate paths. Routes with *other* dynamic segments (`$post_id`, splat)
 * are skipped — page-level CMS content only applies to static routes;
 * per-record content belongs to PatStore collections instead.
 */
export function buildManifest(pagesDir: string): CmsManifest {
	const { routes, fileAliases } = scanPagesDir(pagesDir);
	const pages: Record<string, CmsPageManifest> = {};
	const scannedFiles = new Map<string, CmsPageManifest>();

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

		let fields = scannedFiles.get(file);
		if (!fields) {
			const absolutePath = path.join(pagesDir, file);
			const source = fs.readFileSync(absolutePath, 'utf-8');
			fields = scanTsrxContent(source);
			scannedFiles.set(file, fields);
		}

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
