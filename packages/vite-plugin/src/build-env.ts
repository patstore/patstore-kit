export interface PatStoreBuildEnv {
	apiUrl: string;
	graphqlUrl: string;
	appId: string;
	projectId: string;
	masterKey?: string;
	restKey?: string;
	fileUrl: string;
}

export function readPatStoreBuildEnv(
	env: Record<string, string | undefined>,
): PatStoreBuildEnv | null {
	const apiUrl = env.VITE_PATSTORE_API_URL;
	const graphqlUrl = env.VITE_PATSTORE_GRAPHQL_API_URL;
	const appId = env.VITE_PATSTORE_APP_ID;
	const projectId = env.VITE_PATSTORE_PROJECT_ID;
	const fileUrl = env.VITE_PATSTORE_FILE_URL ?? '';

	if (!apiUrl || !graphqlUrl || !appId || !projectId) {
		return null;
	}

	const masterKey = env.PATSTORE_MASTER_KEY ?? env.VITE_PATSTORE_MASTER_KEY;
	const restKey = env.VITE_PATSTORE_REST_KEY;

	if (!masterKey && !restKey) {
		return null;
	}

	return {
		apiUrl,
		graphqlUrl,
		appId,
		projectId,
		masterKey,
		restKey,
		fileUrl,
	};
}

export function buildAuthHeaders(env: PatStoreBuildEnv): Record<string, string> {
	const headers: Record<string, string> = {
		'X-Parse-Application-Id': env.appId,
	};

	if (env.masterKey) {
		headers['X-Parse-Master-Key'] = env.masterKey;
	} else if (env.restKey) {
		headers['X-Parse-Rest-Api-Key'] = env.restKey;
	}

	return headers;
}

export function isSsgEnabled(env: Record<string, string | undefined>): boolean {
	return env.VITE_PATSTORE_SSG !== 'false';
}
