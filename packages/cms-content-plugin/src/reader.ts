import type { WebpageStructuredValueEntry } from '@patstore/core';
import { toLocale } from './locale.js';
import type { CmsContentMap } from './types.js';

/** Same row shape as `PatstoreWebpage.page_data`. */
export type CmsContentEntry = WebpageStructuredValueEntry;

/** Page path → `page_data` entries. Locale is a prefix on `path` (`de-DE.home_start.title`). */
export interface CmsContentPages {
	[path: string]: CmsContentEntry[];
}

export interface CmsContentFile {
	_meta: CmsContentMap['_meta'];
	pages: CmsContentPages;
}

const LOCALE_PATH = /^[a-z]{2}-[A-Z]{2}\./;

export function isCmsContentReady(content: CmsContentFile): boolean {
	return Boolean(content._meta?.generatedAt);
}

export function getAllPageContent(content: CmsContentFile): CmsContentPages {
	return content.pages ?? {};
}

/**
 * Resolves `pagePath`'s `page_data` entries for `locale`.
 * Entries are `{ path, value }` as stored. `home_start.title` is the default;
 * `de-DE.home_start.title` overrides it for that locale. With no languages or
 * only one, only unprefixed paths are returned.
 */
export function getPageContent(content: CmsContentFile, pagePath: string, locale: string): Record<string, unknown> {
	const entries = content.pages?.[pagePath];
	if (!Array.isArray(entries)) {
		return {};
	}
	const resolved: Record<string, unknown> = {};
	for (const entry of entries) {
		if (!entry || typeof entry.path !== 'string' || LOCALE_PATH.test(entry.path)) {
			continue;
		}
		resolved[entry.path] = entry.value;
	}
	const languages = content._meta?.languages ?? [];
	if (languages.length <= 1) {
		return resolved;
	}
	const prefix = `${toLocale(locale)}.`;
	for (const entry of entries) {
		if (!entry || typeof entry.path !== 'string' || !entry.path.startsWith(prefix)) {
			continue;
		}
		resolved[entry.path.slice(prefix.length)] = entry.value;
	}
	return resolved;
}

/** Binds a `cms-content.json` snapshot so callers keep `getPageContent(pagePath, locale)`. */
export function bindCmsContent(content: CmsContentFile) {
	return {
		isCmsContentReady: () => isCmsContentReady(content),
		getAllPageContent: () => getAllPageContent(content),
		getPageContent: (pagePath: string, locale: string) => getPageContent(content, pagePath, locale),
	};
}
