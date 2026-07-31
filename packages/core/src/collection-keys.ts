/** GraphQL collection keys — mirrors PatStore / SASHIDO naming. */
const COLLECTION_KEYS: Record<string, string> = {
	Article: 'articles',
	Event: 'events',
	Entry: 'entries',
	Category: 'categories',
	Person: 'people',
	Image: 'images',
	Group: 'groups',
	Download: 'downloads',
	Form: 'forms',
	Email: 'emails',
	Calendar: 'calendars',
	User: 'users',
	Video: 'videos',
	Location: 'locations',
	Dates: 'dates',
	TrainingGroup: 'trainingGroups',
	Webpage: 'webpages',
	Module: 'modules',
};

export function getCollectionKey(className: string): string {
	return COLLECTION_KEYS[className] ?? `${className.charAt(0).toLowerCase()}${className.slice(1)}s`;
}

export function getStorageKey(className: string): string {
	return getCollectionKey(className);
}
