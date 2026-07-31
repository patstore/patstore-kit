import { fetchModules } from './client/patstore-client.js';
import { getCollectionKey } from './collection-keys.js';
import { readPatStoreEnv } from './env.js';
import type { ModuleRegistrySnapshot, PatStoreModule } from './types.js';

let snapshot: ModuleRegistrySnapshot | null = null;
let loadPromise: Promise<ModuleRegistrySnapshot> | null = null;

export function toCollectionKey(className: string): string {
	return getCollectionKey(className);
}

function buildSnapshot(modules: PatStoreModule[]): ModuleRegistrySnapshot {
	const byClass = new Map<string, PatStoreModule>();
	const collectionKeys = new Map<string, string>();

	for (const module of modules) {
		byClass.set(module.connected_class, module);
		collectionKeys.set(module.connected_class, getCollectionKey(module.connected_class));
	}

	return { modules, byClass, collectionKeys };
}

export async function loadModuleRegistry(): Promise<ModuleRegistrySnapshot> {
	if (snapshot) {
		return snapshot;
	}

	if (!loadPromise) {
		loadPromise = (async () => {
			const env = readPatStoreEnv();
			const modules = await fetchModules(env.PROJECT_ID);
			snapshot = buildSnapshot(modules);
			return snapshot;
		})().catch((error) => {
			loadPromise = null;
			throw error;
		});
	}

	return loadPromise;
}

export function getModuleRegistry(): ModuleRegistrySnapshot | null {
	return snapshot;
}

export function getModuleForClass(className: string): PatStoreModule | undefined {
	return snapshot?.byClass.get(className);
}

export function getModuleCollectionKey(className: string): string {
	return snapshot?.collectionKeys.get(className) ?? getCollectionKey(className);
}

export function resetModuleRegistry(): void {
	snapshot = null;
	loadPromise = null;
}
