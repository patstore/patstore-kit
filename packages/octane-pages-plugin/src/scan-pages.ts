import * as fs from 'node:fs';
import * as path from 'node:path';

const PAGE_EXTENSION = '.tsrx';
const NOT_FOUND_FILE = '404.tsrx';
const INDEX_TOKEN = 'index';
/** Routes inside this folder match with and without a `/$lang` prefix */
export const OPTIONAL_LANG_DIR = '(lang)';

export interface ScannedPageRoute {
	/** Route pattern, e.g. `/`, `/about`, `/$lang/artikel`, `/posts/$postId` */
	pattern: string;
	/** Stable id for codegen switches */
	id: string;
	/** Path relative to the pages directory */
	file: string;
	/** Exported component name from the page file */
	componentName: string;
	/** Import path relative to `.generated/` */
	importPath: string;
}

export interface ScannedPages {
	routes: ScannedPageRoute[];
	notFound: {
		file: string;
		componentName: string;
		importPath: string;
		importAlias: string;
	} | null;
	/** Unique page files → stable import alias (avoids duplicate export name collisions) */
	fileAliases: Map<string, string>;
}

function isLowercaseRouteFile(relativePath: string): boolean {
	const withoutExt = relativePath.replace(/\.tsrx$/, '');
	return withoutExt.split('/').every((segment) => {
		if (segment.startsWith('[') && segment.endsWith(']')) {
			return true;
		}
		if (segment === OPTIONAL_LANG_DIR) {
			return true;
		}
		return segment === segment.toLowerCase();
	});
}

function unescapeSegment(segment: string): string {
	if (segment.startsWith('[') && segment.endsWith(']')) {
		return segment.slice(1, -1);
	}
	return segment;
}

function segmentsToPattern(segments: string[]): string {
	if (segments.length === 0) {
		return '/';
	}
	return `/${segments.map(unescapeSegment).join('/')}`;
}

/** TanStack Start-style route segments → one or more URL patterns */
export function routeSegmentsToPatterns(
	segments: string[],
	optionalLangPrefix: boolean,
): string[] {
	const pattern = segmentsToPattern(segments);
	if (!optionalLangPrefix) {
		return [pattern];
	}

	if (pattern === '/') {
		return ['/', '/$lang'];
	}

	return [pattern, segmentsToPattern(['$lang', ...segments])];
}

/** @deprecated Use routeSegmentsToPatterns — kept for tests/scripts */
export function filePathToRoutePattern(relativePath: string): string | null {
	if (relativePath === NOT_FOUND_FILE) {
		return null;
	}

	const withoutExt = relativePath.replace(/\.tsrx$/, '');
	const rawSegments = withoutExt.split('/').map(unescapeSegment);
	const optionalLangPrefix = rawSegments[0] === OPTIONAL_LANG_DIR;
	const segments = optionalLangPrefix ? rawSegments.slice(1) : rawSegments;

	if (segments[segments.length - 1] === INDEX_TOKEN) {
		segments.pop();
	}

	return routeSegmentsToPatterns(segments, optionalLangPrefix)[0] ?? null;
}

export function patternToRouteId(pattern: string): string {
	if (pattern === '/') {
		return INDEX_TOKEN;
	}
	if (pattern === '/$lang') {
		return 'lang';
	}
	return pattern
		.slice(1)
		.split('/')
		.map((segment) => (segment.startsWith('$') ? segment.slice(1) : segment))
		.join('_');
}

export function fileToImportAlias(relativePath: string): string {
	const base = relativePath
		.replace(/\.tsrx$/, '')
		.replace(/\//g, '_')
		.replace(/[^a-zA-Z0-9_]/g, '');
	return `Page_${base || 'index'}`;
}

function readComponentName(filePath: string): string {
	const source = fs.readFileSync(filePath, 'utf-8');
	const match = source.match(/export\s+function\s+([A-Za-z_$][\w$]*)/);
	if (match) {
		return match[1];
	}

	const base = path.basename(filePath, PAGE_EXTENSION);
	if (base === INDEX_TOKEN) {
		return 'IndexPage';
	}
	return `${base.charAt(0).toUpperCase()}${base.slice(1)}Page`;
}

interface WalkContext {
	routeSegments: string[];
	optionalLangPrefix: boolean;
}

function walkPagesDir(pagesDir: string, currentDir = pagesDir, context: WalkContext = {
	routeSegments: [],
	optionalLangPrefix: false,
}): string[] {
	const entries = fs.readdirSync(currentDir, { withFileTypes: true });
	const files: string[] = [];

	for (const entry of entries) {
		if (entry.name.startsWith('.') || entry.name.startsWith('_')) {
			continue;
		}

		const absolutePath = path.join(currentDir, entry.name);
		if (entry.isDirectory()) {
			if (entry.name === '.generated') {
				continue;
			}
			if (entry.name === OPTIONAL_LANG_DIR) {
				files.push(
					...walkPagesDir(pagesDir, absolutePath, {
						routeSegments: context.routeSegments,
						optionalLangPrefix: true,
					}),
				);
				continue;
			}
			files.push(
				...walkPagesDir(pagesDir, absolutePath, {
					routeSegments: [...context.routeSegments, entry.name],
					optionalLangPrefix: context.optionalLangPrefix,
				}),
			);
			continue;
		}

		if (!entry.name.endsWith(PAGE_EXTENSION)) {
			continue;
		}

		files.push(path.relative(pagesDir, absolutePath).replace(/\\/g, '/'));
	}

	return files.sort();
}

function routeSegmentsForFile(relativePath: string): { segments: string[]; optionalLangPrefix: boolean } {
	const withoutExt = relativePath.replace(/\.tsrx$/, '');
	const rawSegments = withoutExt.split('/');
	const optionalLangPrefix = rawSegments[0] === OPTIONAL_LANG_DIR;
	const segments = (optionalLangPrefix ? rawSegments.slice(1) : rawSegments).map(unescapeSegment);

	if (segments[segments.length - 1] === INDEX_TOKEN) {
		segments.pop();
	}

	return { segments, optionalLangPrefix };
}

export function scanPagesDir(pagesDir: string): ScannedPages {
	if (!fs.existsSync(pagesDir)) {
		return { routes: [], notFound: null, fileAliases: new Map() };
	}

	const files = walkPagesDir(pagesDir);
	const routes: ScannedPageRoute[] = [];
	const fileAliases = new Map<string, string>();
	let notFound: ScannedPages['notFound'] = null;

	for (const file of files) {
		if (!isLowercaseRouteFile(file)) {
			throw new Error(
				`Page file "${file}" must use lowercase segments (TanStack Start convention).`,
			);
		}

		const absolutePath = path.join(pagesDir, file);
		const importAlias = fileToImportAlias(file);
		fileAliases.set(file, importAlias);

		if (file === NOT_FOUND_FILE) {
			notFound = {
				file,
				componentName: readComponentName(absolutePath),
				importPath: `../${file}`,
				importAlias,
			};
			continue;
		}

		const { segments, optionalLangPrefix } = routeSegmentsForFile(file);
		const patterns = routeSegmentsToPatterns(segments, optionalLangPrefix);
		const componentName = readComponentName(absolutePath);
		const importPath = `../${file}`;

		for (const pattern of patterns) {
			routes.push({
				pattern,
				id: patternToRouteId(pattern),
				file,
				componentName,
				importPath,
			});
		}
	}

	routes.sort((a, b) => {
		const aDynamic = a.pattern.includes('$');
		const bDynamic = b.pattern.includes('$');
		if (aDynamic !== bDynamic) {
			return aDynamic ? 1 : -1;
		}
		return b.pattern.length - a.pattern.length;
	});

	return { routes, notFound, fileAliases };
}

export function importAliasForRoute(route: ScannedPageRoute, fileAliases: Map<string, string>): string {
	return fileAliases.get(route.file) ?? fileToImportAlias(route.file);
}
