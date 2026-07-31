import type { ExecutionPlan, ExecutionStep } from '../types.js';

/** Execution Plan helpers — stays transport-agnostic. */
export function describePlan(plan: ExecutionPlan): string {
	const stepKinds = plan.steps.map((step) => step.kind).join(' → ');
	return `[${plan.id}] ${plan.spec.mode}:${plan.spec.className} (${stepKinds})`;
}

export function getStep(plan: ExecutionPlan, stepId: string): ExecutionStep | undefined {
	return plan.steps.find((step) => step.id === stepId);
}

export function getResultStep(plan: ExecutionPlan): ExecutionStep {
	const step = getStep(plan, plan.resultStepId);
	if (!step) {
		throw new Error(`Result step "${plan.resultStepId}" not found in plan ${plan.id}`);
	}
	return step;
}

export function planCacheKey(plan: ExecutionPlan): string {
	return JSON.stringify({
		spec: plan.spec,
		steps: plan.steps.map((step) => ({ id: step.id, kind: step.kind })),
	});
}
