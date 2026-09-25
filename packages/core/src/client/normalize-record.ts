import type { PatStoreObject } from '../types.js';

const ELEMENT_TYPENAMES = new Set(['Element', 'ArrayResult']);
const WRAPPER_KEYS = new Set(['value', '__typename']);

/**
 * Unwrap GraphQL `Element` / `ArrayResult` wrappers (`{ value }`) to the inner value.
 * Objects with additional keys (e.g. `{ path, value }`) are left unchanged.
 */
export function unwrapElement(value: unknown): unknown {
	if (!value || typeof value !== 'object' || Array.isArray(value) || !('value' in value)) {
		return value;
	}

	const keys = Object.keys(value);
	if (keys.length === 0 || !keys.every((key) => WRAPPER_KEYS.has(key))) {
		return value;
	}

	const typename = (value as { __typename?: string }).__typename;
	if (typeof typename !== 'undefined' && !ELEMENT_TYPENAMES.has(typename)) {
		return value;
	}

	return (value as { value: unknown }).value;
}

/** Unwrap Element wrappers on a field, including arrays of `{ value }`. */
export function normalizeGraphQLValue(value: unknown): unknown {
	const unwrapped = unwrapElement(value);
	if (Array.isArray(unwrapped)) {
		return unwrapped.map((entry) => unwrapElement(entry));
	}
	return unwrapped;
}

/** Normalize every field on a GraphQL record to match SSG static data. */
export function normalizeRecord<T extends PatStoreObject>(record: T): T {
	const next: PatStoreObject = { ...record };
	for (const [key, value] of Object.entries(next)) {
		next[key] = normalizeGraphQLValue(value);
	}
	return next as T;
}
