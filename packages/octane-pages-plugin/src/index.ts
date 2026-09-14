import * as fs from 'node:fs';
import * as path from 'node:path';
import type { Plugin } from 'vite';
import { generateRoutes } from './generate-routes.js';

export interface OctanePagesPluginOptions {
	/** Directory containing route page files. Default: `src/pages` */
	pagesDir?: string;
	/** Generated output directory. Default: `src/pages/.generated` */
	outputDir?: string;
}

export function octanePagesPlugin(options: OctanePagesPluginOptions = {}): Plugin {
	const pagesDir = options.pagesDir ?? 'src/pages';
	const outputDir = options.outputDir ?? 'src/pages/.generated';
	let root = process.cwd();

	const runCodegen = () => {
		generateRoutes({
			pagesDir: path.resolve(root, pagesDir),
			outputDir: path.resolve(root, outputDir),
		});
	};

	return {
		name: 'octane-pages',
		enforce: 'pre',
		configResolved(config) {
			root = config.root;
		},
		buildStart() {
			runCodegen();
		},
		configureServer(server) {
			const absolutePagesDir = path.resolve(root, pagesDir);
			runCodegen();

			const watchDir = (dir: string) => {
				if (!fs.existsSync(dir)) {
					return;
				}

				fs.watch(dir, { recursive: true }, (_event, filename) => {
					if (!filename || !filename.endsWith('.tsrx')) {
						return;
					}
					if (filename.includes('.generated')) {
						return;
					}

					runCodegen();
					server.ws.send({ type: 'full-reload' });
				});
			};

			watchDir(absolutePagesDir);
		},
	};
}

export { generateRoutes } from './generate-routes.js';
export { cmsPathForPattern } from './cms-path.js';
export { scanPagesDir, filePathToRoutePattern, importAliasForRoute, routeSegmentsToPatterns, patternToRouteId, fileToImportAlias, OPTIONAL_LANG_DIR } from './scan-pages.js';
export type { ScannedPageRoute, ScannedPages } from './scan-pages.js';
