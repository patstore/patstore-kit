import * as fs from 'node:fs';
import * as path from 'node:path';

export interface DownloadedFile {
	objectId: string;
	originalUrl: string;
	localPath: string;
	filename: string;
	type: 'image' | 'document';
}

export class FileDownloader {
	private downloadedFiles = new Map<string, DownloadedFile>();

	constructor(private readonly outputDir: string) {
		fs.mkdirSync(outputDir, { recursive: true });
	}

	private getFileExtension(url: string): string {
		const match = url.match(/\.([a-zA-Z0-9]+)(?:\?|$)/);
		return match ? match[1] : '';
	}

	private sanitizeFilename(name: string): string {
		return name
			.replace(/[^a-zA-Z0-9._-]+/g, '_')
			.replace(/^_+|_+$/g, '')
			.slice(0, 120);
	}

	private generateFilename(url: string, objectId: string, title: string): string {
		const ext = this.getFileExtension(url);
		const base = this.sanitizeFilename(title) || objectId;
		if (!ext) {
			return base;
		}
		if (base.toLowerCase().endsWith(`.${ext.toLowerCase()}`)) {
			return base;
		}
		return `${base}.${ext}`;
	}

	private isImageFile(url: string): boolean {
		const imageExtensions = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp', 'ico'];
		return imageExtensions.includes(this.getFileExtension(url).toLowerCase());
	}

	async downloadFile(
		url: string,
		objectId: string,
		title: string,
	): Promise<DownloadedFile | null> {
		try {
			const cacheKey = `${objectId}-${url}`;
			const cached = this.downloadedFiles.get(cacheKey);
			if (cached) {
				return cached;
			}

			const filename = this.generateFilename(url, objectId, title);
			const diskPath = path.join(this.outputDir, filename);

			if (fs.existsSync(diskPath)) {
				console.log(`   ⚡ cached ${filename}`);
				const downloadedFile: DownloadedFile = {
					objectId,
					originalUrl: url,
					localPath: filename,
					filename,
					type: this.isImageFile(url) ? 'image' : 'document',
				};
				this.downloadedFiles.set(cacheKey, downloadedFile);
				return downloadedFile;
			}

			console.log(`   📥 ${filename}`);
			const response = await fetch(url);
			if (!response.ok) {
				console.error(`   ❌ download failed (${response.status}): ${url}`);
				return null;
			}

			const buffer = Buffer.from(await response.arrayBuffer());
			fs.writeFileSync(diskPath, buffer);

			const downloadedFile: DownloadedFile = {
				objectId,
				originalUrl: url,
				localPath: filename,
				filename,
				type: this.isImageFile(url) ? 'image' : 'document',
			};
			this.downloadedFiles.set(cacheKey, downloadedFile);
			return downloadedFile;
		} catch (error) {
			console.error(`   ❌ download error: ${url}`, error);
			return null;
		}
	}

	getDownloadedFiles(): DownloadedFile[] {
		return Array.from(this.downloadedFiles.values());
	}
}
