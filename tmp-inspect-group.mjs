import fs from 'node:fs';
import { GraphQLClient } from 'file:///C:/Users/phanke/GitHub/patstore_tvstg/node_modules/graphql-request/build/entrypoints/main.js';

const env = Object.fromEntries(
	fs
		.readFileSync('C:/Users/phanke/GitHub/patstore_tvstg/.env', 'utf8')
		.split(/\r?\n/)
		.filter((line) => line && !line.startsWith('#') && line.includes('='))
		.map((line) => {
			const index = line.indexOf('=');
			return [line.slice(0, index), line.slice(index + 1).replace(/^['"]|['"]$/g, '')];
		}),
);

const headers = { 'X-Parse-Application-Id': env.VITE_PATSTORE_APP_ID };
const key = env.PATSTORE_MASTER_KEY || env.VITE_PATSTORE_MASTER_KEY;
const rest = env.VITE_PATSTORE_REST_KEY;
if (key) headers['X-Parse-Master-Key'] = key;
else if (rest) headers['X-Parse-Rest-Api-Key'] = rest;

const client = new GraphQLClient(env.VITE_PATSTORE_GRAPHQL_API_URL, { headers });
const data = await client.request(
	`
  query ($params: GroupWhereInput) {
    groups(where: $params, first: 1) {
      edges {
        node {
          objectId
          team
          persons { ... on Element { value } }
        }
      }
    }
  }
`,
	{
		params: {
			project: { have: { objectId: { equalTo: env.VITE_PATSTORE_PROJECT_ID } } },
		},
	},
);

const node = data.groups.edges[0]?.node;
function describe(value) {
	if (Array.isArray(value)) return `array(${value.length}) ${JSON.stringify(value.slice(0, 1)).slice(0, 400)}`;
	return typeof value;
}
console.log('persons', describe(node?.persons));
console.log('team', describe(node?.team));
