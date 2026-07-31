/** @jsxImportSource octane */
import { use, useMemo } from 'octane';
import { isPatStoreConfigured } from '../env.js';
import { queryPlanner } from '../planner/query-planner.js';
import { createCacheResource } from '../resources/cache-resource.js';
import { resourceManager } from '../resources/resource-manager.js';
import type { QuerySpec } from '../types.js';

function specCacheKey(spec: QuerySpec): string {
	return JSON.stringify(spec);
}

/**
 * Component-local PatStore data hook.
 * Query Planner → Execution Plan → Resource Manager → cache-aware resource → `use()`.
 */
export function usePatStoreData<T = unknown>(spec: QuerySpec): T {
	if (!isPatStoreConfigured()) {
		throw new Error(
			'PatStore is not configured. Add VITE_PATSTORE_* variables to .env',
		);
	}

	const cacheKey = specCacheKey(spec);
	const resource = useMemo(
		() =>
			createCacheResource<T>(cacheKey, async () => {
				const plan = await queryPlanner.compile(spec);
				return resourceManager.acquire<T>(plan).toPromise();
			}),
		[cacheKey],
	);

	return use(resource.toPromise()) as T;
}

export function usePatStoreCollection<T extends { objectId: string }>(
	className: string,
	options: Omit<QuerySpec, 'className' | 'mode'> = {},
): T[] {
	return usePatStoreData<T[]>({
		className,
		mode: 'find',
		...options,
	});
}

export function usePatStoreObject<T extends { objectId: string }>(
	className: string,
	objectId: string,
	options: Omit<QuerySpec, 'className' | 'mode' | 'objectId'> = {},
): T {
	return usePatStoreData<T>({
		className,
		mode: 'get',
		objectId,
		...options,
	});
}
