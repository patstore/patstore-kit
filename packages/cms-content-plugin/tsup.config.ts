import { defineConfig } from 'tsup';

export default defineConfig({
	entry: ['src/index.ts', 'src/reader.ts'],
	format: ['esm'],
	dts: true,
	clean: true,
	sourcemap: true,
	external: ['vite', '@patstore/core', '@patstore/octane-pages-plugin'],
});
