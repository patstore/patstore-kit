import { getPatStoreStaticDataAccess, isStaticDataConfigured } from './static-data.js';
import { isPatStoreConfigured } from './env.js';
import { resourceManager } from './resources/resource-manager.js';
import type { PatstoreClassMap, QuerySpec } from './types.js';

/** Where data is loaded from. Default resolves to static when SSG data exists. */
export type PatStoreFetchSource = 'static' | 'dynamic';

export interface PatStoreFetchOptions {
	/**
	 * `static` — SSG data wired via {@link configurePatStoreStaticData}
	 * `dynamic` — live GraphQL via the planner stack
	 *
	 * Omit to use static by default (falls back to dynamic when static is unavailable).
	 */
	source?: PatStoreFetchSource;
	limit?: number;
	skip?: number;
	where?: Record<string, unknown>;
	order?: string[];
	fields?: string[];
}

function resolveFetchSource(source?: PatStoreFetchSource): PatStoreFetchSource {
	if (source === 'static' || source === 'dynamic') {
		return source;
	}
	if (import.meta.env.VITE_PATSTORE_USE_STATIC === 'false') {
		return 'dynamic';
	}
	if (isStaticDataConfigured()) {
		return 'static';
	}
	return 'dynamic';
}

function staticUnavailableError(): Error {
	return new Error(
		'Static PatStore data is not available. Run dev/build with SSG enabled, call configurePatStoreStaticData(), or use source: "dynamic".',
	);
}

function getStaticAccess() {
	const access = getPatStoreStaticDataAccess();
	if (!access) {
		throw staticUnavailableError();
	}
	return access;
}

function toQueryOptions(
	options: PatStoreFetchOptions,
): Omit<QuerySpec, 'className' | 'mode' | 'objectId'> {
	return {
		limit: options.limit,
		skip: options.skip,
		where: options.where,
		order: options.order,
		fields: options.fields,
	};
}

async function fetchFromServer<T>(spec: QuerySpec): Promise<T> {
	if (!isPatStoreConfigured()) {
		throw new Error('PatStore is not configured. Add VITE_PATSTORE_* variables to .env');
	}
	const result = await resourceManager.load<T>(spec);
	return result.data;
}

function findStaticObject<T extends { objectId: string }>(
	className: string,
	objectId: string,
): T | null {
	const access = getStaticAccess();
	return access.findStaticCollection<T>(className).find((item) => item.objectId === objectId) ?? null;
}

export function fetchPatStoreCollection<C extends keyof PatstoreClassMap>(
	className: C,
	options?: PatStoreFetchOptions,
): Promise<PatstoreClassMap[C][]>;
export function fetchPatStoreCollection<T extends { objectId: string }>(
	className: string,
	options?: PatStoreFetchOptions,
): Promise<T[]>;
export function fetchPatStoreCollection<T extends { objectId: string }>(
	className: string,
	options: PatStoreFetchOptions = {},
): Promise<T[]> {
	const source = resolveFetchSource(options.source);
	const query = toQueryOptions(options);

	if (source === 'static') {
		const access = getStaticAccess();
		if (!access.isStaticDataReady()) {
			return Promise.reject(staticUnavailableError());
		}
		return Promise.resolve(access.findStaticCollection<T>(className, options.limit));
	}

	return fetchFromServer<T[]>({ className, mode: 'find', ...query });
}

export function fetchPatStoreObject<C extends keyof PatstoreClassMap>(
	className: C,
	objectId: string,
	options?: PatStoreFetchOptions & { searchAllCollections?: boolean },
): Promise<PatstoreClassMap[C] | null>;
export function fetchPatStoreObject<T extends { objectId: string }>(
	className: string,
	objectId: string,
	options?: PatStoreFetchOptions & { searchAllCollections?: boolean },
): Promise<T | null>;
export function fetchPatStoreObject<T extends { objectId: string }>(
	className: string,
	objectId: string,
	options: PatStoreFetchOptions & { searchAllCollections?: boolean } = {},
): Promise<T | null> {
	const source = resolveFetchSource(options.source);
	const query = toQueryOptions(options);

	if (source === 'static') {
		const access = getStaticAccess();
		if (!access.isStaticDataReady()) {
			return Promise.reject(staticUnavailableError());
		}

		if (options.searchAllCollections) {
			return Promise.resolve((access.findByObjectId(objectId) as T | null) ?? null);
		}

		return Promise.resolve(findStaticObject<T>(className, objectId));
	}

	return fetchFromServer<T | null>({
		className,
		mode: 'get',
		objectId,
		...query,
	});
}

export function fetchPatStoreData<T extends { objectId: string }>(
	spec: QuerySpec & PatStoreFetchOptions & { searchAllCollections?: boolean },
): Promise<T[] | T | null> {
	if (spec.mode === 'get') {
		if (!spec.objectId) {
			return Promise.reject(new Error('QuerySpec.objectId is required for mode "get"'));
		}
		return fetchPatStoreObject<T>(spec.className, spec.objectId, spec);
	}

	return fetchPatStoreCollection<T>(spec.className, spec);
}
