import * as fs from 'node:fs';
import * as path from 'node:path';
import { cmsPathForPattern, scanPagesDir, type ScannedPageRoute } from '@patstore/octane-pages-plugin';
import { scanTsrxContent } from './scan-content.js';
import {
	NAMESPACE_EXPORT,
	declaresExport,
	extractImportBindings,
	extractReExports,
	resolveImportSpecifier,
} from './resolve-imports.js';
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

/** Per-`buildManifest` memoization: a shared component is read and scanned once, however many pages reach it. */
interface ScanContext {
	aliases: Record<string, string>;
	sources: Map<string, string>;
	modules: Map<string, CmsPageManifest | typeof IN_PROGRESS>;
	exports: Map<string, CmsPageManifest | typeof IN_PROGRESS>;
}

function readSource(filePath: string, context: ScanContext): string {
	const cached = context.sources.get(filePath);
	if (cached !== undefined) {
		return cached;
	}
	const source = fs.readFileSync(filePath, 'utf-8');
	context.sources.set(filePath, source);
	return source;
}

/**
 * Scans `filePath`'s own source for CMS marker components (`scanTsrxContent`),
 * then unions in the markers of everything it *imports*, recursively —
 * `<Section>`/`<Field>` markers carry their own identity regardless of which
 * file authors them, so a page whose content lives entirely in an imported
 * component (e.g. `<Home />`) still gets a full manifest.
 *
 * `export ... from` re-exports are deliberately not followed: a barrel that
 * re-exports every page's content component renders none of it, so following
 * those would union every page's sections into every page that imports from
 * the barrel. Named imports reach the defining module through
 * `scanExportedComponent` instead.
 */
function scanModule(filePath: string, context: ScanContext): CmsPageManifest {
	const cached = context.modules.get(filePath);
	if (cached === IN_PROGRESS) {
		return {};
	}
	if (cached) {
		return cached;
	}
	context.modules.set(filePath, IN_PROGRESS);

	const source = readSource(filePath, context);
	const merged: CmsPageManifest = { ...scanTsrxContent(source) };

	for (const binding of extractImportBindings(source)) {
		const resolved = resolveImportSpecifier(binding.specifier, filePath, context.aliases);
		if (!resolved) {
			continue;
		}
		if (binding.namespace) {
			Object.assign(merged, scanModule(resolved, context));
			continue;
		}
		for (const name of binding.names) {
			Object.assign(merged, scanExportedComponent(resolved, name, context));
		}
	}

	context.modules.set(filePath, merged);
	return merged;
}

/** Whether `filePath` provides `exportName` itself or through an `export *` chain — picks the right target among several star re-exports. */
function moduleProvidesExport(
	filePath: string,
	exportName: string,
	context: ScanContext,
	visited: Set<string>,
): boolean {
	if (visited.has(filePath)) {
		return false;
	}
	visited.add(filePath);

	const source = readSource(filePath, context);
	if (declaresExport(source, exportName)) {
		return true;
	}

	for (const reExport of extractReExports(source)) {
		if (reExport.names) {
			if (reExport.names.some((entry) => entry.exported === exportName)) {
				return true;
			}
			continue;
		}
		const target = resolveImportSpecifier(reExport.specifier, filePath, context.aliases);
		if (target && moduleProvidesExport(target, exportName, context, visited)) {
			return true;
		}
	}

	return false;
}

function resolveExportedComponent(filePath: string, exportName: string, context: ScanContext): CmsPageManifest {
	const source = readSource(filePath, context);
	const reExports = extractReExports(source);
	const starSpecifiers: string[] = [];

	for (const reExport of reExports) {
		if (!reExport.names) {
			starSpecifiers.push(reExport.specifier);
			continue;
		}
		const alias = reExport.names.find((entry) => entry.exported === exportName);
		if (!alias) {
			continue;
		}
		const target = resolveImportSpecifier(reExport.specifier, filePath, context.aliases);
		if (!target) {
			return {};
		}
		return alias.local === NAMESPACE_EXPORT
			? scanModule(target, context)
			: scanExportedComponent(target, alias.local, context);
	}

	if (starSpecifiers.length > 0 && !declaresExport(source, exportName)) {
		for (const specifier of starSpecifiers) {
			const target = resolveImportSpecifier(specifier, filePath, context.aliases);
			if (target && moduleProvidesExport(target, exportName, context, new Set())) {
				return scanExportedComponent(target, exportName, context);
			}
		}
		return {};
	}

	return scanModule(filePath, context);
}

/**
 * Markers of the module that actually defines `exportName`, following any
 * number of re-export barrels (`@content` → `content/index.ts` → `home/Home.tsrx`)
 * to get there. A barrel contributes only the one component the importer asked
 * for, never its siblings.
 */
function scanExportedComponent(filePath: string, exportName: string, context: ScanContext): CmsPageManifest {
	const cacheKey = `${filePath}::${exportName}`;
	const cached = context.exports.get(cacheKey);
	if (cached === IN_PROGRESS) {
		return {};
	}
	if (cached) {
		return cached;
	}
	context.exports.set(cacheKey, IN_PROGRESS);

	const resolved = resolveExportedComponent(filePath, exportName, context);
	context.exports.set(cacheKey, resolved);
	return resolved;
}

/**
 * Scans `src/pages/**\/*.tsrx` (and every local component they import,
 * transitively) for CMS marker components and builds a manifest keyed by
 * CMS content path. A page's `(lang)/` / `$lang/` prefix variants collapse
 * into a single manifest entry — one `Webpage` per path. Locale copy lives
 * under keys such as `de-DE` on `page_content`, alongside `default` (used when
 * the project has no languages or only one). Dynamic segments other than `$lang`
 * are kept as template literals (e.g. `/athletes/$slug`) so one `Webpage`
 * record can hold shared copy for every slug instance.
 * Splat routes (`.../$`) are skipped.
 *
 * `aliases` (alias prefix → absolute file path, e.g. from Vite's resolved
 * `resolve.alias`) lets the import-follower resolve `@content`/`@ui`/etc.
 * specifiers the same way the app's bundler does. Barrel aliases resolve per
 * imported name, so each page's manifest holds only the content it renders.
 */
export function buildManifest(pagesDir: string, aliases: Record<string, string> = {}): CmsManifest {
	const { routes, fileAliases } = scanPagesDir(pagesDir);
	const pages: Record<string, CmsPageManifest> = {};
	const context: ScanContext = {
		aliases,
		sources: new Map(),
		modules: new Map(),
		exports: new Map(),
	};

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
		const fields = scanModule(absolutePath, context);

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
