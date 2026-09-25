import { GraphQLClient } from 'graphql-request';
import { fetchModulesGraphQL } from './fetch-modules.js';
import { normalizeRecord } from './normalize-record.js';
import { getCollectionKey } from '../collection-keys.js';
import { readPatStoreEnv } from '../env.js';
import { isMissingCategoriesFieldError, stripCategoriesSelection } from '../planner/field-selection.js';
import type { GraphQLListVariables, PatStoreModule, PatStoreObject } from '../types.js';

let graphqlClient: GraphQLClient | null = null;

export function getGraphQLClient(): GraphQLClient {
	if (!graphqlClient) {
		const env = readPatStoreEnv();
		graphqlClient = new GraphQLClient(env.GRAPHQL_API_URL, {
			headers: {
				'X-Parse-Application-Id': env.APP_ID,
				'X-Parse-Client-Key': env.CLIENT_KEY,
			},
		});
	}
	return graphqlClient;
}

export async function fetchModules(projectId: string): Promise<PatStoreModule[]> {
	const client = getGraphQLClient();
	return fetchModulesGraphQL(client, projectId);
}

export async function graphqlFind<T extends PatStoreObject>(
	className: string,
	collectionKey: string,
	selection: string,
	variables: GraphQLListVariables,
): Promise<T[]> {
	const client = getGraphQLClient();
	const queryName = collectionKey;
	const objectName = className;

	const query = `
		query Find${className}(
			$params: ${objectName}WhereInput
			$first: Int
			$skip: Int
			$order: [${objectName}Order!]
		) {
			${queryName}(where: $params, first: $first, skip: $skip, order: $order) {
				edges {
					node {
						id
						objectId
						${selection}
					}
				}
			}
		}
	`;

	try {
		const data = await client.request<Record<string, { edges: { node: T }[] }>>(query, {
			params: variables.params ?? {},
			first: variables.first ?? 100,
			skip: variables.skip ?? 0,
			order: variables.order ?? ['createdAt_DESC'],
		});

		const connection = data[queryName];
		return connection?.edges?.map((edge) => normalizeRecord(edge.node)) ?? [];
	} catch (error) {
		if (!isMissingCategoriesFieldError(error) || selection === stripCategoriesSelection(selection)) {
			throw error;
		}
		return graphqlFind(className, collectionKey, stripCategoriesSelection(selection), variables);
	}
}

export async function graphqlGet<T extends PatStoreObject>(
	className: string,
	objectId: string,
	selection: string,
): Promise<T | null> {
	const client = getGraphQLClient();
	const collectionKey = getCollectionKey(className);

	const query = `
		query Get${className}($id: ID!) {
			${collectionKey}(where: { objectId: { equalTo: $id } }, first: 1) {
				edges {
					node {
						id
						objectId
						${selection}
					}
				}
			}
		}
	`;

	try {
		const data = await client.request<Record<string, { edges: { node: T }[] }>>(query, {
			id: objectId,
		});

		const node = data[collectionKey]?.edges?.[0]?.node ?? null;
		return node ? normalizeRecord(node) : null;
	} catch (error) {
		if (!isMissingCategoriesFieldError(error) || selection === stripCategoriesSelection(selection)) {
			throw error;
		}
		return graphqlGet(className, objectId, stripCategoriesSelection(selection));
	}
}

export function resolveFileUrl(url: string): string {
	const env = readPatStoreEnv();
	if (!url) return url;
	if (url.startsWith('http://') || url.startsWith('https://')) {
		return url;
	}
	if (url.startsWith('/')) {
		return url;
	}
	const base = env.FILE_URL.replace(/\/$/, '');
	const path = url.startsWith('/') ? url : `/${url}`;
	return `${base}${path}`;
}
