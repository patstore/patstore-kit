import { GraphQLClient } from 'graphql-request';
import {
	buildSelectionFromModule,
	defaultProjectFilter,
	fetchModulesGraphQL,
	getCollectionKey,
	getStorageKey,
} from '@patstore/core';
import type { PatStoreModule, PatStoreObject } from '@patstore/core';
import { buildAuthHeaders, type PatStoreBuildEnv } from './build-env.js';
import type { DownloadedFile, FileDownloader } from './file-downloader.js';
import {
	collectReferencedAssetFilenames,
	getStaleCollectionKeys,
	mergeCollectionRecords,
	pruneOrphanedAssets,
} from './incremental-sync.js';
import { processCollectionFiles } from './process-files.js';

export interface BuildTimeData {
	_meta: {
		generatedAt: string;
		projectId: string;
		moduleCount: number;
	};
	_modules: PatStoreModule[];
	downloadedFiles?: DownloadedFile[];
	[key: string]: unknown;
}

export interface FetchBuildTimeDataOptions {
	fileDownloader?: FileDownloader;
	downloadAssets?: boolean;
	existingData?: BuildTimeData | null;
	assetsDir?: string;
}

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

function normalizeRecord(record: PatStoreObject): PatStoreObject {
	const next: PatStoreObject = { ...record };
	for (const [key, value] of Object.entries(next)) {
		if (Array.isArray(value)) {
			next[key] = value.map((entry) => unwrapElement(entry));
		} else {
			next[key] = unwrapElement(value);
		}
	}
	return next;
}

async function fetchCollection(
	env: PatStoreBuildEnv,
	client: GraphQLClient,
	className: string,
	module: PatStoreModule,
): Promise<PatStoreObject[]> {
	const collectionKey = getCollectionKey(className);
	const selection = buildSelectionFromModule(module, ['objectId', 'createdAt', 'updatedAt']);
	const params = defaultProjectFilter(env.projectId);

	const query = `
		query SsgFind${className}(
			$params: ${className}WhereInput
			$first: Int
			$skip: Int
			$order: [${className}Order!]
		) {
			${collectionKey}(where: $params, first: $first, skip: $skip, order: $order) {
				count
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

	const pageSize = 100;
	let skip = 0;
	let total = Infinity;
	const results: PatStoreObject[] = [];

	while (skip < total) {
		const data = await client.request<
			Record<string, { count: number; edges: { node: PatStoreObject }[] }>
		>(query, {
			params,
			first: pageSize,
			skip,
			order: ['createdAt_DESC'],
		});

		const connection = data[collectionKey];
		const batch = connection?.edges?.map((edge) => normalizeRecord(edge.node)) ?? [];
		total = connection?.count ?? batch.length;
		results.push(...batch);
		skip += pageSize;

		if (batch.length < pageSize) {
			break;
		}
	}

	return results;
}

function buildDownloadedFilesManifest(
	data: BuildTimeData,
	existing: BuildTimeData | null | undefined,
	downloader: FileDownloader | undefined,
): DownloadedFile[] {
	const referenced = collectReferencedAssetFilenames(data);
	const byFilename = new Map<string, DownloadedFile>();

	for (const file of existing?.downloadedFiles ?? []) {
		if (referenced.has(file.filename)) {
			byFilename.set(file.filename, file);
		}
	}

	for (const file of downloader?.getDownloadedFiles() ?? []) {
		byFilename.set(file.filename, file);
	}

	for (const filename of referenced) {
		if (!byFilename.has(filename)) {
			byFilename.set(filename, {
				objectId: '',
				originalUrl: '',
				localPath: filename,
				filename,
				type: filename.match(/\.(png|jpe?g|gif|webp|svg)$/i) ? 'image' : 'document',
			});
		}
	}

	return Array.from(byFilename.values());
}

export async function fetchBuildTimeData(
	env: PatStoreBuildEnv,
	options: FetchBuildTimeDataOptions = {},
): Promise<BuildTimeData> {
	const headers = buildAuthHeaders(env);
	const client = new GraphQLClient(env.graphqlUrl, { headers });
	const downloadAssets = options.downloadAssets !== false && Boolean(options.fileDownloader);
	let existing = options.existingData ?? null;

	if (existing?._meta?.projectId && existing._meta.projectId !== env.projectId) {
		console.log('   Full refresh — projectId changed');
		existing = null;
	}

	if (existing?._meta?.generatedAt) {
		console.log(`   Incremental sync from ${existing._meta.generatedAt}`);
	}

	console.log('\n📦 PatStore SSG: fetching modules (GraphQL)…');
	const modules = await fetchModulesGraphQL(client, env.projectId);
	console.log(`   Found ${modules.length} module(s)`);

	const data: BuildTimeData = {
		_meta: {
			generatedAt: new Date().toISOString(),
			projectId: env.projectId,
			moduleCount: modules.length,
		},
		_modules: modules,
	};

	const seen = new Set<string>();
	const activeStorageKeys = new Set<string>();

	for (const module of modules) {
		const className = module.connected_class;
		if (seen.has(className)) {
			continue;
		}
		seen.add(className);

		const storageKey = getStorageKey(className);
		activeStorageKeys.add(storageKey);

		console.log(`   Fetching ${className} → ${storageKey}…`);
		const freshRecords = await fetchCollection(env, client, className, module);
		const existingRecords = existing?.[storageKey] as PatStoreObject[] | undefined;
		const { merged, changed, unchangedCount, removedIds } = mergeCollectionRecords(
			existingRecords,
			freshRecords,
		);

		if (removedIds.length > 0) {
			console.log(`   − removed ${removedIds.length} stale record(s)`);
		}
		if (unchangedCount > 0) {
			console.log(`   ⚡ reused ${unchangedCount} unchanged record(s)`);
		}
		if (changed.length > 0) {
			console.log(`   ↻ updating ${changed.length} new/changed record(s)`);
		}

		if (downloadAssets && options.fileDownloader && changed.length > 0) {
			console.log(`   Downloading assets for ${changed.length} record(s)…`);
			await processCollectionFiles(changed, module, options.fileDownloader, env.fileUrl);
		}

		data[storageKey] = merged;
		console.log(`   ✓ ${merged.length} record(s)`);
	}

	const staleCollectionKeys = getStaleCollectionKeys(existing, activeStorageKeys);
	for (const key of staleCollectionKeys) {
		console.log(`   − removed stale collection "${key}"`);
	}

	if (options.fileDownloader) {
		data.downloadedFiles = buildDownloadedFilesManifest(data, existing, options.fileDownloader);
		console.log(`\n📁 Asset manifest: ${data.downloadedFiles.length} file(s)`);
	}

	if (options.assetsDir && downloadAssets) {
		const referenced = collectReferencedAssetFilenames(data);
		const removedAssets = pruneOrphanedAssets(options.assetsDir, referenced);
		if (removedAssets.length > 0) {
			console.log(`   🗑 removed ${removedAssets.length} orphaned asset(s)`);
		}
	}

	return data;
}

export { getStorageKey } from '@patstore/core';
