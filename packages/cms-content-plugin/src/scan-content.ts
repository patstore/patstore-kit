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
/** Generic opening/self-closing tag, e.g. `<h1 class="x" data-cms="title">`. */
const TAG_REGEX = /<([A-Za-z][\w.-]*)((?:"[^"]*"|'[^']*'|\{[^}]*\}|[^>])*?)(\/?)>/g;

/** Wrapping tags that map 1:1 to a section `type` — anything else falls back to `section`. */
const KNOWN_SECTION_TAGS = new Set(['header', 'footer', 'section', 'article', 'aside', 'nav', 'main']);

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

function sectionTypeForTag(tagName: string): string {
	const lower = tagName.toLowerCase();
	return KNOWN_SECTION_TAGS.has(lower) ? lower : 'section';
}

function labelFor(tag: ParsedTag, key: string): string {
	return tag.attrs['data-cms-label']?.trim() || humanizeKey(key);
}

function buildLeafField(source: string, tag: ParsedTag, key: string): CmsFieldNode {
	const label = labelFor(tag, key);
	const tagName = tag.tagName.toLowerCase();

	if (tagName === 'img') {
		return { type: 'image', label, default: tag.attrs.src ?? '' };
	}

	const text = readInnerText(source, tag);

	if (tagName === 'a') {
		return { type: 'link', label, default: { text, href: tag.attrs.href ?? '' } };
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
		const fieldKey = innerTag.attrs['data-cms'];
		if (!fieldKey || innerTag.attrs['data-cms-collection'] || innerTag.attrs['data-cms-section']) {
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
 * Scans one nesting level of TSRX/JSX source for `data-cms-section` (nested
 * group), `data-cms-collection` (repeated item template), and `data-cms`
 * (leaf field) markers. Leaf/collection fields are only kept when
 * `insideSection` is true — content outside any `data-cms-section` wrapper
 * is ignored, per convention.
 */
function scanScope(source: string, insideSection: boolean): Record<string, CmsNode> {
	const nodes: Record<string, CmsNode> = {};
	const consumedRanges: Array<[number, number]> = [];
	const isConsumed = (pos: number) => consumedRanges.some(([s, e]) => pos >= s && pos < e);
	const tags = findTags(source);

	for (const tag of tags) {
		const sectionKey = tag.attrs['data-cms-section'];
		if (!sectionKey || tag.selfClosing || isConsumed(tag.start)) {
			continue;
		}

		const close = findMatchingClose(source, tag);
		if (!close) {
			continue;
		}
		consumedRanges.push([tag.start, close.outerEnd]);

		const inner = source.slice(tag.end, close.innerEnd);
		const section: CmsSectionNode = {
			type: sectionTypeForTag(tag.tagName),
			label: labelFor(tag, sectionKey),
			content: scanScope(inner, true),
		};
		nodes[sectionKey] = section;
	}

	if (!insideSection) {
		return nodes;
	}

	for (const tag of tags) {
		const collectionKey = tag.attrs['data-cms-collection'];
		if (!collectionKey || tag.selfClosing || isConsumed(tag.start)) {
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
		if (isConsumed(tag.start)) {
			continue;
		}
		const fieldKey = tag.attrs['data-cms'];
		if (!fieldKey || tag.attrs['data-cms-collection'] || tag.attrs['data-cms-section']) {
			continue;
		}
		nodes[fieldKey] = buildLeafField(source, tag, fieldKey);
	}

	return nodes;
}

/**
 * Scans TSRX/JSX source for `data-cms-section="key"` wrappers. Only
 * `data-cms` / `data-cms-collection` fields nested inside a section are
 * collected — anything outside a section is ignored.
 *
 * ```tsrx
 * <section data-cms-section="page" data-cms-label="Seite">
 *   <header data-cms-section="hero" data-cms-label="Hero">
 *     <h1 data-cms="title">Home</h1>
 *   </header>
 * </section>
 * ```
 */
export function scanTsrxContent(source: string): CmsPageManifest {
	return scanScope(source, false);
}
