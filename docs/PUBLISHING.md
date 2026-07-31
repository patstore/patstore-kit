# Publishing to GitHub Packages

Scope: **`@patstore`** (GitHub org [patstore](https://github.com/patstore))

## Packages

- `@patstore/core`
- `@patstore/vite-plugin`

## Site `.npmrc`

Create `.npmrc` in each consuming site (do **not** commit tokens):

```ini
@patstore:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=${GITHUB_TOKEN}
```

For local dev with `file:../patstore-kit/...` links, skip this until publishing.

## GitHub repo

1. Repo: [patstore/patstore-kit](https://github.com/patstore/patstore-kit)
2. Tag `v0.1.0` → CI publishes both packages

## Publish manually

```bash
cd patstore-kit
npx pnpm install
npx pnpm build
npm login --registry=https://npm.pkg.github.com
npx pnpm -r publish --no-git-checks
```

## Install in sites

```bash
npm install @patstore/core @patstore/vite-plugin
```

Pin versions in `package.json` and bump when the kit releases.
