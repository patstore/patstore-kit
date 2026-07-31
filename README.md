# PatStore Kit

Shared PatStore CMS packages for Vite/Octane sites.

## Packages

| Package | Description |
|---------|-------------|
| `@patstore/core` | Runtime GraphQL client, query planner, `fetchPatStore*` helpers |
| `@patstore/vite-plugin` | SSG build plugin — fetch, assets, incremental sync |

## Setup (monorepo)

```bash
pnpm install
pnpm build
```

## Publish to GitHub Packages

```bash
pnpm build
pnpm -r publish --access restricted
```

Tag `v*` on GitHub to publish via CI (see `docs/PUBLISHING.md`).

## Use in a site

```bash
npm install @patstore/core @patstore/vite-plugin
```

```ts
// vite.config.ts
import { patStorePlugin } from '@patstore/vite-plugin';

export default defineConfig({
  plugins: [patStorePlugin({ env }), octane()],
});
```

```ts
// src/cms/setup.ts — wire SSG data once at startup
import { configurePatStoreStaticData } from '@patstore/core';
import { findByObjectId, findStaticCollection, isStaticDataReady } from '@data';

configurePatStoreStaticData({ findStaticCollection, findByObjectId, isStaticDataReady });
```

```ts
// src/main.ts
import './cms/setup.ts';
// ...
```

```ts
import { fetchPatStoreCollection } from '@patstore/core';

const articles = fetchPatStoreCollection('Article', { limit: 6 });
// switch: { source: 'dynamic' }
```
