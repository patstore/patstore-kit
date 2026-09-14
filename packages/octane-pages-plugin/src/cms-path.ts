/**
 * Maps a route pattern to the CMS content key — strips `$lang` but keeps other
 * dynamic segments as template literals (e.g. `/$lang/athletes/$slug` →
 * `/athletes/$slug`). Splat routes (`.../$`) return `null`.
 */
export function cmsPathForPattern(pattern: string): string | null {
	const segments = pattern.split('/').filter(Boolean);
	if (segments.at(-1) === '$') {
		return null;
	}
	const stripped = segments.filter((segment) => segment !== '$lang');
	return stripped.length === 0 ? '/' : `/${stripped.join('/')}`;
}
