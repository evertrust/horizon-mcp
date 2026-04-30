---
name: setup-f5
description: "Walks the user through end-to-end setup of an F5 BIG-IP integration on a live Horizon CLM instance covering iControl REST role provisioning, lifecycle automation triggers, scheduled tasks, and discovery, asking for every prerequisite up front. Triggers: setup:f5, /setup-f5, set up F5, configure F5 BIG-IP, F5 lifecycle automation."
when_to_use: "User wants to integrate an F5 BIG-IP appliance with Horizon for certificate lifecycle automation (push, renew, revoke) and inventory discovery."
version: 0.1.0
requires_mcp:
  - horizon
tags:
  - setup:f5
  - /setup-f5
  - set up F5
  - configure F5 BIG-IP
  - F5 lifecycle automation
---

This skill walks the user through configuring an F5 BIG-IP integration on a live Evertrust Horizon CLM instance. The full procedural recipe lives in `references/recipe.md`. The exhaustive prerequisite list lives in `references/prerequisites.yaml`. Symptom and fix table lives in `references/troubleshooting.md`. Read all three before producing guidance.

Object names in Horizon are immutable primary keys. Always ask the user for both `name` and `display_name`. All HCQL field names are lowercase.

## Phase 0 - Preflight (MANDATORY)

Follow `skills/_shared/preflight-template.md`. For this skill, the required modules check is `webra` in `licensedModules`. The required knowledge resources are `horizon://knowledge/automation`, `horizon://knowledge/discovery-workflows`, `horizon://knowledge/integrations`, `horizon://knowledge/system-admin`, and `horizon://knowledge/datasources`.

If preflight fails on any step, STOP and report the gap to the user. Do not advance.

## Phase 1 - External MCP / Skill / Knowledge Discovery

Run the regex `^mcp__.*(f5|icontrol|bigip|big.?ip).*` (case-insensitive) against the names of every MCP tool exposed in the session. Record matching names in `discoveredCapabilities`.

If an F5 / iControl MCP is found, mention it to the user and propose using it for the four iControl REST calls in Phase 3 (with the standard mutating-tool confirmation prompt). If no hit, fall back to the embedded recipe.

## Phase 2 - Prerequisites (HARD GATE)

Drive `AskUserQuestion` (or the host equivalent) from `references/prerequisites.yaml`. Group the questions in this order:

1. Variant gate: `F5_TRIGGER_TYPE`.
2. BIG-IP topology: `BIGIP_DNS`, `BIGIP_ADMIN_USER`, `BIGIP_ADMIN_PASSWORD`. Mark the latter two sensitive.
3. Technical account: `TECHNICAL_USER_NAME`, `TECHNICAL_USER_PASSWORD`, `RESOURCE_GROUP_NAME`, `ROLE_NAME`. The password is sensitive.
4. Horizon object names: `F5_CREDENTIAL_NAME`, `F5_CREDENTIAL_DISPLAY_NAME`, `F5_CONNECTOR_NAME`, `F5_CONNECTOR_DISPLAY_NAME`, `F5_TRIGGER_NAME`, `F5_TRIGGER_DISPLAY_NAME`, `PROFILE_NAME`, `SCHEDULED_TASK_NAME`, `SCHEDULED_TASK_CRON`, `DISCOVERY_CAMPAIGN_NAME`, `DISCOVERY_SCOPE`.

Refuse to advance to Phase 3 until every required value is captured. Sensitive prerequisites are never echoed back; print `<KEY_NAME>` instead.

## Phase 3 - External System Setup

Walk `references/recipe.md` section "External system setup steps" verbatim. After every numbered step (1 through 4), ask "Confirm step <N> complete? (yes/no)". Do not advance on anything but `yes`.

If `discoveredCapabilities` from Phase 1 includes an F5 / iControl MCP, propose using it for each step before falling back to the curl-style instructions embedded in the recipe.

The four iControl REST calls are described inline in the recipe so the skill never references an external KB. Mask sensitive values (`BIGIP_ADMIN_PASSWORD`, `TECHNICAL_USER_PASSWORD`) in printed argument summaries.

## Phase 4 - Horizon Configuration

Walk `references/recipe.md` section "Horizon setup steps" verbatim. For each step:

1. Run the matching read tool to detect existing objects by name (`list_credentials` for credentials, `list_triggers` for triggers, `get_profile` for profiles). Note: `list_triggers` accepts only `max_items`, `name_contains`, `trigger_type`. There is currently no MCP read tool for third-party connectors or scheduled tasks; ask the user to confirm from the UI whether the named object already exists.
2. If the object exists, ask `reuse / rename / abort`.
3. If creating a new object, print the exact UI navigation text from the recipe with the resolved values inserted. Sensitive fields print `<KEY_NAME>` not the value.
4. After the user reports the create complete, re-run the read tool and confirm the object is present.

The mutating MCP tool used in this skill is optionally `create_rest_notification` (only for the `f5client` variant when a REST trigger fits). All other writes are UI walks today. Discovery for F5 BIG-IP requires the `horizon-cli netimport bigip` CLI because the `DataSourceType` enum (`dns`, `ldap`, `rest`) does not yet include F5; the skill walks the user through the CLI invocation and flags the missing tool.

## Phase 5 - End-to-End Test

Run the verification calls in `references/recipe.md` section "Verification" in order:

1. `list_credentials` filtered by `name_contains: <F5_CREDENTIAL_NAME>`.
2. `list_triggers` filtered by `trigger_type: <F5_TRIGGER_TYPE>` and `name_contains: <F5_TRIGGER_NAME>`.
3. `get_profile` against `PROFILE_NAME` and assert `F5_TRIGGER_NAME` is in the relevant `triggerHooks`.
4. `simulate_trigger` against `F5_TRIGGER_NAME`. Read-only, no confirmation gate.
5. After the scheduled task fires and the discovery import completes: `search_discovery_events` with `campaign equals "<DISCOVERY_CAMPAIGN_NAME>"`, then `search_certificates` with `discoverydata.paths exists`.

If any step fails, jump to Phase 6.

## Phase 6 - Troubleshooting

Use `references/troubleshooting.md` to map symptoms to fixes.

## Missing MCP Tools

These tools would automate steps that today require a UI walk or a CLI invocation:

- `create_credential`: create the F5 login credential without leaving chat.
- `list_third_party_connectors`, `get_third_party_connector`, `create_third_party_connector`: configure the F5 third-party connector.
- `create_f5client_trigger`, `create_f5as3_trigger`, `attach_trigger_to_profile`: replace the UI step for trigger creation and profile binding.
- `create_scheduled_task`, `list_scheduled_tasks`: replace the WebRA scheduled task UI step.
- `create_f5_datasource`: provide an F5 BIG-IP datasource type so `create_discovery_campaign` can wire BIG-IP discovery without `horizon-cli`.
- `discovery_source_type`: extension to `create_discovery_campaign` accepting non-DNS/LDAP/REST source types.
