import { getStorageKey } from '../collection-keys.js';
import { isFileField } from '../planner/field-selection.js';
import type { DataField, ModuleField, ModuleFieldType, PatStoreModule } from '../types.js';

const SKIP_FIELD_IDS = new Set(['createdAt', 'updatedAt', 'objectId', 'ACL', 'id']);

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

const STRING_FIELD_TYPES = new Set<ModuleFieldType>([
	'string',
	'edit_string',
	'textfield',
	'edit_textfield',
	'texteditor',
	'edit_texteditor',
	'edit_content',
	'state',
	'edit_state',
	'location',
	'edit_color',
	'custom',
	'video',
	'edit_role',
	'emails',
]);

const FILE_LIKE_FIELD_TYPES = new Set<ModuleFieldType>([
	'file',
	'portrait',
	'documents',
	'image',
	'edit_image',
	'image_preview',
]);

const HELPER_TYPE_IMPORTS = {
	PatStoreFile: true,
	PatStorePersonRef: true,
	PatStoreCategoryRef: true,
	PatStoreUserRef: true,
	PatStoreGeoPoint: true,
	PatStoreObject: true,
} as const;

export interface PatstoreTypeEntry {
	className: string;
	typeName: string;
	storageKey: string;
}

export function patstoreTypeName(className: string): string {
	const cleaned = className.replace(/[^A-Za-z0-9_]/g, '');
	const base = cleaned.length > 0 ? cleaned : 'Record';
	const ident = /^[A-Za-z_]/.test(base) ? base : `_${base}`;
	return `Patstore${ident}`;
}

export function listPatstoreTypeEntries(modules: PatStoreModule[]): PatstoreTypeEntry[] {
	const seen = new Set<string>();
	const entries: PatstoreTypeEntry[] = [];

	for (const module of modules) {
		const className = module.connected_class?.trim();
		if (!className || seen.has(className)) {
			continue;
		}
		seen.add(className);
		entries.push({
			className,
			typeName: patstoreTypeName(className),
			storageKey: getStorageKey(className),
		});
	}

	return entries;
}

function tsProp(name: string): string {
	return /^[A-Za-z_$][\w$]*$/.test(name) ? name : JSON.stringify(name);
}

function typescriptTypeForFieldType(type: ModuleFieldType, fieldId: string): string {
	if (fieldId === 'documents' || type === 'documents' || type === 'files') {
		return 'PatStoreFile[] | null';
	}
	if (FILE_LIKE_FIELD_TYPES.has(type) || fieldId === 'file' || fieldId === 'portrait') {
		return 'PatStoreFile | null';
	}
	if (type === 'boolean') {
		return 'boolean | null';
	}
	if (type === 'date' || type === 'edit_date' || type === 'date_picker') {
		return 'string | null';
	}
	if (type === 'geopoint' || type === 'edit_geopoint') {
		return 'PatStoreGeoPoint | null';
	}
	if (type === 'person' || type === 'edit_person') {
		return 'PatStorePersonRef | null';
	}
	if (
		type === 'user' ||
		type === 'updated_by' ||
		type === 'created_by' ||
		fieldId === 'user' ||
		fieldId === 'updated_by' ||
		fieldId === 'created_by'
	) {
		return 'PatStoreUserRef | null';
	}
	if (type === 'edit_persons' || type === 'edit_team' || type === 'persons') {
		return 'PatStorePersonRef[] | null';
	}
	if (type === 'category') {
		return 'PatStoreCategoryRef | null';
	}
	if (type === 'categories') {
		return 'PatStoreCategoryRef[] | null';
	}
	if (type === 'gallery') {
		return 'PatStoreFile[] | null';
	}
	if (ELEMENT_ARRAY_FIELD_TYPES.has(type)) {
		return 'unknown[] | null';
	}
	if (STRING_FIELD_TYPES.has(type)) {
		return 'string | null';
	}
	return 'unknown';
}

export function typescriptTypeForField(field: ModuleField): string {
	if (isFileField(field) && field.type !== 'documents' && field.id !== 'documents') {
		return 'PatStoreFile | null';
	}
	return typescriptTypeForFieldType(field.type, field.id);
}

function collectFields(module: PatStoreModule): Array<{
	id: string;
	label: string;
	required: boolean;
	tsType: string;
	local?: boolean;
}> {
	const byId = new Map<
		string,
		{ id: string; label: string; required: boolean; tsType: string; local?: boolean }
	>();

	const fields = Array.isArray(module.fields) ? module.fields : [];
	const sorted = [...fields]
		.filter((field) => field && field.active !== false && field.id && !SKIP_FIELD_IDS.has(field.id))
		.sort((a, b) => (a.position ?? 0) - (b.position ?? 0));

	for (const field of sorted) {
		byId.set(field.id, {
			id: field.id,
			label: field.label || field.id,
			required: Boolean(field.required),
			tsType: typescriptTypeForField(field),
			local: isFileField(field),
		});
	}

	const dataFields: DataField[] = Array.isArray(module.data_fields) ? module.data_fields : [];
	for (const field of dataFields) {
		const id = field.name || field.id;
		if (!id || SKIP_FIELD_IDS.has(id) || byId.has(id)) {
			continue;
		}
		byId.set(id, {
			id,
			label: field.label || id,
			required: false,
			tsType: typescriptTypeForFieldType(field.type, id),
		});
	}

	return [...byId.values()];
}

function generateInterface(module: PatStoreModule, typeName: string): string {
	const fields = collectFields(module);
	const lines: string[] = [
		`export interface ${typeName} extends PatStoreObject {`,
		'\tobjectId: string;',
		'\tid?: string;',
		'\tcreatedAt?: string;',
		'\tupdatedAt?: string;',
	];

	for (const field of fields) {
		const optional = field.required ? '' : '?';
		const tsType = field.required ? field.tsType.replace(/ \| null$/, '') : field.tsType;
		const comment =
			field.label && field.label !== field.id
				? `\t/** ${field.label.replace(/\s+/g, ' ').replace(/\*\//g, '*\\/')} */\n`
				: '';
		lines.push(`${comment}\t${tsProp(field.id)}${optional}: ${tsType};`);
		if (field.local) {
			lines.push(`\t${tsProp(`${field.id}_local`)}?: string | string[];`);
		}
	}

	lines.push('}');
	return lines.join('\n');
}

function helpersUsedIn(source: string): string[] {
	return Object.keys(HELPER_TYPE_IMPORTS).filter((name) => source.includes(name));
}

/**
 * Generates a TypeScript module of `Patstore{ClassName}` interfaces from
 * PatStore Module field definitions, plus a `PatstoreClassMap` augmentation.
 */
export function generatePatstoreTypesSource(modules: PatStoreModule[]): string {
	const entries = listPatstoreTypeEntries(modules);
	const byClass = new Map<string, PatStoreModule>();
	for (const module of modules) {
		const className = module.connected_class?.trim();
		if (className && !byClass.has(className)) {
			byClass.set(className, module);
		}
	}

	const interfaces: string[] = [];
	for (const entry of entries) {
		const module = byClass.get(entry.className);
		if (!module) {
			continue;
		}
		interfaces.push(generateInterface(module, entry.typeName));
	}

	const body = interfaces.join('\n\n');
	const helpers = helpersUsedIn(`${body}\nPatStoreObject`);
	const importLine =
		helpers.length > 0
			? `import type { ${helpers.join(', ')} } from '@patstore/core';\n\n`
			: '';

	const typeExports =
		entries.length > 0
			? `export type PatstoreRecord = ${entries.map((entry) => entry.typeName).join(' | ')};\n\n`
			: 'export type PatstoreRecord = PatStoreObject;\n\n';

	const augmentation =
		entries.length > 0
			? `declare module '@patstore/core' {\n\tinterface PatstoreClassMap {\n${entries
					.map((entry) => `\t\t${tsProp(entry.className)}: ${entry.typeName};`)
					.join('\n')}\n\t}\n}\n`
			: '';

	return `// Auto-generated by vite-plugin-patstore — do not edit
// import type { ${entries.map((e) => e.typeName).join(', ') || 'PatstoreRecord'} } from '@cms'

${importLine}${body ? `${body}\n\n` : ''}${typeExports}${augmentation}`;
}
