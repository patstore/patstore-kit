export type ModuleFieldType =
	| 'string'
	| 'edit_string'
	| 'image'
	| 'category'
	| 'textfield'
	| 'edit_image'
	| 'file'
	| 'person'
	| 'content'
	| 'date'
	| 'boolean'
	| string;

export interface ModuleField {
	id: string;
	label: string;
	required: boolean;
	type: ModuleFieldType;
	active: boolean;
	position: number;
	default?: boolean;
}

export interface DataField {
	id: string;
	type: string;
	label: string;
	name: string;
	position: number;
}

export interface PatStoreModule {
	objectId: string;
	name: string;
	fields: ModuleField[];
	data_fields?: DataField[];
	connected_class: string;
	project?: { objectId: string } | null;
}

export interface PatStoreObject {
	objectId: string;
	createdAt?: string;
	updatedAt?: string;
	[key: string]: unknown;
}

/** File field value (`{ name, url }`) as returned by GraphQL / SSG artifacts. */
export interface PatStoreFile {
	name?: string;
	url: string;
}

/** Pointer-like person field (`person` / `edit_person`). */
export interface PatStorePersonRef {
	objectId: string;
	label?: string;
	portrait?: PatStoreFile | null;
}

/** Pointer-like category field. */
export interface PatStoreCategoryRef {
	objectId: string;
	label?: string;
}

export interface PatStoreGeoPoint {
	latitude: number;
	longitude: number;
}

/**
 * Project-specific `className` → record type map.
 * Augmented by generated `@cms` types (e.g. `Article: PatstoreArticle`).
 */
export interface PatstoreClassMap {}

/** Record type for `className`, or {@link PatStoreObject} when the class is unknown. */
export type PatstoreRecordOf<C extends string> = C extends keyof PatstoreClassMap
	? PatstoreClassMap[C]
	: PatStoreObject;

/** What a component (or page) asks for — no transport details. */
export interface QuerySpec {
	className: string;
	mode: 'find' | 'get';
	objectId?: string;
	where?: Record<string, unknown>;
	limit?: number;
	skip?: number;
	order?: string[];
	fields?: string[];
}

/** Agnostic, serialisable plan — not a Promise. */
export interface ExecutionPlan {
	id: string;
	spec: QuerySpec;
	steps: ExecutionStep[];
	resultStepId: string;
}

export type ExecutionStep =
	| {
			id: string;
			kind: 'load-modules';
	  }
	| {
			id: string;
			kind: 'graphql-find';
			className: string;
			collectionKey: string;
			selection: string;
			variables: GraphQLListVariables;
	  }
	| {
			id: string;
			kind: 'graphql-get';
			className: string;
			objectId: string;
			selection: string;
	  }
	| {
			id: string;
			kind: 'resolve-files';
			sourceStepId: string;
			fileFields: string[];
	  };

export interface GraphQLListVariables {
	params?: Record<string, unknown>;
	first?: number;
	skip?: number;
	order?: string[];
}

export type ResourceStatus = 'idle' | 'pending' | 'resolved' | 'rejected';

/** Cache-aware deferred value — call toPromise() or read() (throws promise while pending). */
export interface DeferredResource<T> {
	key: string;
	status: ResourceStatus;
	read(): T;
	toPromise(): Promise<T>;
}

export interface PlanResult<T = unknown> {
	plan: ExecutionPlan;
	data: T;
}

export interface ModuleRegistrySnapshot {
	modules: PatStoreModule[];
	byClass: Map<string, PatStoreModule>;
	collectionKeys: Map<string, string>;
}
