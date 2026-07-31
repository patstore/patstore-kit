import type { ModuleField, ModuleFieldType, PatStoreModule } from '../types.js';

/** GraphQL fields on Module records — Element arrays hold JSON field definitions. */
export const MODULE_GRAPHQL_SELECTION = `
	name
	connected_class
	fields {
		... on Element {
			value
		}
	}
	data_fields {
		... on Element {
			value
		}
	}
`;

const FILE_FIELD_TYPES = new Set<ModuleFieldType>(['file', 'portrait']);

/** Field ids that are always FileInfo in GraphQL, regardless of module field type. */
const FILE_FIELD_IDS = new Set(['file', 'portrait']);

const DOCUMENT_FIELD_IDS = new Set(['documents']);

const ELEMENT_ARRAY_FIELD_TYPES = new Set<ModuleFieldType>([
	'categories',
	'fields',
	'data_fields',
	'setting_fields',
	'roles',
	'gallery',
	'persons',
	'times',
	'dates',
	'connected_elements',
	'form_fields',
	'content',
	'edit_webpage_components',
	'edit_dates',
	'edit_times',
]);

const SCALAR_FIELD_TYPES = new Set<ModuleFieldType>([
	'string',
	'edit_string',
	'textfield',
	'edit_textfield',
	'texteditor',
	'edit_texteditor',
	'content',
	'edit_content',
	'image',
	'edit_image',
	'image_preview',
	'state',
	'edit_state',
	'location',
	'edit_color',
	'custom',
	'video',
	'user',
	'updated_by',
	'created_by',
	'edit_role',
	'files',
	'edit_persons',
	'edit_team',
	'emails',
]);

const SKIP_FIELD_IDS = new Set(['createdAt', 'updatedAt', 'objectId', 'ACL']);

function fileSelection(fieldId: string): string {
	return `${fieldId} { name url }`;
}

function elementArraySelection(fieldId: string): string {
	return `${fieldId} {
		... on Element {
			value
		}
	}`;
}

export function isFileField(field: ModuleField, _className?: string): boolean {
	if (!field.active || SKIP_FIELD_IDS.has(field.id)) {
		return false;
	}
	return FILE_FIELD_IDS.has(field.id) || FILE_FIELD_TYPES.has(field.type) || DOCUMENT_FIELD_IDS.has(field.id);
}

export function isSupportedFieldType(type: ModuleFieldType): boolean {
	return (
		FILE_FIELD_TYPES.has(type) ||
		ELEMENT_ARRAY_FIELD_TYPES.has(type) ||
		SCALAR_FIELD_TYPES.has(type) ||
		type === 'person' ||
		type === 'edit_person' ||
		type === 'category' ||
		type === 'date' ||
		type === 'edit_date' ||
		type === 'date_picker' ||
		type === 'boolean' ||
		type === 'geopoint' ||
		type === 'edit_geopoint' ||
		type === 'documents'
	);
}

export function selectionForField(field: ModuleField, _className?: string): string {
	if (!field.active || SKIP_FIELD_IDS.has(field.id)) {
		return '';
	}

	if (FILE_FIELD_IDS.has(field.id) || FILE_FIELD_TYPES.has(field.type)) {
		return fileSelection(field.id);
	}

	if (DOCUMENT_FIELD_IDS.has(field.id) || field.type === 'documents') {
		return fileSelection(field.id);
	}

	if (ELEMENT_ARRAY_FIELD_TYPES.has(field.type)) {
		return elementArraySelection(field.id);
	}

	if (SCALAR_FIELD_TYPES.has(field.type)) {
		return field.id;
	}

	if (field.type === 'person' || field.type === 'edit_person') {
		return `${field.id} { objectId label portrait { name url } }`;
	}

	if (field.type === 'category') {
		return `${field.id} { objectId label }`;
	}

	if (field.type === 'date' || field.type === 'edit_date' || field.type === 'date_picker') {
		return field.id;
	}

	if (field.type === 'geopoint' || field.type === 'edit_geopoint') {
		return `${field.id} { latitude longitude }`;
	}

	if (field.type === 'boolean') {
		return field.id;
	}

	return '';
}

export function listUnsupportedFields(module: PatStoreModule): ModuleField[] {
	return module.fields.filter(
		(field) => field.active && !SKIP_FIELD_IDS.has(field.id) && !isSupportedFieldType(field.type) && !FILE_FIELD_IDS.has(field.id),
	);
}

export function buildSelectionFromModule(module: PatStoreModule, extraFields: string[] = []): string {
	const className = module.connected_class;
	const activeFields = module.fields
		.filter((field) => field.active)
		.sort((a, b) => a.position - b.position);

	const unsupported = listUnsupportedFields(module);
	if (unsupported.length > 0) {
		console.warn(
			`[PatStore] Module "${module.name}" (${className}) — unsupported field types (skipped):`,
			unsupported.map((f) => `${f.id}:${f.type}`).join(', '),
		);
	}

	const fromModule = activeFields
		.map((field) => selectionForField(field, className))
		.filter(Boolean)
		.join('\n');

	const extras = extraFields.filter(Boolean).join('\n');

	return [fromModule, extras].filter(Boolean).join('\n');
}

export function listFileFields(module: PatStoreModule): string[] {
	return module.fields
		.filter((field) => isFileField(field, module.connected_class))
		.map((field) => field.id);
}

export function defaultProjectFilter(projectId: string): Record<string, unknown> {
	return {
		project: {
			have: {
				objectId: { equalTo: projectId },
			},
		},
	};
}
