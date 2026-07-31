import { graphqlFind, graphqlGet, resolveFileUrl } from '../client/patstore-client.js';
import { loadModuleRegistry as ensureRegistry } from '../module-registry.js';
import { planCacheKey } from '../planner/execution-plan.js';
import { queryPlanner } from '../planner/query-planner.js';
import { createCacheResource } from './cache-resource.js';
import type {
	DeferredResource,
	ExecutionPlan,
	ExecutionStep,
	PatStoreObject,
	PlanResult,
	QuerySpec,
} from '../types.js';

function resolveFileFields<T extends PatStoreObject>(
	records: T | T[],
	fileFields: string[],
): T | T[] {
	const mapRecord = (record: T): T => {
		const next = { ...record };
		for (const field of fileFields) {
			const value = (next as PatStoreObject)[field];
			if (value && typeof value === 'object' && 'url' in value) {
				const file = value as { name?: string; url: string };
				(next as PatStoreObject)[field] = {
					...file,
					url: resolveFileUrl(file.url),
				};
			}
		}
		return next;
	};

	return Array.isArray(records) ? records.map(mapRecord) : mapRecord(records);
}

async function runStep(
	step: ExecutionStep,
	stepResults: Map<string, unknown>,
): Promise<unknown> {
	switch (step.kind) {
		case 'load-modules':
			await ensureRegistry();
			return null;

		case 'graphql-find':
			return graphqlFind(
				step.className,
				step.collectionKey,
				step.selection,
				step.variables,
			);

		case 'graphql-get': {
			const record = await graphqlGet(step.className, step.objectId, step.selection);
			return record;
		}

		case 'resolve-files': {
			const source = stepResults.get(step.sourceStepId);
			if (!source) {
				throw new Error(`Missing source step "${step.sourceStepId}" for file resolution`);
			}
			return resolveFileFields(source as PatStoreObject | PatStoreObject[], step.fileFields);
		}

		default:
			return null;
	}
}

async function executePlan(plan: ExecutionPlan): Promise<unknown> {
	const stepResults = new Map<string, unknown>();

	for (const step of plan.steps) {
		const result = await runStep(step, stepResults);
		stepResults.set(step.id, result);
	}

	return stepResults.get(plan.resultStepId);
}

/**
 * Resource Manager — turns an {@link ExecutionPlan} into a cache-aware
 * {@link DeferredResource} that components can await via `use()`.
 */
export class ResourceManager {
	plan(spec: QuerySpec): Promise<ExecutionPlan> {
		return queryPlanner.compile(spec);
	}

	acquire<T = unknown>(plan: ExecutionPlan): DeferredResource<T> {
		const key = planCacheKey(plan);
		return createCacheResource<T>(key, () => executePlan(plan) as Promise<T>);
	}

	async load<T = unknown>(spec: QuerySpec): Promise<PlanResult<T>> {
		const plan = await this.plan(spec);
		const resource = this.acquire<T>(plan);
		const data = await resource.toPromise();
		return { plan, data };
	}
}

export const resourceManager = new ResourceManager();

/** Convenience: compile spec → plan → deferred resource in one call. */
export async function createPatStoreResource<T = unknown>(
	spec: QuerySpec,
): Promise<DeferredResource<T>> {
	const plan = await queryPlanner.compile(spec);
	return resourceManager.acquire<T>(plan);
}
