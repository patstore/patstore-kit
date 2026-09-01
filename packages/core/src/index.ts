export type * from './types.js';
export { readPatStoreEnv, isPatStoreConfigured } from './env.js';
export type { PatStoreClientEnv } from './env.js';

export { getCollectionKey, getStorageKey } from './collection-keys.js';
export {
	loadModuleRegistry,
	getModuleRegistry,
	getModuleForClass,
	getModuleCollectionKey,
	resetModuleRegistry,
	toCollectionKey,
} from './module-registry.js';

export { fetchModulesGraphQL, normalizeModule } from './client/fetch-modules.js';
export {
	getGraphQLClient,
	fetchModules,
	graphqlFind,
	graphqlGet,
	resolveFileUrl,
} from './client/patstore-client.js';

export {
	MODULE_GRAPHQL_SELECTION,
	buildSelectionFromModule,
	defaultProjectFilter,
	listFileFields,
	isFileField,
	isUserPointerField,
	isSupportedFieldType,
	selectionForField,
	listUnsupportedFields,
} from './planner/field-selection.js';
export { QueryPlanner, queryPlanner } from './planner/query-planner.js';
export { describePlan, planCacheKey, getResultStep, getStep } from './planner/execution-plan.js';

export {
	ResourceManager,
	resourceManager,
	createPatStoreResource,
} from './resources/resource-manager.js';
export {
	createCacheResource,
	invalidateCacheResource,
	clearResourceCache,
	peekCacheResource,
} from './resources/cache-resource.js';

export {
	configurePatStoreStaticData,
	getPatStoreStaticDataAccess,
	isStaticDataConfigured,
} from './static-data.js';
export type { PatStoreStaticDataAccess } from './static-data.js';

export {
	fetchPatStoreCollection,
	fetchPatStoreObject,
	fetchPatStoreData,
} from './fetch-patstore.js';
export type { PatStoreFetchOptions, PatStoreFetchSource } from './fetch-patstore.js';

export {
	usePatStoreData,
	usePatStoreCollection,
	usePatStoreObject,
} from './hooks/usePatStoreData.js';

export {
	generatePatstoreTypesSource,
	listPatstoreTypeEntries,
	patstoreTypeName,
	typescriptTypeForField,
} from './codegen/generate-patstore-types.js';
export type { PatstoreTypeEntry } from './codegen/generate-patstore-types.js';
