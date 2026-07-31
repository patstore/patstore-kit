import type { DeferredResource, ResourceStatus } from '../types.js';

type CacheEntry<T> = {
	status: ResourceStatus;
	value?: T;
	error?: unknown;
	promise?: Promise<T>;
};

const cache = new Map<string, CacheEntry<unknown>>();

function createDeferredResource<T>(key: string, factory: () => Promise<T>): DeferredResource<T> {
	let entry = cache.get(key) as CacheEntry<T> | undefined;

	if (!entry) {
		entry = { status: 'idle' };
		cache.set(key, entry);
	}

	if (entry.status === 'idle') {
		entry.status = 'pending';
		entry.promise = factory()
			.then((value) => {
				entry!.status = 'resolved';
				entry!.value = value;
				return value;
			})
			.catch((error) => {
				entry!.status = 'rejected';
				entry!.error = error;
				throw error;
			});
	}

	return {
		key,
		get status() {
			return entry!.status;
		},
		read(): T {
			if (entry!.status === 'resolved') {
				return entry!.value as T;
			}
			if (entry!.status === 'rejected') {
				throw entry!.error;
			}
			throw entry!.promise;
		},
		toPromise(): Promise<T> {
			if (entry!.status === 'resolved') {
				return Promise.resolve(entry!.value as T);
			}
			if (entry!.status === 'rejected') {
				return Promise.reject(entry!.error);
			}
			return entry!.promise as Promise<T>;
		},
	};
}

/** Cache-aware resource factory — deduplicates in-flight and resolved fetches. */
export function createCacheResource<T>(key: string, factory: () => Promise<T>): DeferredResource<T> {
	return createDeferredResource(key, factory);
}

export function invalidateCacheResource(key: string): void {
	cache.delete(key);
}

export function clearResourceCache(): void {
	cache.clear();
}

export function peekCacheResource<T>(key: string): T | undefined {
	const entry = cache.get(key);
	if (entry?.status === 'resolved') {
		return entry.value as T;
	}
	return undefined;
}
