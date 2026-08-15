import type { CmsFieldNode, CmsNode, CmsPageManifest, CmsSectionNode } from './types.js';

interface ParsedTag {
	tagName: string;
	attrs: Record<string, string>;
	selfClosing: boolean;
	/** Index of the opening `<`. */
	start: number;
	/** Index right after the tag's closing `>`. */
	end: number;
}

const ATTR_REGEX = /([a-zA-Z_:][-\w:.]*)\s*(?:=\s*("([^"]*)"|'([^']*)'|\{([^}]*)\}))?/g;
/** Generic opening/self-closing tag, e.g. `<Field id="title" label="Title">`. */
const TAG_REGEX = /<([A-Za-z][\w.-]*)((?:"[^"]*"|'[^']*'|\{[^}]*\}|[^>])*?)(\/?)>/g;

/**
 * Fixed CMS marker component names (`src/cms/schema/`) — the scanner
 * recognizes these tag names wherever they appear, regardless of which
 * `.tsrx` file authors them (see `resolve-imports.ts` for cross-file scanning).
 */
const SECTION_TAG = 'Section';
const FIELD_TAG = 'Field';
const IMAGE_FIELD_TAG = 'ImageField';
const LINK_FIELD_TAG = 'LinkField';
const RICH_TEXT_FIELD_TAG = 'RichTextField';
const DOWNLOAD_FIELD_TAG = 'DownloadField';
const COLLECTION_FIELD_TAG = 'CollectionField';
const LEAF_TAGS = new Set([FIELD_TAG, IMAGE_FIELD_TAG, LINK_FIELD_TAG, RICH_TEXT_FIELD_TAG, DOWNLOAD_FIELD_TAG]);

function parseAttrs(attrString: string): Record<string, string> {
	const attrs: Record<string, string> = {};
	let match: RegExpExecArray | null;
	ATTR_REGEX.lastIndex = 0;
	while ((match = ATTR_REGEX.exec(attrString))) {
		const name = match[1];
		attrs[name] = match[3] ?? match[4] ?? match[5] ?? '';
	}
	return attrs;
}

function findTags(source: string): ParsedTag[] {
	const tags: ParsedTag[] = [];
	let match: RegExpExecArray | null;
	TAG_REGEX.lastIndex = 0;
	while ((match = TAG_REGEX.exec(source))) {
		if (source[match.index + 1] === '/') {
			continue;
		}
		tags.push({
			tagName: match[1],
			attrs: parseAttrs(match[2]),
			selfClosing: match[3] === '/',
			start: match.index,
			end: TAG_REGEX.lastIndex,
		});
	}
	return tags;
}

/** Scans forward from an open tag to find its matching close tag, tracking same-name nesting depth. */
function findMatchingClose(
	source: string,
	tag: ParsedTag,
): { innerEnd: number; outerEnd: number } | null {
	const tagNameEsc = tag.tagName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	const openRe = new RegExp(`<${tagNameEsc}(?=[\\s/>])[^>]*>`, 'g');
	const closeRe = new RegExp(`</${tagNameEsc}\\s*>`, 'g');
	let depth = 1;
	let pos = tag.end;

	while (depth > 0) {
		closeRe.lastIndex = pos;
		const closeMatch = closeRe.exec(source);
		if (!closeMatch) {
			return null;
		}

		openRe.lastIndex = pos;
		const openMatch = openRe.exec(source);
		if (openMatch && openMatch.index < closeMatch.index && !openMatch[0].endsWith('/>')) {
			depth++;
			pos = openMatch.index + openMatch[0].length;
			continue;
		}

		depth--;
		if (depth === 0) {
			return { innerEnd: closeMatch.index, outerEnd: closeMatch.index + closeMatch[0].length };
		}
		pos = closeMatch.index + closeMatch[0].length;
	}

	return null;
}

function stripJsxExpressions(text: string): string {
	return text
		.replace(/\{\s*(['"`])([\s\S]*?)\1\s*\}/g, '$2')
		.replace(/\{[^{}]*\}/g, '')
		.trim();
}

function stripInnerTags(text: string): string {
	return text.replace(/<[^>]+>/g, ' ');
}

function normalizeWhitespace(text: string): string {
	return text.replace(/\s+/g, ' ').trim();
}

function readInnerText(source: string, tag: ParsedTag): string {
	if (tag.selfClosing) {
		return '';
	}
	const close = findMatchingClose(source, tag);
	if (!close) {
		return '';
	}
	const raw = source.slice(tag.end, close.innerEnd);
	return normalizeWhitespace(stripInnerTags(stripJsxExpressions(raw)));
}

function humanizeKey(key: string): string {
	return key
		.split('.')
		.map((segment) =>
			segment
				.replace(/[-_]+/g, ' ')
				.replace(/([a-z0-9])([A-Z])/g, '$1 $2')
				.trim()
				.replace(/\b\w/g, (c) => c.toUpperCase()),
		)
		.join(' ');
}

function labelFor(tag: ParsedTag, key: string): string {
	return tag.attrs.label?.trim() || humanizeKey(key);
}

function buildLeafField(source: string, tag: ParsedTag, key: string): CmsFieldNode {
	const label = labelFor(tag, key);

	if (tag.tagName === IMAGE_FIELD_TAG) {
		return { type: 'image', label, default: tag.attrs.src ?? '' };
	}

	if (tag.tagName === DOWNLOAD_FIELD_TAG) {
		return { type: 'file', label, default: tag.attrs.href ?? '' };
	}

	const text = readInnerText(source, tag);

	if (tag.tagName === LINK_FIELD_TAG) {
		return { type: 'link', label, default: { text, href: tag.attrs.href ?? '' } };
	}

	if (tag.tagName === RICH_TEXT_FIELD_TAG) {
		return { type: 'richtext', label, default: text };
	}

	return { type: 'text', label, default: text };
}

function buildCollectionField(source: string, tag: ParsedTag, key: string): CmsFieldNode | null {
	const close = findMatchingClose(source, tag);
	if (!close) {
		return null;
	}

	const inner = source.slice(tag.end, close.innerEnd);
	const itemFields: Record<string, CmsFieldNode> = {};
	for (const innerTag of findTags(inner)) {
		if (!LEAF_TAGS.has(innerTag.tagName)) {
			continue;
		}
		const fieldKey = innerTag.attrs.id;
		if (!fieldKey) {
			continue;
		}
		itemFields[fieldKey] = buildLeafField(inner, innerTag, fieldKey);
	}

	const sampleRow: Record<string, unknown> = {};
	for (const [fieldKey, schema] of Object.entries(itemFields)) {
		sampleRow[fieldKey] = schema.default;
	}

	return { type: 'collection', label: labelFor(tag, key), fields: itemFields, default: [sampleRow] };
}

/**
 * Scans one nesting level of TSRX/JSX source for `<Section id="...">` (nested
 * group), `<CollectionField id="...">` (repeated item template), and
 * `<Field>`/`<ImageField>`/`<LinkField>`/`<RichTextField>`/`<DownloadField>`
 * (leaf field) marker components. Leaf/collection fields are only kept when
 * `insideSection` is true — content
 * outside any `<Section>` is ignored, per convention.
 */
function scanScope(source: string, insideSection: boolean): Record<string, CmsNode> {
	const nodes: Record<string, CmsNode> = {};
	const consumedRanges: Array<[number, number]> = [];
	const isConsumed = (pos: number) => consumedRanges.some(([s, e]) => pos >= s && pos < e);
	const tags = findTags(source);

	for (const tag of tags) {
		if (tag.tagName !== SECTION_TAG || tag.selfClosing || isConsumed(tag.start)) {
			continue;
		}
		const sectionKey = tag.attrs.id;
		if (!sectionKey) {
			continue;
		}

		const close = findMatchingClose(source, tag);
		if (!close) {
			continue;
		}
		consumedRanges.push([tag.start, close.outerEnd]);

		const inner = source.slice(tag.end, close.innerEnd);
		const section: CmsSectionNode = {
			type: tag.attrs.type?.trim() || 'section',
			label: labelFor(tag, sectionKey),
			content: scanScope(inner, true),
		};
		nodes[sectionKey] = section;
	}

	if (!insideSection) {
		return nodes;
	}

	for (const tag of tags) {
		if (tag.tagName !== COLLECTION_FIELD_TAG || tag.selfClosing || isConsumed(tag.start)) {
			continue;
		}
		const collectionKey = tag.attrs.id;
		if (!collectionKey) {
			continue;
		}
		const field = buildCollectionField(source, tag, collectionKey);
		if (!field) {
			continue;
		}
		const close = findMatchingClose(source, tag);
		if (close) {
			consumedRanges.push([tag.start, close.outerEnd]);
		}
		nodes[collectionKey] = field;
	}

	for (const tag of tags) {
		if (isConsumed(tag.start) || !LEAF_TAGS.has(tag.tagName)) {
			continue;
		}
		const fieldKey = tag.attrs.id;
		if (!fieldKey) {
			continue;
		}
		nodes[fieldKey] = buildLeafField(source, tag, fieldKey);
	}

	return nodes;
}

/**
 * Scans TSRX/JSX source for `<Section id="key">` wrappers. Only
 * `<Field>`/`<ImageField>`/`<LinkField>`/`<RichTextField>`/`<DownloadField>`/
 * `<CollectionField>` fields nested inside a `<Section>` are collected —
 * anything outside a section is ignored.
 *
 * ```tsrx
 * <Section id="page" label="Seite">
 *   <Section id="hero" label="Hero">
 *     <Field id="title">Home</Field>
 *   </Section>
 * </Section>
 * ```
 *
 * Scans only the given source's own text — a page that renders its content
 * through an imported component (`<Home />`) yields no nodes here; see
 * `resolve-imports.ts` and `manifest.ts` for the cross-file scan that follows
 * local imports and unions their marker nodes into the page's manifest.
 */
export function scanTsrxContent(source: string): CmsPageManifest {
	return scanScope(source, false);
}
