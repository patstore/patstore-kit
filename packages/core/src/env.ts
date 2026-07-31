/**
 * Runtime PatStore configuration exposed to the browser via Vite.
 * CLIENT_KEY is the dedicated browser credential (distinct from REST_KEY).
 */
export interface PatStoreClientEnv {
	API_URL: string;
	GRAPHQL_API_URL: string;
	APP_ID: string;
	REST_KEY: string;
	CLIENT_KEY: string;
	FILE_URL: string;
	PROJECT_ID: string;
}

function required(name: keyof PatStoreClientEnv, value: string | undefined): string {
	if (!value) {
		throw new Error(`Missing PatStore environment variable: VITE_PATSTORE_${name}`);
	}
	return value;
}

function optional(value: string | undefined): string {
	return value ?? '';
}

export function readPatStoreEnv(): PatStoreClientEnv {
	return {
		API_URL: required('API_URL', import.meta.env.VITE_PATSTORE_API_URL),
		GRAPHQL_API_URL: required(
			'GRAPHQL_API_URL',
			import.meta.env.VITE_PATSTORE_GRAPHQL_API_URL,
		),
		APP_ID: required('APP_ID', import.meta.env.VITE_PATSTORE_APP_ID),
		REST_KEY: optional(import.meta.env.VITE_PATSTORE_REST_KEY),
		CLIENT_KEY: required('CLIENT_KEY', import.meta.env.VITE_PATSTORE_CLIENT_KEY),
		FILE_URL: required('FILE_URL', import.meta.env.VITE_PATSTORE_FILE_URL),
		PROJECT_ID: required('PROJECT_ID', import.meta.env.VITE_PATSTORE_PROJECT_ID),
	};
}

export function isPatStoreConfigured(): boolean {
	return Boolean(
		import.meta.env.VITE_PATSTORE_GRAPHQL_API_URL &&
			import.meta.env.VITE_PATSTORE_APP_ID &&
			import.meta.env.VITE_PATSTORE_CLIENT_KEY &&
			import.meta.env.VITE_PATSTORE_PROJECT_ID,
	);
}
