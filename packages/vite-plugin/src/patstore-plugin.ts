import * as fs from 'node:fs';
import * as path from 'node:path';
import type { Plugin } from 'vite';
import { isSsgEnabled, readPatStoreBuildEnv } from './build-env.js';
import { writeBuildTimeArtifacts, writeStubArtifacts } from './codegen.js';
import { FileDownloader } from './file-downloader.js';
import { loadExistingBuildTimeData } from './incremental-sync.js';
import { ASSET_URL_PREFIX } from './process-files.js';
import { fetchBuildTimeData } from './ssg-fetcher.js';

const REQUIRED_ENV = [
	'VITE_PATSTORE_API_URL',
	'VITE_PATSTORE_GRAPHQL_API_URL',
	'VITE_PATSTORE_APP_ID',
	'VITE_PATSTORE_CLIENT_KEY',
	'VITE_PATSTORE_FILE_URL',
	'VITE_PATSTORE_PROJECT_ID',
] as const;

const OPTIONAL_ENV = ['VITE_PATSTORE_REST_KEY', 'PATSTORE_MASTER_KEY', 'VITE_PATSTORE_MASTER_KEY'] as const;

const MIME_TYPES: Record<string, string> = {
	'.jpg': 'image/jpeg',
	'.jpeg': 'image/jpeg',
	'.png': 'image/png',
	'.gif': 'image/gif',
	'.webp': 'image/webp',
	'.svg': 'image/svg+xml',
	'.pdf': 'application/pdf',
};

function getMimeType(filePath: string): string {
	return MIME_TYPES[path.extname(filePath).toLowerCase()] ?? 'application/octet-stream';
}

function copyAssetsToDist(assetsDir: string): void {
	if (!fs.existsSync(assetsDir)) {
		return;
	}

	const destDir = path.join(process.cwd(), 'dist', 'asset');
	fs.mkdirSync(destDir, { recursive: true });
	fs.cpSync(assetsDir, destDir, {
		recursive: true,
		filter: (src: string) => !path.basename(src).startsWith('.'),
	});
	console.log(`📁 Assets copied to ${destDir}`);
}

export interface PatStorePluginOptions {
	/** When false, missing client env vars only warn. */
	strict?: boolean;
	/** When true, SSG fetch failures fail the build. Default: false. */
	strictSsg?: boolean;
	/** Build-time static data generation (SSG). Default: true unless VITE_PATSTORE_SSG=false. */
	ssg?: boolean;
	/** Download file fields into this directory. Default: `asset` at project root. */
	assetsDir?: string;
	/** Download CMS files during SSG. Default: true unless VITE_PATSTORE_DOWNLOAD_ASSETS=false. */
	downloadAssets?: boolean;
	outputDir?: string;
	env?: Record<string, string | undefined>;
}

/**
 * PatStore Vite plugin — validates client env and optionally fetches CMS data at build/dev start.
 */
export function patStorePlugin(options: PatStorePluginOptions = {}): Plugin {
	const outputDir = path.resolve(process.cwd(), options.outputDir ?? 'data');
	const assetsDir = path.resolve(process.cwd(), options.assetsDir ?? 'asset');
	let resolvedEnv: Record<string, string | undefined> = options.env ?? {};
	let resolvedAssetsDir: string | null = null;

	return {
		name: 'vite-plugin-patstore',

		config() {
			// Client env is passed via plugin options (`loadEnv` in vite.config.ts).
		},

		configResolved(config) {
			const strict = options.strict ?? false;
			const env = { ...resolvedEnv, ...(config as { env?: Record<string, string> }).env };
			const missing = REQUIRED_ENV.filter((key) => !env[key]);

			if (missing.length > 0) {
				const message = `PatStore plugin: missing ${missing.join(', ')}`;
				if (strict) {
					throw new Error(message);
				}
				console.warn(`⚠ ${message} — runtime CMS fetching may be unavailable.`);
			}

			const presentOptional = OPTIONAL_ENV.filter((key) => env[key]);
			if (presentOptional.length > 0) {
				console.log(`ℹ PatStore build credentials: ${presentOptional.join(', ')}`);
			}
		},

		configureServer(server) {
			server.middlewares.use((req, res, next) => {
				const prefix = `${ASSET_URL_PREFIX}/`;
				if (!req.url?.startsWith(prefix) || !resolvedAssetsDir) {
					next();
					return;
				}

				const filename = decodeURIComponent(req.url.slice(prefix.length).split('?')[0]);
				if (!filename || filename.includes('..')) {
					next();
					return;
				}

				const filePath = path.join(resolvedAssetsDir, filename);
				if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
					next();
					return;
				}

				res.setHeader('Content-Type', getMimeType(filePath));
				fs.createReadStream(filePath).pipe(res);
			});
		},

		async buildStart() {
			resolvedAssetsDir = assetsDir;

			if (!fs.existsSync(outputDir)) {
				writeStubArtifacts(outputDir);
			}

			const ssgEnabled = options.ssg ?? isSsgEnabled(resolvedEnv);
			if (!ssgEnabled) {
				console.log('ℹ PatStore SSG disabled (VITE_PATSTORE_SSG=false)');
				return;
			}

			const buildEnv = readPatStoreBuildEnv(resolvedEnv);
			if (!buildEnv) {
				console.warn(
					'⚠ PatStore SSG skipped — set PATSTORE_MASTER_KEY (or VITE_PATSTORE_REST_KEY) plus VITE_PATSTORE_* vars.',
				);
				return;
			}

			const downloadAssets =
				options.downloadAssets ?? resolvedEnv.VITE_PATSTORE_DOWNLOAD_ASSETS !== 'false';

			console.log('\n╔══════════════════════════════════════╗');
			console.log('║   PatStore SSG fetch starting…       ║');
			console.log('╚══════════════════════════════════════╝');

			try {
				fs.mkdirSync(assetsDir, { recursive: true });
				const fileDownloader = downloadAssets ? new FileDownloader(assetsDir) : undefined;
				const existingData = loadExistingBuildTimeData(outputDir);

				const data = await fetchBuildTimeData(buildEnv, {
					fileDownloader,
					downloadAssets,
					existingData,
					assetsDir,
				});
				writeBuildTimeArtifacts(outputDir, data);

				if (downloadAssets) {
					console.log(`📁 PatStore assets written to ${assetsDir}`);
				}
				console.log(`\n✅ PatStore SSG data written to ${outputDir}\n`);
			} catch (error) {
				console.error('\n❌ PatStore SSG fetch failed:', error);
				if (options.strictSsg) {
					throw error;
				}
				console.warn('⚠ Continuing with stub/existing static data.\n');
			}
		},

		closeBundle() {
			if (resolvedAssetsDir) {
				copyAssetsToDist(resolvedAssetsDir);
			}
		},
	};
}
