import { flattenManifestToPaths, pathValuesToMap } from './flatten.js';
import type { CmsContentMap, CmsManifest, CmsPageContent, CmsPageManifest, CmsPathValue } from './types.js';
import { fetchProjectLanguages, findWebpageByPath, updateWebpage, type CmsRestEnv } from './patstore-rest.js';

/** Deep-equality check via JSON serialization — schema nodes are plain scanned data, so key order is stable. */
function schemasEqual(a: unknown, b: unknown): boolean {
	return JSON.stringify(a) === JSON.stringify(b);
}

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
 * For each scanned page, for each language in `Project.settings.languages`
 * (or `[env.defaultLang]` when absent): find its `Webpage` record (by
 * `project` + `path` + `lang`), skip when missing, or update it in place — `schemaFieldName` (default `page_content`)
 * is fully overwritten with the freshly scanned field schema whenever code
 * changes it (PatStore's editor renders from this), while `fieldName`
 * (default `page_data`) only gets newly-discovered paths appended, never
 * overwriting values already edited in the CMS. Legacy records created
 * before `lang` existed are adopted (backfilled) rather than duplicated —
 * see `findWebpageByPath`. Returns the resolved content per page per
 * language as a `{ path: value }` map (CMS values merged over defaults)
 * for the runtime to apply.
 */
export async function syncManifestToPatStore(options: SyncManifestOptions): Promise<CmsContentMap> {
	const log = options.log ?? (() => {});
	const languages = await fetchProjectLanguages(options.env);
	const contentMap: CmsContentMap = {
		_meta: {
			generatedAt: new Date().toISOString(),
			projectId: options.env.projectId,
			source: 'cms',
			languages,
		},
		pages: {},
	};

	for (const [pagePath, pageManifest] of Object.entries(options.manifest.pages)) {
		const defaults = flattenManifestToPaths(pageManifest);
		const perLang: Record<string, CmsPageContent> = {};
		contentMap.pages[pagePath] = perLang;

		for (const lang of languages) {
			try {
				const existing = await findWebpageByPath(options.env, pagePath, lang);

				if (!existing) {
					log(`skipped "${pagePath}" [${lang}] — no existing ${options.env.className} record`);
					continue;
				}

				const { merged, addedPaths } = mergeMissingPaths(defaults, existing.pageData);
				const schemaChanged = !schemasEqual(existing.schema, pageManifest as CmsPageManifest);
				const needsLangBackfill = existing.lang !== lang;

				if (addedPaths.length > 0 || schemaChanged || needsLangBackfill) {
					await updateWebpage(options.env, existing.objectId, {
						pageData: addedPaths.length > 0 ? merged : undefined,
						schema: schemaChanged ? pageManifest : undefined,
						lang: needsLangBackfill ? lang : undefined,
					});
					if (addedPaths.length > 0) {
						log(`added ${addedPaths.length} new path(s) to "${pagePath}" [${lang}]: ${addedPaths.join(', ')}`);
					}
					if (schemaChanged) {
						log(`updated ${options.env.schemaFieldName} schema for "${pagePath}" [${lang}]`);
					}
					if (needsLangBackfill) {
						log(`adopted legacy record for "${pagePath}" as lang "${lang}"`);
					}
				}
				perLang[lang] = pathValuesToMap(merged);
			} catch (error) {
				log(`sync failed for "${pagePath}" [${lang}] — using scanned defaults: ${(error as Error).message}`);
				perLang[lang] = pathValuesToMap(defaults);
			}
		}
	}

	return contentMap;
}

/** Used when PatStore isn't configured — content falls back to scanned defaults only, in a single language. */
export function contentMapFromDefaults(manifest: CmsManifest, defaultLang: string): CmsContentMap {
	const pages: Record<string, Record<string, CmsPageContent>> = {};
	for (const [pagePath, pageManifest] of Object.entries(manifest.pages)) {
		pages[pagePath] = { [defaultLang]: pathValuesToMap(flattenManifestToPaths(pageManifest)) };
	}
	return {
		_meta: { generatedAt: new Date().toISOString(), projectId: '', source: 'defaults', languages: [defaultLang] },
		pages,
	};
}
