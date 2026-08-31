import type { PatstoreClassMap } from './types.js';

export interface PatStoreStaticDataAccess {
	isStaticDataReady: () => boolean;
	findStaticCollection: {
		<C extends keyof PatstoreClassMap>(className: C, limit?: number): PatstoreClassMap[C][];
		<T extends { objectId: string }>(className: string, limit?: number): T[];
	};
	findByObjectId: (objectId: string) => Record<string, unknown> | null;
}

let staticAccess: PatStoreStaticDataAccess | null = null;

/** Wire SSG-generated `@data` accessors once at app startup (e.g. in `main.ts`). */
export function configurePatStoreStaticData(access: PatStoreStaticDataAccess): void {
	staticAccess = access;
}

export function getPatStoreStaticDataAccess(): PatStoreStaticDataAccess | null {
	return staticAccess;
}

export function isStaticDataConfigured(): boolean {
	return staticAccess?.isStaticDataReady() ?? false;
}
