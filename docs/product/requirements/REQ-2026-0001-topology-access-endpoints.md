# REQ-2026-0001 Topology-Declared Access Endpoints

id: REQ-2026-0001
title: Resolve development access URLs from topology declarations
owner: SDKWork maintainers
status: accepted
source: platform

## Problem

Application launchers can currently format network URLs through the shared
framework, but they still decide locally which bind represents the user-facing
application. After runtime topology changes, this can publish a healthy API
ingress root as a browser UI URL.

## Goals

- Make the resolved runtime plan the authority for user-interface and developer
  access endpoints.
- Resolve endpoint URLs from existing process binds or topology surfaces.
- Provide one framework implementation for loopback and LAN URL projection.
- Reject invalid references and multiple selected primary endpoints.

## Non-Goals

- Inferring UI ownership from a port number, process id, or process role.
- Requiring applications without declared access endpoints to migrate in this
  additive change.
- Replacing product-specific API route diagnostics or readiness policy.

## Users

- SDKWork application developers and operators.
- Application lifecycle adapters using `@sdkwork/app-topology`.

## Acceptance Criteria

- Topology v5 profiles may declare typed `accessEndpoints` referencing a
  `processId` or `surfaceId`.
- Runtime plans resolve selected endpoint URLs after runtime-target and client-
  architecture filtering.
- Process endpoints require a declared `bindEnv`; surface endpoints resolve
  through the canonical surface URL/bind contract.
- More than one selected primary endpoint fails before publishing access URLs.
- Framework formatting publishes deterministic local and LAN URLs from the
  resolved primary endpoint.
- Claw Router declares its Portal renderer as primary and its public-ingress
  OpenAPI document as an API-reference endpoint, with no local port inference.

## Non-Functional Requirements

- Security: loopback-only listeners must not advertise LAN URLs.
- Privacy: none beyond root standards.
- Performance: endpoint resolution must remain synchronous and bounded by the
  number of declared endpoints and network interfaces.
- Reliability: applications without `accessEndpoints` retain existing plans.

## Trace

- Specs: `APP_RUNTIME_TOPOLOGY_SPEC.md`, `TEST_SPEC.md`.
- Components: `@sdkwork/app-topology`, `sdkwork-clawrouter`.
- Decision: `ADR-20260721-topology-declared-access-endpoints.md`.

## Verification

- `pnpm test` in `sdkwork-app-topology`.
- `pnpm exec sdkwork-topology validate --root .` in `sdkwork-clawrouter`.
- Claw Router network-access and topology contract tests.
