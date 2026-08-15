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

export interface CmsManifest {
	pages: Record<string, CmsPageManifest>;
}

/**
 * Resolved content for one page, keyed by the full dot path from the root
 * section down to the field (e.g. `page.hero.eyebrow`) — mirrors the
 * PatStore `page_data` entry shape (`{ path, value }`).
 */
export type CmsPageContent = Record<string, unknown>;

export interface CmsPathValue {
	path: string;
	value: unknown;
}

export interface CmsContentMap {
	_meta: {
		generatedAt: string;
		projectId: string;
		source: 'cms' | 'defaults';
		/** Languages synced this run — from `Project.settings.languages`, or `[defaultLang]` when absent. */
		languages: string[];
	};
	/** Path → language → resolved content for that page in that language. */
	pages: Record<string, Record<string, CmsPageContent>>;
}
