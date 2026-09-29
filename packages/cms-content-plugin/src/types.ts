import type { WebpageStructuredValueEntry } from '@patstore/core';

export type CmsFieldType = 'text' | 'richtext' | 'image' | 'link' | 'file' | 'collection';

export interface CmsFieldNode {
	type: CmsFieldType;
	label: string;
	default: unknown;
	/** Present only when `type === 'collection'` — schema for one repeated item. */
	fields?: Record<string, CmsFieldNode>;
}

export interface CmsSectionNode {
	/** Derived from the wrapping tag name (`section`, `header`, `footer`, …). */
	type: string;
	label: string;
	content: Record<string, CmsNode>;
}

export type CmsNode = CmsFieldNode | CmsSectionNode;

export function isSectionNode(node: CmsNode): node is CmsSectionNode {
	return 'content' in node;
}

/** Top-level `data-cms-section` containers found in a page — fields outside any section are ignored. */
export type CmsPageManifest = Record<string, CmsNode>;

/**
 * `page_content` for one path. `default` is always present and is the copy
 * used when the project has no languages or only one. Each configured locale
 * (`de-DE`) is stored beside it.
 */
export interface LocalizedPageContent {
	default: CmsPageManifest;
	[locale: string]: CmsPageManifest;
}

export interface CmsManifest {
	pages: Record<string, CmsPageManifest>;
}

/**
 * Resolved content for one page, keyed by the full dot path from the root
 * section down to the field (e.g. `page.hero.eyebrow`) — mirrors the
 * PatStore `page_data` entry shape (`{ path, value }`).
 */
export type CmsPageContent = Record<string, unknown>;

/** Same row shape as `PatstoreWebpage.page_data`. */
export type CmsPathValue = WebpageStructuredValueEntry;

export interface CmsContentMap {
	_meta: {
		generatedAt: string;
		projectId: string;
		source: 'cms' | 'defaults';
		/** Locales synced this run (`de-DE`). A single entry when the project has one language, or none configured. */
		languages: string[];
	};
	/**
	 * Path → `page_data` entries as stored on the server. Locale is part of
	 * `path` (`de-DE.home_start.title`). Paths without a locale prefix are the default.
	 */
	pages: Record<string, CmsPathValue[]>;
}
