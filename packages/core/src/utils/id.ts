export function randomUUID(): string {
	if (typeof crypto !== 'undefined' && crypto.randomUUID) {
		return crypto.randomUUID();
	}
	return `plan-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}
