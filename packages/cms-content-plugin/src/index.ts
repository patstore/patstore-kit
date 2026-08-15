import * as fs from 'node:fs';
import * as path from 'node:path';
import type { Plugin } from 'vite';
import { buildManifest, writeManifest } from './manifest.js';
import { writeContentArtifacts, writeStubContentArtifacts } from './codegen.js';
import { contentMapFromDefaults, syncManifestToPatStore } from './sync.js';
import { flattenManifestToPaths } from './flatten.js';
import type { CmsRestEnv } from './patstore-rest.js';

export interface CmsContentPluginOptions {
	/** Directory containing route page files. Default: `src/pages` */
	pagesDir?: string;
	/** Generated output directory (manifest + resolved content). Default: `cms-content` */
	outputDir?: string;
	/** PatStore class storing page content. Default: `Webpage` */
	className?: string;
	/** Array-type field on `className` holding `{ path, value }` entries (edited values). Default: `page_data` */
	fieldName?: string;
	/** Field on `className` holding the nested field schema PatStore's editor renders from. Default: `page_content` */
	schemaFieldName?: string;
	/**
	 * className the `project` pointer field targets. Set to `null` if `project`
	 * is a plain string field instead of a Pointer. Default: `Project`
	 */
	projectPointerClassName?: string | null;
	/** Sync scanned defaults to PatStore (update existing `Webpage` records). Default: true unless `VITE_CMS_CONTENT_SYNC=false` */
	sync?: boolean;
	/** Fail the build when sync fails. Default: false (warns and falls back to defaults). */
	strictSync?: boolean;
	env?: Record<string, string | undefined>;
}

function readRestEnv(
	env: Record<string, string | undefined>,
	options: CmsContentPluginOptions,
	defaultLang: string,
): CmsRestEnv | null {
	const apiUrl = env.VITE_PATSTORE_API_URL;
	const appId = env.VITE_PATSTORE_APP_ID;
	const projectId = env.VITE_PATSTORE_PROJECT_ID;
	const masterKey = env.PATSTORE_MASTER_KEY ?? env.VITE_PATSTORE_MASTER_KEY;
	const restKey = env.VITE_PATSTORE_REST_KEY;

	if (!apiUrl || !appId || !projectId || (!masterKey && !restKey)) {
		return null;
	}

	return {
		apiUrl,
		appId,
		projectId,
		masterKey,
		restKey,
		className: options.className ?? env.VITE_CMS_CONTENT_CLASS ?? 'Webpage',
		fieldName: options.fieldName ?? env.VITE_CMS_CONTENT_FIELD ?? 'page_data',
		schemaFieldName: options.schemaFieldName ?? env.VITE_CMS_CONTENT_SCHEMA_FIELD ?? 'page_content',
		projectPointerClassName:
			options.projectPointerClassName !== undefined
				? options.projectPointerClassName
				: (env.VITE_PATSTORE_PROJECT_CLASS ?? 'Project'),
		defaultLang,
	};
}

/** Narrows Vite's resolved `resolve.alias` array down to the string-keyed entries our regex-based import follower can match. */
function stringAliasesFromViteConfig(alias: unknown): Record<string, string> {
	const entries = Array.isArray(alias) ? alias : [];
	const aliases: Record<string, string> = {};
	for (const entry of entries as Array<{ find: unknown; replacement: unknown }>) {
		if (typeof entry.find === 'string' && typeof entry.replacement === 'string') {
			aliases[entry.find] = entry.replacement;
		}
	}
	return aliases;
}

export function cmsContentPlugin(options: CmsContentPluginOptions = {}): Plugin {
	const outputDir = path.resolve(process.cwd(), options.outputDir ?? 'cms-content');
	let root = process.cwd();
	let resolvedEnv: Record<string, string | undefined> = options.env ?? {};
	let aliases: Record<string, string> = {};

	const runPipeline = async () => {
		const pagesDir = path.resolve(root, options.pagesDir ?? 'src/pages');
		const defaultLang = resolvedEnv.DEFAULT_LANG ?? 'en';
		const manifest = buildManifest(pagesDir, aliases);
		writeManifest(outputDir, manifest);

		const pageCount = Object.keys(manifest.pages).length;
		const pathCount = Object.values(manifest.pages).reduce(
			(sum, pageManifest) => sum + flattenManifestToPaths(pageManifest).length,
			0,
		);
		console.log(`ℹ CMS content: scanned ${pageCount} page(s), ${pathCount} field(s)`);

		const syncEnabled = options.sync ?? resolvedEnv.VITE_CMS_CONTENT_SYNC !== 'false';
		if (!syncEnabled) {
			console.log('ℹ CMS content sync disabled (VITE_CMS_CONTENT_SYNC=false)');
			writeContentArtifacts(outputDir, contentMapFromDefaults(manifest, defaultLang));
			return;
		}

		const restEnv = readRestEnv(resolvedEnv, options, defaultLang);
		if (!restEnv) {
			console.warn(
				'⚠ CMS content sync skipped — set PATSTORE_MASTER_KEY (or VITE_PATSTORE_REST_KEY) plus VITE_PATSTORE_* vars. Using scanned defaults.',
			);
			writeContentArtifacts(outputDir, contentMapFromDefaults(manifest, defaultLang));
			return;
		}

		try {
			const content = await syncManifestToPatStore({
				env: restEnv,
				manifest,
				log: (message) => console.log(`   ${message}`),
			});
			writeContentArtifacts(outputDir, content);
			console.log(`✅ CMS content synced with PatStore "${restEnv.className}" [${content._meta.languages.join(', ')}]`);
		} catch (error) {
			console.error('❌ CMS content sync failed:', error);
			if (options.strictSync) {
				throw error;
			}
			console.warn('⚠ Falling back to scanned defaults.');
			writeContentArtifacts(outputDir, contentMapFromDefaults(manifest, defaultLang));
		}
	};

	return {
		name: 'vite-plugin-cms-content',
		enforce: 'pre',

		configResolved(config) {
			root = config.root;
			resolvedEnv = { ...resolvedEnv, ...(config as { env?: Record<string, string> }).env };
			aliases = stringAliasesFromViteConfig(config.resolve?.alias);
		},

		async buildStart() {
			if (!fs.existsSync(outputDir)) {
				writeStubContentArtifacts(outputDir);
			}
			await runPipeline();
		},

		configureServer(server) {
			// Content markers can live anywhere under `src/` now (not just `pagesDir`)
			// — a page can render its content through an imported component — so
			// watch the whole source tree rather than just the pages directory.
			const watchDir = path.resolve(root, 'src');
			if (!fs.existsSync(watchDir)) {
				return;
			}

			let pending = false;
			fs.watch(watchDir, { recursive: true }, (_event, filename) => {
				if (!filename || !/\.(tsrx|ts)$/.test(filename) || filename.includes('.generated') || pending) {
					return;
				}
				pending = true;
				setTimeout(() => {
					pending = false;
					runPipeline()
						.then(() => server.ws.send({ type: 'full-reload' }))
						.catch((error) => console.error('❌ CMS content re-scan failed:', error));
				}, 150);
			});
		},
	};
}

export { buildManifest, writeManifest } from './manifest.js';
export { scanTsrxContent } from './scan-content.js';
export { extractImportSpecifiers, resolveImportSpecifier } from './resolve-imports.js';
export { flattenManifestToPaths, pathValuesToMap } from './flatten.js';
export { contentMapFromDefaults, syncManifestToPatStore } from './sync.js';
export { writeContentArtifacts, writeStubContentArtifacts } from './codegen.js';
export { fetchProjectLanguages } from './patstore-rest.js';
export type { CmsRestEnv } from './patstore-rest.js';
export type { CmsContentMap, CmsFieldNode, CmsManifest, CmsNode, CmsPageManifest, CmsPathValue, CmsSectionNode } from './types.js';
