import { defineConfig } from 'tsup';

export default defineConfig({
	entry: ['src/index.ts'],
	format: ['esm'],
	dts: true,
	clean: true,
	sourcemap: true,
	external: ['vite', '@patstore/core', 'graphql', 'graphql-request'],
});
