import { pathValuesToMap } from './flatten.js';
import { DEFAULT_PAGE_CONTENT_KEY, pageContentKeys } from './locale.js';
import type { CmsFieldNode, CmsNode, CmsPageManifest, CmsPathValue, LocalizedPageContent } from './types.js';
import { isSectionNode } from './types.js';

export type { LocalizedPageContent };

function isCmsNode(value: unknown): value is CmsNode {
	return Boolean(value) && typeof value === 'object' && !Array.isArray(value) && typeof (value as { type?: unknown }).type === 'string';
}

export function isPageManifest(value: unknown): value is CmsPageManifest {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		return false;
	}
	return Object.values(value).every(isCmsNode);
}

export function isLocalizedPageContent(value: unknown): value is LocalizedPageContent {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		return false;
	}
	const record = value as Record<string, unknown>;
	if (!isPageManifest(record.default)) {
		return false;
	}
	return Object.values(record).every((entry) => isPageManifest(entry));
}

/** Legacy flat schemas (sections at the root) are treated as the `default` locale. */
export function readLocalizedPageContent(existing: unknown): LocalizedPageContent | null {
	if (isLocalizedPageContent(existing)) {
		return existing;
	}
	if (isPageManifest(existing)) {
		return { default: existing };
	}
	return null;
}

function sortKeys(value: unknown): unknown {
	if (Array.isArray(value)) {
		return value.map(sortKeys);
	}
	if (value && typeof value === 'object') {
		const sorted: Record<string, unknown> = {};
		for (const key of Object.keys(value as object).sort()) {
			sorted[key] = sortKeys((value as Record<string, unknown>)[key]);
		}
		return sorted;
	}
	return value;
}

export function schemasEqual(a: unknown, b: unknown): boolean {
	return JSON.stringify(sortKeys(a)) === JSON.stringify(sortKeys(b));
}

function mergeField(scanned: CmsFieldNode, existing: CmsFieldNode | undefined): CmsFieldNode {
	if (!existing) {
		return scanned;
	}
	const next: CmsFieldNode = {
		type: scanned.type,
		label: scanned.label,
		default: existing.default,
	};
	if (scanned.fields) {
		next.fields = mergeFieldMap(scanned.fields, existing.fields);
	}
	return next;
}

function mergeFieldMap(
	scanned: Record<string, CmsFieldNode>,
	existing: Record<string, CmsFieldNode> | undefined,
): Record<string, CmsFieldNode> {
	const merged: Record<string, CmsFieldNode> = {};
	for (const [key, node] of Object.entries(scanned)) {
		merged[key] = mergeField(node, existing?.[key]);
	}
	return merged;
}

function mergeNodes(scanned: Record<string, CmsNode>, existing: Record<string, CmsNode>): Record<string, CmsNode> {
	const merged: Record<string, CmsNode> = {};
	for (const [key, node] of Object.entries(scanned)) {
		const previous = existing[key];
		if (isSectionNode(node)) {
			merged[key] = {
				type: node.type,
				label: node.label,
				content: mergeNodes(node.content, previous && isSectionNode(previous) ? previous.content : {}),
			};
			continue;
		}
		merged[key] = mergeField(node, previous && !isSectionNode(previous) ? previous : undefined);
	}
	return merged;
}

/** Keeps field `default` values already stored for a locale, and refreshes structure from the scan. */
export function mergePageManifest(scanned: CmsPageManifest, existing: CmsPageManifest | undefined): CmsPageManifest {
	if (!existing) {
		return scanned;
	}
	return mergeNodes(scanned, existing);
}

/**
 * Wraps the scanned schema under `default` and under each configured locale.
 * Existing locale copy is preserved.
 */
export function buildLocalizedPageContent(
	scanned: CmsPageManifest,
	existing: unknown,
	locales: string[],
): LocalizedPageContent {
	const previous = readLocalizedPageContent(existing);
	const localized = {} as LocalizedPageContent;
	for (const key of pageContentKeys(locales)) {
		localized[key] = mergePageManifest(scanned, previous?.[key]);
	}
	return localized;
}

function applyValues(nodes: Record<string, CmsNode>, values: Record<string, unknown>, prefix: string): Record<string, CmsNode> {
	const next: Record<string, CmsNode> = {};
	for (const [key, node] of Object.entries(nodes)) {
		const path = prefix ? `${prefix}.${key}` : key;
		if (isSectionNode(node)) {
			next[key] = { ...node, content: applyValues(node.content, values, path) };
			continue;
		}
		if (Object.prototype.hasOwnProperty.call(values, path)) {
			next[key] = { ...node, default: values[path] };
			continue;
		}
		next[key] = node;
	}
	return next;
}

/**
 * Artifact written for the site. `default` (and locales that still match the
 * scan) take edited `page_data` values. A locale whose schema was edited in
 * the CMS keeps those defaults so each language can be fetched on its own.
 */
export function resolveLocalizedPageContent(
	scanned: CmsPageManifest,
	localized: LocalizedPageContent,
	pageData: CmsPathValue[],
): LocalizedPageContent {
	const values = pathValuesToMap(pageData);
	const resolved = {} as LocalizedPageContent;
	for (const [key, manifest] of Object.entries(localized)) {
		const useEditedValues = key === DEFAULT_PAGE_CONTENT_KEY || schemasEqual(manifest, scanned);
		resolved[key] = useEditedValues ? (applyValues(manifest, values, '') as CmsPageManifest) : manifest;
	}
	return resolved;
}
