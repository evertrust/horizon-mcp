---
name: setup-adcs
description: "Walks the user through end-to-end setup of a Microsoft ADCS integration on a live Horizon CLM instance, asking for every prerequisite up front and verifying state at every step using the horizon MCP tools. Triggers: setup:adcs, /setup-adcs, set up ADCS, configure ADCS connector, Microsoft ADCS integration."
when_to_use: "User wants to integrate a Microsoft Active Directory Certificate Services (ADCS) instance with Horizon and starts from a blank or vanilla state, or asks to configure an ADCS PKI connector."
version: 0.1.0
requires_mcp:
  - horizon
tags:
  - setup:adcs
  - /setup-adcs
  - set up ADCS
  - configure ADCS connector
  - Microsoft ADCS integration
---

This skill walks the user through configuring a Microsoft ADCS integration on a live Evertrust Horizon CLM instance. The full procedural recipe lives in `references/recipe.md`. The exhaustive prerequisite list lives in `references/prerequisites.yaml`. Symptom and fix table lives in `references/troubleshooting.md`. Read all three before producing guidance.

Object names in Horizon are immutable primary keys. Never invent a name. Always ask the user for both `name` and `display_name`. All HCQL field names are lowercase.

## Phase 0 - Preflight (MANDATORY)

Follow `skills/_shared/preflight-template.md`. For this skill, the required modules check is `webra` in `licensedModules`. The required knowledge resources are `horizon://knowledge/adcs-integration`, `horizon://knowledge/profiles`, and `horizon://knowledge/architecture`.

If preflight fails on any step, STOP and report the gap to the user. Do not advance.

## Phase 1 - External MCP / Skill / Knowledge Discovery

Run the regex `^mcp__.*(microsoft|adcs|active.?directory|windows.?server).*` (case-insensitive) against the names of every MCP tool currently exposed in the session. Record matching names in `discoveredCapabilities`.

If a Microsoft / ADCS MCP is found, mention it to the user and ask whether to use it for any Phase 3 step (template permission grant, technical account creation, etc.). If no hit, fall back to the embedded recipe in `references/recipe.md`. Do NOT pretend a capability exists.

## Phase 2 - Prerequisites (HARD GATE)

Drive `AskUserQuestion` (or the host equivalent in `skills/_shared/host-primitives.md`) from `references/prerequisites.yaml`. Group the questions in this order so the user can pause without losing context:

1. Variant choice: `ADCS_VARIANT`.
2. ADCS topology: `AD_NETBIOS_NAME`, `ADCS_CONNECTOR_URL`, `ADCS_CERTIFICATE_TEMPLATE`, `ADCS_CA_CONFIG` (skip the NetBIOS / CA Config questions when `ADCS_VARIANT` is `msadcs`).
3. Trust material: `ISSUING_CA_PEM`, `CRLDP_URL`, `HORIZON_CRL_FALLBACK_POLICY`.
4. Sensitive material: `ADCS_ENROLLMENT_AGENT_P12`, `ADCS_ENROLLMENT_AGENT_PASSPHRASE`, `ADCS_TECHNICAL_ACCOUNT_LOGIN`, `ADCS_TECHNICAL_ACCOUNT_PASSWORD`. Mark these `sensitive` and never echo them back.
5. Horizon object names: `ADCS_ENROLLMENT_AGENT_P12_NAME`, `ADCS_ENROLLMENT_AGENT_P12_DISPLAY_NAME`, `ADCS_TECHNICAL_ACCOUNT_LOGIN_NAME`, `ADCS_TECHNICAL_ACCOUNT_LOGIN_DISPLAY_NAME`, `PKI_CONNECTOR_NAME`, `PKI_CONNECTOR_DISPLAY_NAME`, `PROFILE_NAME`.

Refuse to advance to Phase 3 until every required value is captured. For sensitive prerequisites, accept the value but never print it back; print `<KEY_NAME>` instead.

## Phase 3 - External System Setup

Walk `references/recipe.md` section "External system setup steps" verbatim. After every numbered step, ask "Confirm step <N> complete? (yes/no)". Do not advance on anything but a `yes`.

If `discoveredCapabilities` from Phase 1 includes a Microsoft / ADCS MCP that can perform a step, propose using it (with the standard mutating-tool confirmation prompt) before falling back to the manual instruction.

## Phase 4 - Horizon Configuration

Walk `references/recipe.md` section "Horizon setup steps" verbatim. For each step:

1. Run the matching read tool to detect existing objects by name (`list_credentials` for credentials, `get_profile` for profiles). For PKI connectors and certification authorities there is currently no MCP read tool; ask the user to confirm from the UI whether the named object already exists.
2. If the object already exists, ask `reuse / rename / abort` and act on the answer. Reuse means skipping the create. Rename means going back to Phase 2 to capture a new name.
3. If creating a new object, print the exact UI navigation text from the recipe with the resolved values inserted. For sensitive fields print `<KEY_NAME>` not the value.
4. After the user reports the create complete, re-run the read tool and confirm the object is present.

The skill never calls a mutating MCP tool in Phase 4 unless the host explicitly maps a Horizon UI action to one of the available mutating tools (currently none for credentials, PKI connectors, profiles, or certification authorities). When a mutating tool IS called, gate it behind the confirmation pattern in `skills/_shared/host-primitives.md`.

## Phase 5 - End-to-End Test

Run the verification calls in `references/recipe.md` section "Verification" in order:

1. `get_profile` against `PROFILE_NAME`.
2. `get_request_template` against `PROFILE_NAME` with `workflow: enroll`.
3. `submit_request` (mutating, gate behind confirmation) using only the fields returned by step 2.
4. `search_certificates` with the HCQL `module equals "webra" and profile equals "<PROFILE_NAME>"`.
5. `decode_x509` on the issued certificate.

If any step fails, jump to Phase 6.

## Phase 6 - Troubleshooting

Use `references/troubleshooting.md` to map symptoms to fixes.

## Missing MCP Tools

These tools would automate steps that today require a UI walk. They are listed in `skills/_shared/tool-gap-signaling.md`:

- `create_credential`: create a Horizon credential of type login or certificate-pkcs12 and assign its target.
- `list_pki_connectors`, `get_pki_connector`, `create_pki_connector`: enumerate, fetch, and create the ADCS PKI connector without leaving the chat.
- `create_certification_authority`, `list_certification_authorities`: import the issuing CA, set CRL URL and Trust for Server Authentication.
- `create_profile`, `update_profile`: bind the new connector to a profile.
