import { randomUUID } from '../utils/id.js';
import { readPatStoreEnv } from '../env.js';
import { getModuleCollectionKey, getModuleForClass, loadModuleRegistry } from '../module-registry.js';
import { buildSelectionFromModule, defaultProjectFilter, listFileFields } from './field-selection.js';
import type { ExecutionPlan, ExecutionStep, QuerySpec } from '../types.js';

/**
 * Query Planner — compiles a component's {@link QuerySpec} plus PatStore Module
 * metadata into an agnostic {@link ExecutionPlan} (no Promises).
 */
export class QueryPlanner {
	async compile(spec: QuerySpec): Promise<ExecutionPlan> {
		await loadModuleRegistry();

		const module = getModuleForClass(spec.className);
		if (!module) {
			throw new Error(`No PatStore Module registered for class "${spec.className}"`);
		}

		const env = readPatStoreEnv();
		const collectionKey = getModuleCollectionKey(spec.className);
		const selection = buildSelectionFromModule(module, spec.fields ?? []);
		const fileFields = listFileFields(module);

		const steps: ExecutionStep[] = [
			{ id: 'modules', kind: 'load-modules' },
		];

		let resultStepId: string;

		if (spec.mode === 'get') {
			if (!spec.objectId) {
				throw new Error('QuerySpec.objectId is required for mode "get"');
			}

			resultStepId = 'get-object';
			steps.push({
				id: resultStepId,
				kind: 'graphql-get',
				className: spec.className,
				objectId: spec.objectId,
				selection,
			});
		} else {
			resultStepId = 'find-collection';
			const params = {
				...defaultProjectFilter(env.PROJECT_ID),
				...(spec.where ?? {}),
			};

			steps.push({
				id: resultStepId,
				kind: 'graphql-find',
				className: spec.className,
				collectionKey,
				selection,
				variables: {
					params,
					first: spec.limit ?? 100,
					skip: spec.skip ?? 0,
					order: spec.order ?? ['createdAt_DESC'],
				},
			});
		}

		if (fileFields.length > 0) {
			steps.push({
				id: 'resolve-files',
				kind: 'resolve-files',
				sourceStepId: resultStepId,
				fileFields,
			});
		}

		return {
			id: randomUUID(),
			spec,
			steps,
			resultStepId: fileFields.length > 0 ? 'resolve-files' : resultStepId,
		};
	}
}

export const queryPlanner = new QueryPlanner();
