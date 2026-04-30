---
name: setup-intune
description: "Walks the user through end-to-end setup of a Microsoft Intune integration on a live Horizon CLM instance covering both intune (SCEP) and intunepkcs variants, asking for every prerequisite up front and verifying state at every step. Triggers: setup:intune, /setup-intune, set up Intune, configure Intune SCEP, configure Intune PKCS, MDM Intune."
when_to_use: "User wants to integrate Microsoft Intune (SCEP or PKCS) with Horizon to issue certificates to managed devices, or asks to configure the Intune connector and profile."
version: 0.1.0
requires_mcp:
  - horizon
tags:
  - setup:intune
  - /setup-intune
  - set up Intune
  - configure Intune SCEP
  - configure Intune PKCS
  - MDM Intune
---

This skill walks the user through configuring a Microsoft Intune integration on a live Evertrust Horizon CLM instance. The full procedural recipe lives in `references/recipe.md`. The exhaustive prerequisite list lives in `references/prerequisites.yaml`. Symptom and fix table lives in `references/troubleshooting.md`. Read all three before producing guidance.

Object names in Horizon are immutable primary keys. Always ask the user for both `name` and `display_name`. All HCQL field names are lowercase. From Horizon 2.9.0 onward the third-party connector field is `azureTenant`, not `tenant`.

## Phase 0 - Preflight (MANDATORY)

Follow `skills/_shared/preflight-template.md`. For this skill, the required modules check is `webra` AND one of `intune` or `intunepkcs` (depending on the variant) in `licensedModules`. The required knowledge resources are `horizon://knowledge/intune-integration`, `horizon://knowledge/integrations`, `horizon://knowledge/automation`, and `horizon://knowledge/profiles`.

If preflight fails on any step, STOP and report the gap to the user. Do not advance.

## Phase 1 - External MCP / Skill / Knowledge Discovery

Run the regex `^mcp__.*(microsoft|graph|entra|azure|m365|intune).*` (case-insensitive) against the names of every MCP tool exposed in the session. Record matching names in `discoveredCapabilities`.

If a Microsoft Graph, Entra, or Azure MCP is found, mention it to the user and propose using it for any Phase 3 step (App Registration creation, client secret rotation, API permission grant, Trusted certificate profile creation, SCEP profile creation). If no hit, fall back to the embedded recipe.

## Phase 2 - Prerequisites (HARD GATE)

Drive `AskUserQuestion` (or the host equivalent) from `references/prerequisites.yaml`. Group the questions in this order:

1. Variant gate: `INTUNE_VARIANT`.
2. Platform: `TARGET_PLATFORM`.
3. Azure: `TENANT_DIRECTORY_ID`, `APP_REGISTRATION_NAME`, `APP_CLIENT_ID`, `APP_CLIENT_SECRET`, `APP_CLIENT_SECRET_EXPIRY_DATE`, `INTUNE_GROUP`.
4. Trust chain: `ROOT_CA_DER` (path or base64).
5. Underlying PKI: `SCEP_RA_PROFILE_NAME`, `UNDERLYING_PKI_CONNECTOR`, `EXPECTED_EKU`, `TEMPLATE_BACKDATE_MINUTES`.
6. Horizon endpoint: `HORIZON_URL`.
7. Horizon object names: `INTUNE_CONNECTOR_NAME`, `INTUNE_CONNECTOR_DISPLAY_NAME`, `INTUNE_PROFILE_NAME`, `INTUNE_PROFILE_DISPLAY_NAME`, `MDM_CREDENTIAL_NAME`, `MDM_CREDENTIAL_DISPLAY_NAME`, `SCEP_RA_CREDENTIAL_NAME`, `SCEP_RA_CREDENTIAL_DISPLAY_NAME`.
8. Connector tuning: `THROTTLE_DURATION`, `THROTTLE_PARALLELISM`.
9. Variant-conditional: when `INTUNE_VARIANT` is `intune`, ask `LEGACY_REVOCATION_MODE`. When it is `intunepkcs`, ask `PUB_KEY` and `KEY_NAME`.

Refuse to advance to Phase 3 until every required value is captured. Sensitive prerequisites (`APP_CLIENT_ID`, `APP_CLIENT_SECRET`) are never echoed back; print `<KEY_NAME>` instead.

## Phase 3 - External System Setup

Walk `references/recipe.md` section "External system setup steps" verbatim. After every numbered step, ask "Confirm step <N> complete? (yes/no)". Do not advance on anything but `yes`.

If `discoveredCapabilities` from Phase 1 includes a Microsoft Graph, Entra, or Azure MCP, propose using it (with the standard mutating-tool confirmation prompt) before falling back to the manual instruction.

## Phase 4 - Horizon Configuration

Walk `references/recipe.md` section "Horizon setup steps" verbatim. For each step:

1. Run the matching read tool to detect existing objects by name (`list_credentials` for credentials, `get_profile` for profiles). For PKI connectors, third-party connectors, and certification authorities there is currently no MCP read tool; ask the user to confirm from the UI whether the named object already exists.
2. If the object exists, ask `reuse / rename / abort`.
3. If creating a new object, print the exact UI navigation text from the recipe with the resolved values inserted. Sensitive fields print `<KEY_NAME>` not the value.
4. After the user reports the create complete, re-run the read tool and confirm the object is present.

The mutating MCP tool used in this skill is `submit_request` (Horizon setup step 2). Gate it behind the confirmation pattern in `skills/_shared/host-primitives.md`.

## Phase 5 - End-to-End Test

Run the verification calls in `references/recipe.md` section "Verification" in order:

1. `get_profile` against `INTUNE_PROFILE_NAME`.
2. `list_credentials` filtered on each credential name.
3. After at least one device has checked in via Company Portal or platform sync, `search_events` with the HCQL `type equals "lifecycle-enroll" and profile equals "<INTUNE_PROFILE_NAME>"`.
4. Optional `fetch_exposed_certificate` against an enrolled device endpoint when reachable.

If any step fails, jump to Phase 6.

## Phase 6 - Troubleshooting

Use `references/troubleshooting.md` to map symptoms to fixes.

## Missing MCP Tools

These tools would automate steps that today require a UI walk:

- `create_credential`: create both the SCEP RA PKCS#12 credential and the MDM login credential.
- `list_pki_connectors`, `get_pki_connector`, `create_pki_connector`: configure the underlying issuing connector without leaving chat.
- `list_third_party_connectors`, `get_third_party_connector`, `create_third_party_connector`: create the Intune (or Intune PKCS) connector.
- `create_profile`, `update_profile`: create the Horizon Intune profile.
- `import_certificate_chain`: import the root and intermediate CAs in one call.
