# SDKWork Application Lifecycle And Topology Framework

repository-kind: foundation-dependency

`@sdkwork/app-topology` is the local lifecycle/runtime component of the
SDKWork application framework. Application roots keep declarations and thin
private hooks; shared selection, validation, planning, process orchestration,
package/release delegation, and deployment delegation live in framework
repositories.

## Framework Composition

| Component | Responsibility |
| --- | --- |
| `sdkwork-app-topology` | `sdkwork-app` public lifecycle facade, topology v5 validation, environment loading, resolved runtime plans, development orchestration |
| `sdkwork-github-workflow` | package matrix, lifecycle phases, signing, SBOM, publication, deployment matrix, reusable GitHub workflow |
| `sdkwork-specs/tools/deployctl.mjs` | typed deploy plans, artifact-evidence verification, nginx apply and rollback |

The global authorities remain:

- `../sdkwork-specs/PNPM_SCRIPT_SPEC.md`
- `../sdkwork-specs/APP_RUNTIME_TOPOLOGY_SPEC.md`
- `../sdkwork-specs/GITHUB_WORKFLOW_SPEC.md`
- `../sdkwork-specs/SDKWORK_DEPLOY_SPEC.md`

## Application Contract

Each deployable application root owns:

```text
sdkwork.app.config.json
package.json
specs/topology.spec.json
etc/topology/<deployment-profile>.<environment>.env
sdkwork.workflow.json                  # when packaged or published
deployments/deploy.yaml                # when deployed by deployctl
```

`package.json` exposes thin public aliases:

```json
{
  "scripts": {
    "dev": "pnpm dev:standalone",
    "dev:standalone": "pnpm exec sdkwork-app dev --deployment-profile standalone",
    "dev:cloud": "pnpm exec sdkwork-app dev --deployment-profile cloud",
    "stop": "pnpm exec sdkwork-app stop",
    "build": "pnpm exec sdkwork-app build",
    "test": "pnpm exec sdkwork-app test",
    "check": "pnpm exec sdkwork-app check",
    "verify": "pnpm exec sdkwork-app verify",
    "clean": "pnpm exec sdkwork-app clean"
  }
}
```

Application-specific implementation commands use the private `_sdkwork:*`
namespace, for example `_sdkwork:build` or `_sdkwork:dev:standalone`. They are
not public product commands. A topology process may instead declare `script`,
explicit `command` plus `args`, or a Cargo `crate`/`binary`; the framework
executes those declarations without a shell.
Processes may declare `runtimeTargets` when browser, desktop, mobile, or other
clients use different local commands. The resolved plan starts only processes
matching the selected `--runtime-target`.

## Topology V5

New and aligned applications use exactly two deployment profiles:

```text
standalone
cloud
```

Profile ids use exactly two segments:

```text
standalone.development
standalone.production
cloud.development
cloud.production
```

`cloud.development` starts local clients and explicit tunnels only. It consumes
deployed application/platform URLs and never starts gateways, API listeners,
databases, Redis, migrations, seeds, or deployed-service workers.

The bundled `specs/topology.schema.v5.json` is a synchronized distribution copy
of `../sdkwork-specs/schemas/sdkwork.app.topology.schema.v5.json`. V1, v2, and
v4 readers remain available only for migration.

## Commands

```bash
pnpm exec sdkwork-topology validate --root .
pnpm exec sdkwork-topology plan --root . --deployment-profile cloud --environment development --runtime-target browser
pnpm exec sdkwork-app doctor --root .
pnpm exec sdkwork-app dev --root . --deployment-profile standalone
pnpm exec sdkwork-app dev --root . --deployment-profile cloud
pnpm exec sdkwork-app stop --root .
```

Generic development writes a repository-scoped heartbeat registry under
`.runtime/sdkwork-app/development-session.json`. `stop` terminates only the
fresh registered supervisor. On Windows it uses `taskkill /T` for the full
owned process tree and falls back to the registered direct child PIDs plus the
supervisor when the operating-system process-tree service is unavailable.
`doctor` composes lifecycle facade, app-manifest, source-config, topology v5,
workflow, and deploy-manifest validation.

Release commands delegate to `sdkwork-github-workflow`; deploy commands
delegate to deployctl. Side-effecting operations retain the explicit profile,
environment, artifact id/digest/evidence, approval, and rollback target gates.
Non-workspace installations set `SDKWORK_APP_MANIFEST_CHECK_CLI`,
`SDKWORK_SOURCE_CONFIG_CHECK_CLI`, `SDKWORK_GITHUB_WORKFLOW_CLI`, and
`SDKWORK_DEPLOY_CLI` to the installed framework entrypoints; applications do
not hardcode a parent workspace layout.

## Verification

```bash
pnpm test
pnpm check
```

## Documentation Canon

- [docs/README.md](docs/README.md)
- [docs/product/prd/PRD.md](docs/product/prd/PRD.md)
- [docs/architecture/tech/TECH_ARCHITECTURE.md](docs/architecture/tech/TECH_ARCHITECTURE.md)
