import { toLocale } from './locale.js';
import type { CmsPathValue, LocalizedPageContent } from './types.js';

export interface CmsRestEnv {
	apiUrl: string;
	appId: string;
	masterKey?: string;
	restKey?: string;
	projectId: string;
	/** PatStore class that stores page content, e.g. `Webpage`. */
	className: string;
	/** Array-type field on `className` holding `{ path, value }` entries — the edited values. Default: `page_data`. */
	fieldName: string;
	/** Field on `className` holding the nested field schema PatStore's editor renders from. Default: `page_content`. */
	schemaFieldName: string;
	/**
	 * className of the class the `project` pointer field targets (e.g. `Project`).
	 * Set to `null` if `project` is a plain string field instead of a Pointer.
	 * Also used as the class name for the `Project.settings.languages` lookup.
	 */
	projectPointerClassName: string | null;
	/** From `DEFAULT_LANG` — locale used when `Project.settings.languages` is absent. */
	defaultLang: string;
}

interface WebpageRecord {
	objectId: string;
	pageData: CmsPathValue[];
	/** Raw current value of `schemaFieldName` — compared against the locale-keyed schema to detect drift. */
	schema: unknown;
}

function authHeaders(env: CmsRestEnv): Record<string, string> {
	const headers: Record<string, string> = { 'X-Parse-Application-Id': env.appId };
	if (env.masterKey) {
		headers['X-Parse-Master-Key'] = env.masterKey;
	} else if (env.restKey) {
		headers['X-Parse-Rest-Api-Key'] = env.restKey;
	}
	return headers;
}

function projectFieldValue(env: CmsRestEnv): unknown {
	if (!env.projectPointerClassName) {
		return env.projectId;
	}
	return { __type: 'Pointer', className: env.projectPointerClassName, objectId: env.projectId };
}

async function parseRestRequest<T>(
	env: CmsRestEnv,
	method: 'GET' | 'POST' | 'PUT',
	urlPath: string,
	body?: unknown,
): Promise<T> {
	const res = await fetch(`${env.apiUrl.replace(/\/$/, '')}${urlPath}`, {
		method,
		headers: {
			...authHeaders(env),
			...(body ? { 'Content-Type': 'application/json' } : {}),
		},
		body: body ? JSON.stringify(body) : undefined,
	});

	if (!res.ok) {
		const text = await res.text().catch(() => '');
		throw new Error(`PatStore REST ${method} ${urlPath} failed (${res.status}): ${text}`);
	}

	return (await res.json()) as T;
}

function normalizePageData(value: unknown): CmsPathValue[] {
	if (!Array.isArray(value)) {
		return [];
	}
	return value
		.filter((entry): entry is CmsPathValue => Boolean(entry) && typeof entry === 'object' && 'path' in (entry as object))
		.map((entry) => ({ path: String(entry.path), value: entry.value }));
}

async function queryWebpage(env: CmsRestEnv, where: unknown): Promise<Record<string, unknown> | null> {
	const query = `where=${encodeURIComponent(JSON.stringify(where))}&limit=1`;
	const data = await parseRestRequest<{ results: Array<Record<string, unknown>> }>(
		env,
		'GET',
		`/classes/${env.className}?${query}`,
	);
	return data.results?.[0] ?? null;
}

function toWebpageRecord(result: Record<string, unknown>, env: CmsRestEnv): WebpageRecord {
	return {
		objectId: String(result.objectId),
		pageData: normalizePageData(result[env.fieldName]),
		schema: result[env.schemaFieldName] ?? null,
	};
}

/** Finds the single `Webpage` record for `project` + `path`. Locales live on `page_content`, not on separate records. */
export async function findWebpageByPath(env: CmsRestEnv, pagePath: string): Promise<WebpageRecord | null> {
	const exact = await queryWebpage(env, { project: projectFieldValue(env), path: pagePath });
	return exact ? toWebpageRecord(exact, env) : null;
}

/**
 * Fetches `Project.settings.languages` as locales (`de` → `de-DE`).
 * Falls back to `[toLocale(env.defaultLang)]` when absent, empty, or unreadable.
 */
export async function fetchProjectLanguages(env: CmsRestEnv): Promise<string[]> {
	try {
		const className = env.projectPointerClassName ?? 'Project';
		const project = await parseRestRequest<{ settings?: { languages?: unknown } }>(
			env,
			'GET',
			`/classes/${className}/${env.projectId}`,
		);
		const languages = project.settings?.languages;
		if (Array.isArray(languages) && languages.length > 0 && languages.every((lang) => typeof lang === 'string')) {
			const locales = [
				...new Set(
					languages
						.map((lang) => toLocale(lang))
						.filter((locale) => locale !== 'default'),
				),
			];
			if (locales.length > 0) {
				return locales;
			}
		}
	} catch {
		// A missing/unreadable Project shouldn't break the sync — fall through to the default.
	}
	const fallback = toLocale(env.defaultLang);
	return fallback === 'default' ? [] : [fallback];
}

/** Updates whichever of `pageData` (edited values) / `schema` (locale-keyed `page_content`) are provided, in one PUT. */
export async function updateWebpage(
	env: CmsRestEnv,
	objectId: string,
	fields: { pageData?: CmsPathValue[]; schema?: LocalizedPageContent },
): Promise<void> {
	const body: Record<string, unknown> = {};
	if (fields.pageData) {
		body[env.fieldName] = fields.pageData;
	}
	if (fields.schema) {
		body[env.schemaFieldName] = fields.schema;
	}
	if (Object.keys(body).length === 0) {
		return;
	}
	await parseRestRequest(env, 'PUT', `/classes/${env.className}/${objectId}`, body);
}
