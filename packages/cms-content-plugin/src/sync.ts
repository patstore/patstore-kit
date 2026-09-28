import { flattenManifestToPaths } from './flatten.js';
import { toLocale } from './locale.js';
import { buildLocalizedPageContent, resolveLocalizedPageContent, schemasEqual } from './page-content.js';
import type { CmsContentMap, CmsManifest, CmsPathValue } from './types.js';
import { fetchProjectLanguages, findWebpageByPath, updateWebpage, type CmsRestEnv } from './patstore-rest.js';

/** Adds any paths present in `defaults` but missing from `existing` — never overwrites edited CMS values. */
function mergeMissingPaths(
	defaults: CmsPathValue[],
	existing: CmsPathValue[],
): { merged: CmsPathValue[]; addedPaths: string[] } {
	const byPath = new Map(existing.map((entry) => [entry.path, entry]));
	const addedPaths: string[] = [];

	for (const entry of defaults) {
		if (!byPath.has(entry.path)) {
			byPath.set(entry.path, entry);
			addedPaths.push(entry.path);
		}
	}

	return { merged: Array.from(byPath.values()), addedPaths };
}

export interface SyncManifestOptions {
	env: CmsRestEnv;
	manifest: CmsManifest;
	log?: (message: string) => void;
}

/**
 * For each scanned page, find its single `Webpage` record by `project` + `path`.
 * `page_content` is stored as `{ default, "de-DE", ... }`. `default` is what
 * the site reads when the project has no locales or only one.
 * Field defaults already edited for a locale are kept. `page_data` only gains
 * newly discovered paths.
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
		const defaults = flattenManifestToPaths(pageManifest);

		try {
			const existing = await findWebpageByPath(options.env, pagePath);

			if (!existing) {
				log(`skipped "${pagePath}" — no existing ${options.env.className} record`);
				continue;
			}

			const { merged, addedPaths } = mergeMissingPaths(defaults, existing.pageData);
			const localizedSchema = buildLocalizedPageContent(pageManifest, existing.schema, locales);
			const schemaChanged = !schemasEqual(existing.schema, localizedSchema);

			if (addedPaths.length > 0 || schemaChanged) {
				await updateWebpage(options.env, existing.objectId, {
					pageData: addedPaths.length > 0 ? merged : undefined,
					schema: schemaChanged ? localizedSchema : undefined,
				});
				if (addedPaths.length > 0) {
					log(`added ${addedPaths.length} new path(s) to "${pagePath}": ${addedPaths.join(', ')}`);
				}
				if (schemaChanged) {
					log(`updated ${options.env.schemaFieldName} for "${pagePath}"`);
				}
			}

			contentMap.pages[pagePath] = resolveLocalizedPageContent(pageManifest, localizedSchema, merged);
		} catch (error) {
			log(`sync failed for "${pagePath}" — using scanned defaults: ${(error as Error).message}`);
			contentMap.pages[pagePath] = buildLocalizedPageContent(pageManifest, null, locales);
		}
	}

	return contentMap;
}

/** Used when PatStore isn't configured — scanned schema under `default` and the default locale. */
export function contentMapFromDefaults(manifest: CmsManifest, defaultLang: string): CmsContentMap {
	const locale = toLocale(defaultLang);
	const pages: CmsContentMap['pages'] = {};
	for (const [pagePath, pageManifest] of Object.entries(manifest.pages)) {
		pages[pagePath] =
			locale === 'default' ? { default: pageManifest } : { default: pageManifest, [locale]: pageManifest };
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
