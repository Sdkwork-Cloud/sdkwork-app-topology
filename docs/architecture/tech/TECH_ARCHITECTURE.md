# App Topology Technical Architecture

Status: active
Owner: SDKWork maintainers
Updated: 2026-07-30
Specs: APP_RUNTIME_TOPOLOGY_SPEC.md, ARCHITECTURE_DECISION_SPEC.md, DOCUMENTATION_SPEC.md

## Document Map

- [TECH-adoption-guide.md](TECH-adoption-guide.md)
- [TECH-topology-standard.md](TECH-topology-standard.md)

## 1. Architecture Overview

Architecture detail lives in the linked TECH shards below.


## 2. Technology Choices

## 3. System Boundaries And Modules

## 4. Directory And Package Layout

## 5. API, SDK, And Data Ownership

## 6. Security, Privacy, And Observability

## 7. Deployment And Runtime Topology

Development process ownership uses `tools/topology/lib/runtime-state.mjs`. Session registries are
stored outside source checkouts in a private OS user/runner runtime directory keyed by the canonical
repository real-path hash; tool-native build caches remain owned by their build tools.

## 8. Architecture Decision Index

- [ADR-20260721 Topology-Declared Access Endpoints](../decisions/ADR-20260721-topology-declared-access-endpoints.md)

## 9. Verification
