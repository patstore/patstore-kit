import * as fs from 'node:fs';
import * as path from 'node:path';
import type { PatStoreObject } from '@patstore/core';
import { ASSET_URL_PREFIX } from './process-files.js';
import type { BuildTimeData } from './ssg-fetcher.js';

export interface MergeCollectionResult {
	merged: PatStoreObject[];
	changed: PatStoreObject[];
	unchangedCount: number;
	removedIds: string[];
}

function recordTimestamp(record: PatStoreObject): string {
	return String(record.updatedAt ?? record.createdAt ?? '');
}

export function hasRecordChanged(
	existing: PatStoreObject | undefined,
	fresh: PatStoreObject,
): boolean {
	if (!existing) {
		return true;
	}
	return recordTimestamp(existing) !== recordTimestamp(fresh);
}

export function mergeCollectionRecords(
	existingRecords: PatStoreObject[] | undefined,
	freshRecords: PatStoreObject[],
): MergeCollectionResult {
	const existingById = new Map(
		(existingRecords ?? []).map((record) => [record.objectId, record]),
	);
	const freshIds = new Set(freshRecords.map((record) => record.objectId));

	const removedIds = (existingRecords ?? [])
		.filter((record) => !freshIds.has(record.objectId))
		.map((record) => record.objectId);

	const merged: PatStoreObject[] = [];
	const changed: PatStoreObject[] = [];
	let unchangedCount = 0;

	for (const fresh of freshRecords) {
		const existing = existingById.get(fresh.objectId);
		if (hasRecordChanged(existing, fresh)) {
			merged.push(fresh);
			changed.push(fresh);
			continue;
		}

		merged.push(existing!);
		unchangedCount += 1;
	}

	return { merged, changed, unchangedCount, removedIds };
}

function extractAssetFilenames(value: unknown): string[] {
	const filenames: string[] = [];

	if (typeof value === 'string' && value.startsWith(`${ASSET_URL_PREFIX}/`)) {
		filenames.push(value.slice(ASSET_URL_PREFIX.length + 1));
		return filenames;
	}

	if (!value || typeof value !== 'object') {
		return filenames;
	}

	if (Array.isArray(value)) {
		for (const entry of value) {
			filenames.push(...extractAssetFilenames(entry));
		}
		return filenames;
	}

	if ('url' in value && typeof (value as { url: unknown }).url === 'string') {
		const url = (value as { url: string }).url;
		if (url.startsWith(`${ASSET_URL_PREFIX}/`)) {
			filenames.push(url.slice(ASSET_URL_PREFIX.length + 1));
		}
	}

	for (const entry of Object.values(value as Record<string, unknown>)) {
		filenames.push(...extractAssetFilenames(entry));
	}

	return filenames;
}

export function collectReferencedAssetFilenames(data: BuildTimeData): Set<string> {
	const referenced = new Set<string>();

	for (const [key, value] of Object.entries(data)) {
		if (key.startsWith('_') || key === 'downloadedFiles' || !Array.isArray(value)) {
			continue;
		}

		for (const record of value) {
			for (const fieldValue of Object.values(record as Record<string, unknown>)) {
				for (const filename of extractAssetFilenames(fieldValue)) {
					referenced.add(filename);
				}
			}
		}
	}

	return referenced;
}

export function pruneOrphanedAssets(assetsDir: string, referenced: Set<string>): string[] {
	if (!fs.existsSync(assetsDir)) {
		return [];
	}

	const removed: string[] = [];

	for (const entry of fs.readdirSync(assetsDir, { withFileTypes: true })) {
		if (!entry.isFile() || entry.name.startsWith('.')) {
			continue;
		}

		if (!referenced.has(entry.name)) {
			fs.unlinkSync(path.join(assetsDir, entry.name));
			removed.push(entry.name);
		}
	}

	return removed;
}

export function loadExistingBuildTimeData(outputDir: string): BuildTimeData | null {
	const filePath = path.join(outputDir, 'build-time-data.json');
	if (!fs.existsSync(filePath)) {
		return null;
	}

	try {
		return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as BuildTimeData;
	} catch {
		return null;
	}
}

export function getStaleCollectionKeys(
	existing: BuildTimeData | null,
	activeStorageKeys: Set<string>,
): string[] {
	if (!existing) {
		return [];
	}

	return Object.keys(existing).filter(
		(key) =>
			!key.startsWith('_') &&
			key !== 'downloadedFiles' &&
			Array.isArray(existing[key]) &&
			!activeStorageKeys.has(key),
	);
}
