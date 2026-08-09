import type { CmsPageManifest, CmsPathValue } from './types.js';

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
	/** From `DEFAULT_LANG` — used as the sole language when `Project.settings.languages` is absent. */
	defaultLang: string;
}

interface WebpageRecord {
	objectId: string;
	pageData: CmsPathValue[];
	/** Raw current value of `schemaFieldName` — compared against the freshly scanned manifest to detect drift. */
	schema: unknown;
	/** The record's actual `lang` value — `null` when adopted from a legacy, pre-language record. */
	lang: string | null;
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

function toWebpageRecord(result: Record<string, unknown>, env: CmsRestEnv, lang: string | null): WebpageRecord {
	return {
		objectId: String(result.objectId),
		pageData: normalizePageData(result[env.fieldName]),
		schema: result[env.schemaFieldName] ?? null,
		lang,
	};
}

/**
 * Finds a `Webpage` record by `project` + `path` + `lang`. When nothing
 * matches and `lang` is the default language, falls back to a record with
 * no `lang` set at all — a pre-language-support record created before this
 * field existed — and adopts it instead of creating a duplicate. The caller
 * is responsible for backfilling `lang` onto adopted records via `updateWebpage`.
 */
export async function findWebpageByPath(
	env: CmsRestEnv,
	pagePath: string,
	lang: string,
): Promise<WebpageRecord | null> {
	const exact = await queryWebpage(env, { project: projectFieldValue(env), path: pagePath, lang });
	if (exact) {
		return toWebpageRecord(exact, env, lang);
	}

	if (lang === env.defaultLang) {
		const legacy = await queryWebpage(env, {
			project: projectFieldValue(env),
			path: pagePath,
			lang: { $exists: false },
		});
		if (legacy) {
			return toWebpageRecord(legacy, env, null);
		}
	}

	return null;
}

/** Fetches `Project.settings.languages` — falls back to `[env.defaultLang]` when absent, empty, or unreadable. */
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
			return languages as string[];
		}
	} catch {
		// A missing/unreadable Project shouldn't break the sync — fall through to the default.
	}
	return [env.defaultLang];
}

/** Updates whichever of `pageData` (edited values) / `schema` (editor field definitions) / `lang` (legacy backfill) are provided, in one PUT. */
export async function updateWebpage(
	env: CmsRestEnv,
	objectId: string,
	fields: { pageData?: CmsPathValue[]; schema?: CmsPageManifest; lang?: string },
): Promise<void> {
	const body: Record<string, unknown> = {};
	if (fields.pageData) {
		body[env.fieldName] = fields.pageData;
	}
	if (fields.schema) {
		body[env.schemaFieldName] = fields.schema;
	}
	if (fields.lang) {
		body.lang = fields.lang;
	}
	if (Object.keys(body).length === 0) {
		return;
	}
	await parseRestRequest(env, 'PUT', `/classes/${env.className}/${objectId}`, body);
}
