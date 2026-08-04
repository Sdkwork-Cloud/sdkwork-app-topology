# ADR-20260721 Topology-Declared Access Endpoints

Status: accepted
Requirement: REQ-2026-0001
Owner: SDKWork maintainers
Date: 2026-07-21
Specs: APP_RUNTIME_TOPOLOGY_SPEC.md, ARCHITECTURE_DECISION_SPEC.md

## Context

`@sdkwork/app-topology/network-access` standardized interface discovery and URL
formatting, but applications still selected the advertised bind themselves.
That split allowed an application API ingress to be presented as a Portal URL
after the ingress process stopped serving UI content.

## Decision

Topology v5 orchestration profiles may declare additive `accessEndpoints`.
Each declaration references one existing process or surface, supplies a typed
kind and absolute path, and may be selected by runtime target and client
architecture. The resolved runtime plan owns the effective URL, listener bind,
and unique primary endpoint. Framework access projection owns local/LAN URL
formatting. Application hooks consume the resolved plan and may append only
product-specific diagnostics.

## Alternatives

- Continue application-local bind selection: rejected because runtime topology
  and displayed access URLs can drift independently.
- Infer the UI from `role: client`: rejected because desktop, native, build-only,
  and multi-client processes do not all expose an HTTP page.
- Treat `application.public-ingress` as the UI: rejected because the canonical
  application ingress may be API-only.
- Add another standalone access manifest: rejected because topology is already
  the runtime process and surface authority.

## Consequences

- Runtime plans gain optional `accessEndpoints` and `primaryAccessEndpoint`
  fields without changing schema major version.
- Declaring applications must keep endpoint references aligned with process and
  surface ownership.
- Applications without endpoint declarations remain compatible but receive no
  inferred access URL from this capability.
- Shared validation and tests replace duplicated application heuristics.

## Verification

- Canonical and bundled topology schemas remain byte-structure equivalent.
- Framework tests cover references, selection, environment overrides, primary
  uniqueness, wildcard projection, and formatting.
- Cloud Router topology and startup-output tests prove that UI resolves to 3901
  while API reference resolves to 3900 `/openapi.json`.

## Supersedes / Superseded By

None.
