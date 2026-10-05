import { flattenManifestToPaths } from './flatten.js';
import { toLocale } from './locale.js';
import { buildLocalizedPageContent, schemasEqual } from './page-content.js';
import type { CmsContentMap, CmsManifest } from './types.js';
import { fetchProjectLanguages, findWebpageByPath, updateWebpage, type CmsRestEnv } from './patstore-rest.js';

export interface SyncManifestOptions {
	env: CmsRestEnv;
	manifest: CmsManifest;
	log?: (message: string) => void;
}

/**
 * For each scanned page, find its single `Webpage` record by `project` + `path`.
 * `page_content` (the field schema) is written as `{ default, "de-DE", ... }`.
 * `page_data` is only read — an external CMS owns that field, so this plugin never writes it.
 * The returned entries are `page_data` as stored (`{ path, value }`), with the locale
 * already in the path (`de-DE.home_start.title`).
 */
export async function syncManifestToPatStore(options: SyncManifestOptions): Promise<CmsContentMap> {
	const log = options.log ?? (() => {});
	const locales = await fetchProjectLanguages(options.env);
	const contentMap: CmsContentMap = {
		_meta: {
			generatedAt: new Date().toISOString(),
			projectId: options.env.projectId,
			source: 'cms',
			languages: locales,
		},
		pages: {},
	};

	for (const [pagePath, pageManifest] of Object.entries(options.manifest.pages)) {
		try {
			const existing = await findWebpageByPath(options.env, pagePath);

			if (!existing) {
				log(`skipped "${pagePath}" — no existing ${options.env.className} record`);
				continue;
			}

			const localizedSchema = buildLocalizedPageContent(pageManifest, existing.schema, locales);
			if (!schemasEqual(existing.schema, localizedSchema)) {
				await updateWebpage(options.env, existing.objectId, localizedSchema);
				log(`updated ${options.env.schemaFieldName} for "${pagePath}"`);
			}

			contentMap.pages[pagePath] = existing.pageData;
		} catch (error) {
			log(`sync failed for "${pagePath}" — using scanned defaults: ${(error as Error).message}`);
			contentMap.pages[pagePath] = flattenManifestToPaths(pageManifest);
		}
	}

	return contentMap;
}

/** Used when PatStore isn't configured — scanned defaults as a flat `page_data` map. */
export function contentMapFromDefaults(manifest: CmsManifest, defaultLang: string): CmsContentMap {
	const locale = toLocale(defaultLang);
	const pages: CmsContentMap['pages'] = {};
	for (const [pagePath, pageManifest] of Object.entries(manifest.pages)) {
		pages[pagePath] = flattenManifestToPaths(pageManifest);
	}
	return {
		_meta: {
			generatedAt: new Date().toISOString(),
			projectId: '',
			source: 'defaults',
			languages: locale === 'default' ? [] : [locale],
		},
		pages,
	};
}
