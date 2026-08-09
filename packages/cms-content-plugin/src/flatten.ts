import { isSectionNode } from './types.js';
import type { CmsNode, CmsPageManifest, CmsPathValue } from './types.js';

/**
 * Flattens a nested manifest into `{ path, value }` pairs, joining section
 * keys with `.` down to each field (e.g. `page.hero.eyebrow`) — matches the
 * PatStore `page_data` array shape. Collections produce a single entry
 * whose value is the whole (scanned-default) array.
 */
export function flattenManifestToPaths(manifest: CmsPageManifest): CmsPathValue[] {
	const out: CmsPathValue[] = [];

	const walk = (nodes: Record<string, CmsNode>, prefix: string) => {
		for (const [key, node] of Object.entries(nodes)) {
			const path = prefix ? `${prefix}.${key}` : key;
			if (isSectionNode(node)) {
				walk(node.content, path);
			} else {
				out.push({ path, value: node.default });
			}
		}
	};

	walk(manifest, '');
	return out;
}

/** Builds a `{ path: value }` lookup map from a `page_data`-shaped array. */
export function pathValuesToMap(entries: CmsPathValue[]): Record<string, unknown> {
	const map: Record<string, unknown> = {};
	for (const entry of entries) {
		map[entry.path] = entry.value;
	}
	return map;
}
