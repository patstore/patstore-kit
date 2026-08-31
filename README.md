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

## Consumer setup

Add a **`.npmrc`** in the root of each Vite/Octane site that installs `@patstore/*` (next to that site's `package.json`). Copy from `.npmrc.example`:

```ini
@patstore:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=${GITHUB_TOKEN}
```

Set a GitHub token with `read:packages` (and `repo` if packages are private) before installing:

```bash
# PowerShell
$env:GITHUB_TOKEN = "ghp_..."

# bash
export GITHUB_TOKEN=ghp_...
```

Do **not** commit tokens. Using `${GITHUB_TOKEN}` in `.npmrc` is safe to commit; inject the value via env var or CI secrets.

**GitHub Actions** in the site repo — same `.npmrc`, then:

```yaml
env:
  GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

For local monorepo dev with `file:../patstore-kit/...` links, skip this until you pull from GitHub Packages.

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
import type { PatstoreArticle } from '@cms';

const articles = fetchPatStoreCollection('Article', { limit: 6 });
// articles: Promise<PatstoreArticle[]>  (after SSG generates data/types)
// switch: { source: 'dynamic' }
```

Generated `Patstore{ClassName}` record types live in `data/types` and are imported from `@cms`. `@data` still exports the static accessors.
