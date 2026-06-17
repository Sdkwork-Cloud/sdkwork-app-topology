# Repository Guidelines

<!-- SDKWORK-AGENTS-GENERATED: v1 -->

## SDKWORK Soul

Read `../sdkwork-specs/SOUL.md` before executing tasks in this repository.

## Purpose

`@sdkwork/app-topology` is the shared SDKWork framework for deployment topology standards, profile env loading, IAM database helpers, gateway bind resolution, and packaging matrix contracts.

Applications such as `sdkwork-drive` depend on this repository through:

```json
"@sdkwork/app-topology": "file:../sdkwork-app-topology"
```

## Local Dictionary

- `README.md` — framework overview and integration steps
- `docs/topology-standard.md` — normative cross-app standard
- `docs/adoption-guide.md` — migration guide for product repos
- `tools/topology/lib/` — importable library
- `scripts/sdkwork-topology.mjs` — CLI (`init-app`, `validate`, `scaffold-profiles`, `print-matrix`)
- `specs/topology.schema.json` — JSON Schema for app specs
- `examples/sdkwork-drive/` — reference topology spec

## Verification

```bash
pnpm test
pnpm run validate:example
```

## Human Review Rules

Request human review before changing the public vocabulary (`topology`, `profile`), JSON schema major version, or default inference rules used by multiple applications.
