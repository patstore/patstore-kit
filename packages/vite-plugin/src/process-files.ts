import { listFileFields } from '@patstore/core';
import type { PatStoreModule, PatStoreObject } from '@patstore/core';
import type { FileDownloader } from './file-downloader.js';

export const ASSET_URL_PREFIX = '/asset';

function resolveAbsoluteFileUrl(url: string, fileUrlBase: string): string {
	if (!url) return url;
	if (url.startsWith('http://') || url.startsWith('https://')) {
		return url;
	}
	const base = fileUrlBase.replace(/\/$/, '');
	return `${base}${url.startsWith('/') ? url : `/${url}`}`;
}

function assetUrl(filename: string): string {
	return `${ASSET_URL_PREFIX}/${filename}`;
}

async function processFieldValue(
	value: unknown,
	objectId: string,
	title: string,
	downloader: FileDownloader,
	fileUrlBase: string,
	suffix = '',
): Promise<{ value: unknown; localPaths: string[] }> {
	const localPaths: string[] = [];

	if (value && typeof value === 'object' && !Array.isArray(value) && 'url' in value) {
		const file = value as { name?: string; url: string };
		if (!file.url) {
			return { value, localPaths };
		}

		const absoluteUrl = resolveAbsoluteFileUrl(file.url, fileUrlBase);
		const downloaded = await downloader.downloadFile(
			absoluteUrl,
			`${objectId}${suffix}`,
			file.name ?? title,
		);

		if (!downloaded) {
			return { value, localPaths };
		}

		const localUrl = assetUrl(downloaded.filename);
		localPaths.push(localUrl);
		return {
			value: { ...file, url: localUrl },
			localPaths,
		};
	}

	if (Array.isArray(value)) {
		const next: unknown[] = [];
		for (let i = 0; i < value.length; i++) {
			const entry = value[i];
			if (entry && typeof entry === 'object' && 'url' in entry) {
				const result = await processFieldValue(entry, objectId, title, downloader, fileUrlBase, `-${i}`);
				next.push(result.value);
				localPaths.push(...result.localPaths);
			} else {
				next.push(entry);
			}
		}
		return { value: next, localPaths };
	}

	return { value, localPaths };
}

export async function processRecordFiles(
	record: PatStoreObject,
	module: PatStoreModule,
	downloader: FileDownloader,
	fileUrlBase: string,
): Promise<void> {
	const fileFields = listFileFields(module);
	if (fileFields.length === 0) {
		return;
	}

	const objectId = record.objectId;
	const title = String(record.title ?? record.label ?? record.name ?? objectId);

	for (const fieldName of fileFields) {
		const fieldValue = record[fieldName];
		if (!fieldValue) {
			continue;
		}

		const { value, localPaths } = await processFieldValue(
			fieldValue,
			objectId,
			title,
			downloader,
			fileUrlBase,
		);

		record[fieldName] = value;

		if (localPaths.length === 1) {
			record[`${fieldName}_local`] = localPaths[0];
		} else if (localPaths.length > 1) {
			record[`${fieldName}_local`] = localPaths;
		}
	}
}

export async function processCollectionFiles(
	records: PatStoreObject[],
	module: PatStoreModule,
	downloader: FileDownloader,
	fileUrlBase: string,
): Promise<void> {
	for (const record of records) {
		await processRecordFiles(record, module, downloader, fileUrlBase);
	}
}
