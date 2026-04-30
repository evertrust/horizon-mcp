---
name: setup-digicert
description: "Walks the user through end-to-end setup of a DigiCert CertCentral integration on a live Horizon CLM instance, asking for every prerequisite up front and verifying state at every step using the horizon MCP tools. Triggers: setup:digicert, /setup-digicert, set up DigiCert, configure DigiCert CertCentral."
when_to_use: "User wants to integrate DigiCert CertCentral with Horizon as a public PKI source, or asks to configure the DigiCert PKI connector."
version: 0.1.0
requires_mcp:
  - horizon
tags:
  - setup:digicert
  - /setup-digicert
  - set up DigiCert
  - configure DigiCert CertCentral
---

This skill walks the user through configuring a DigiCert CertCentral integration on a live Evertrust Horizon CLM instance. The full procedural recipe lives in `references/recipe.md`. The exhaustive prerequisite list lives in `references/prerequisites.yaml`. Symptom and fix table lives in `references/troubleshooting.md`. Read all three before producing guidance.

Object names in Horizon are immutable primary keys. Always ask the user for both `name` and `display_name`. All HCQL field names are lowercase.

## Phase 0 - Preflight (MANDATORY)

Follow `skills/_shared/preflight-template.md`. For this skill, the required modules check is `webra` in `licensedModules`. The required knowledge resources are `horizon://knowledge/digicert-integration`, `horizon://knowledge/profiles`, and `horizon://knowledge/integrations`.

If preflight fails on any step, STOP and report the gap to the user. Do not advance.

## Phase 1 - External MCP / Skill / Knowledge Discovery

Run the regex `^mcp__.*digicert.*` (case-insensitive) against the names of every MCP tool exposed in the session. Record matching names in `discoveredCapabilities`.

If a DigiCert MCP is found, mention it to the user and ask whether to use it for any Phase 3 step (organization lookup, domain validation status, API key generation). If no hit, fall back to the embedded recipe in `references/recipe.md`.

## Phase 2 - Prerequisites (HARD GATE)

Drive `AskUserQuestion` (or the host equivalent in `skills/_shared/host-primitives.md`) from `references/prerequisites.yaml`. Group the questions in this order:

1. Region gate: `CERTCENTRAL_REGION`. Once the user picks, set `CERTCENTRAL_BASE_URL` deterministically to the matching URL and confirm before continuing.
2. CertCentral identifiers: `DIGICERT_ORG_ID`, `VALIDATED_DOMAINS`, `DIGICERT_PRODUCT_ID`.
3. Sensitive material: `DIGICERT_API_KEY`. Mark sensitive and never echo back.
4. Horizon object names: `API_TOKEN_CREDENTIAL_NAME`, `API_TOKEN_CREDENTIAL_DISPLAY_NAME`, `DIGICERT_CONNECTOR_NAME`, `DIGICERT_CONNECTOR_DISPLAY_NAME`, `PROFILE_NAME`.
5. Optional connector tuning: `PROXY_URL`, `RETRY_INTERVAL_SECONDS`, `TIMEOUT_SECONDS`, `SKIP_APPROVAL`, `CA_CERT_ID`, `QUEUE_ENABLED`, `CUSTOM_CONNECTOR_DATA_MAPPING`.

Refuse to advance to Phase 3 until every required value is captured.

## Phase 3 - External System Setup

Walk `references/recipe.md` section "External system setup steps" verbatim. After every numbered step, ask "Confirm step <N> complete? (yes/no)". Do not advance on anything but `yes`. Sensitive prerequisites (API key) are never echoed back; print `<DIGICERT_API_KEY>` instead.

If `discoveredCapabilities` from Phase 1 includes a DigiCert MCP that can perform a step, propose using it (with the standard mutating-tool confirmation prompt) before falling back to the manual instruction.

## Phase 4 - Horizon Configuration

Walk `references/recipe.md` section "Horizon setup steps" verbatim. For each step:

1. Run the matching read tool to detect existing objects by name (`list_credentials` for credentials, `get_profile` for profiles). For PKI connectors there is currently no MCP read tool; ask the user to confirm from the UI whether the named object already exists.
2. If the object exists, ask `reuse / rename / abort`.
3. If creating a new object, print the exact UI navigation text from the recipe with the resolved values inserted. Sensitive fields print `<KEY_NAME>` not the value.
4. After the user reports the create complete, re-run the read tool and confirm the object is present.

## Phase 5 - End-to-End Test

Run the verification calls in `references/recipe.md` section "Verification" in order:

1. `get_profile` against `PROFILE_NAME`.
2. `get_request_template` against `PROFILE_NAME` with `workflow: enroll`.
3. `submit_request` (mutating, gate behind confirmation) using only the fields returned by step 2 with at least one SAN drawn from `VALIDATED_DOMAINS`.
4. `search_certificates` with the HCQL `metadata.digicert_id exists and profile equals "<PROFILE_NAME>"`.

If any step fails, jump to Phase 6.

## Phase 6 - Troubleshooting

Use `references/troubleshooting.md` to map symptoms to fixes.

## Missing MCP Tools

These tools would automate steps that today require a UI walk:

- `create_credential`: create the API Token credential without leaving chat.
- `list_pki_connectors`, `get_pki_connector`, `create_pki_connector`: enumerate, fetch, and create the DigiCert PKI connector.
- `create_profile`, `update_profile`: bind the new connector to a profile.
