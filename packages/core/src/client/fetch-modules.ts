import type { GraphQLClient } from 'graphql-request';
import type { DataField, PatStoreModule, PatStoreObject } from '../types.js';
import { defaultProjectFilter, MODULE_GRAPHQL_SELECTION } from '../planner/field-selection.js';

function unwrapElement(value: unknown): unknown {
	if (
		value &&
		typeof value === 'object' &&
		'value' in value &&
		(typeof (value as { __typename?: string }).__typename === 'undefined' ||
			(value as { __typename?: string }).__typename === 'Element')
	) {
		return (value as { value: unknown }).value;
	}
	return value;
}

export function normalizeModule(node: PatStoreObject): PatStoreModule {
	const fieldsRaw = node.fields;
	const dataFieldsRaw = node.data_fields;

	let fields: PatStoreModule['fields'] = [];
	if (Array.isArray(fieldsRaw)) {
		fields = fieldsRaw.map((entry) => unwrapElement(entry) as PatStoreModule['fields'][number]);
	} else if (fieldsRaw) {
		const unwrapped = unwrapElement(fieldsRaw);
		fields = Array.isArray(unwrapped) ? unwrapped : [];
	}

	let data_fields: DataField[] = [];
	if (Array.isArray(dataFieldsRaw)) {
		data_fields = dataFieldsRaw.map((entry) => unwrapElement(entry) as DataField);
	} else if (dataFieldsRaw) {
		const unwrapped = unwrapElement(dataFieldsRaw);
		data_fields = Array.isArray(unwrapped) ? unwrapped : [];
	}

	return {
		objectId: node.objectId,
		name: String(node.name ?? ''),
		connected_class: String(node.connected_class ?? ''),
		fields,
		data_fields,
	};
}

/**
 * Fetch PatStore Module definitions via GraphQL (same transport as content collections).
 */
export async function fetchModulesGraphQL(
	client: GraphQLClient,
	projectId: string,
): Promise<PatStoreModule[]> {
	const query = `
		query SsgModules(
			$params: ModuleWhereInput
			$first: Int
			$skip: Int
			$order: [ModuleOrder!]
		) {
			modules(where: $params, first: $first, skip: $skip, order: $order) {
				count
				edges {
					node {
						id
						objectId
						${MODULE_GRAPHQL_SELECTION}
					}
				}
			}
		}
	`;

	const params = defaultProjectFilter(projectId);
	const pageSize = 100;
	let skip = 0;
	let total = Infinity;
	const modules: PatStoreModule[] = [];

	while (skip < total) {
		const data = await client.request<
			Record<string, { count: number; edges: { node: PatStoreObject }[] }>
		>(query, {
			params,
			first: pageSize,
			skip,
			order: ['createdAt_DESC'],
		});

		const connection = data.modules;
		const batch = connection?.edges?.map((edge) => normalizeModule(edge.node)) ?? [];
		total = connection?.count ?? batch.length;
		modules.push(...batch);
		skip += pageSize;

		if (batch.length < pageSize) {
			break;
		}
	}

	return modules;
}
