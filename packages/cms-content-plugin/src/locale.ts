/** Content key used when a project has no locales, or only one. */
export const DEFAULT_PAGE_CONTENT_KEY = 'default';

/**
 * `de` → `de-DE`. Values that already include a region (`pt-BR`, `de-DE`) keep it.
 * `default` stays `default`.
 */
export function toLocale(value: string): string {
	const trimmed = value.trim();
	if (!trimmed || trimmed.toLowerCase() === DEFAULT_PAGE_CONTENT_KEY) {
		return DEFAULT_PAGE_CONTENT_KEY;
	}
	const parts = trimmed.split(/[-_]/).filter(Boolean);
	const language = parts[0]?.toLowerCase();
	if (!language) {
		return DEFAULT_PAGE_CONTENT_KEY;
	}
	const region = (parts[1] ?? parts[0]).toUpperCase();
	return `${language}-${region}`;
}

/**
 * Keys written onto `page_content`. `default` is always included. Each
 * configured locale is stored next to it. Readers use `default` when there
 * is no locale or only one.
 */
export function pageContentKeys(locales: string[]): string[] {
	const unique = [
		...new Set(
			locales
				.map((locale) => toLocale(locale))
				.filter((locale) => locale !== DEFAULT_PAGE_CONTENT_KEY),
		),
	];
	return [DEFAULT_PAGE_CONTENT_KEY, ...unique];
}
