# F5 BIG-IP Integration Recipe

## Architecture summary

Horizon manages the certificate lifecycle on an F5 BIG-IP appliance by holding a dedicated technical user on the BIG-IP and binding a Horizon trigger (`f5client` for iControl REST or `f5as3` for AS3 declarative) to a Horizon profile. The trigger fires on lifecycle events (issuance, renewal, revocation) and pushes / updates / deletes certificates on the BIG-IP through iControl REST or AS3.

A WebRA scheduled task drives recurring renewals on the Horizon side. A discovery campaign optionally ingests the BIG-IP certificate inventory back into Horizon so that Horizon's discovery view reconciles with what the BIG-IP actually serves.

The technical user is created with elevated rights (`resource-admin` on `all-partitions`) so it can perform automatic revocation when a certificate is deleted from the BIG-IP. The user is then removed from the default `iControl_REST_API_User` role and bound to a custom role linked to a resource group that exposes only the nine API method/mask pairs Horizon needs.

## External system prerequisites

| Item | Description |
|------|-------------|
| BIG-IP admin access | An administrator account on the BIG-IP, used only during Phase 3 bootstrap. |
| iControl REST reachable | TCP/443 to `https://<BIGIP_DNS>/mgmt/...` from the host running the iControl calls. |
| Operational platform | A licensed BIG-IP that exposes the LTM client-ssl profile and ssl-cert/ssl-key endpoints (LTM Standard licence). |
| AS3 if f5as3 | When the F5_TRIGGER_TYPE is `f5as3`, the AS3 declarative API package must be installed on the BIG-IP. |

## Horizon prerequisites

| Item | Description |
|------|-------------|
| WebRA module licensed | Required to bind the trigger to a profile and run the scheduled task. |
| Outbound to BIG-IP | Horizon must reach the BIG-IP management endpoint over HTTPS. |
| Profile to bind | An existing Horizon profile whose lifecycle events should drive F5 pushes. |

## External system setup steps

These four iControl REST calls are sent from any host that can reach the BIG-IP. The skill prints the exact body and expected response after every step. Replace `<BIGIP_DNS>` with the value collected during Phase 2 and authenticate with `BIGIP_ADMIN_USER` / `BIGIP_ADMIN_PASSWORD`.

1. POST `https://<BIGIP_DNS>/mgmt/tm/auth/user` with body:

```json
{
  "name": "<TECHNICAL_USER_NAME>",
  "description": "Horizon Technical Account",
  "password": "<TECHNICAL_USER_PASSWORD>",
  "shell": "tmsh",
  "partitionAccess": [
    { "name": "all-partitions", "role": "resource-admin" }
  ]
}
```

Expected response: HTTP 200 with the created user in the body. The skill SHOULD parse the response to confirm the user appears with `partitionAccess` set to `resource-admin` on `all-partitions`.

2. GET `https://<BIGIP_DNS>/mgmt/shared/authz/roles/iControl_REST_API_User`. From the returned `userReferences` list, drop the entry whose link references `<TECHNICAL_USER_NAME>`. Keep every other entry (typically `admin` and `f5admin`). PUT the modified body back to the same URL. Expected response: HTTP 200 with the updated `userReferences`.

3. POST `https://<BIGIP_DNS>/mgmt/shared/authz/resource-groups` with body:

```json
{
  "name": "<RESOURCE_GROUP_NAME>",
  "resources": [
    {"restMethod": "GET",    "resourceMask": "/mgmt/tm/ltm/profile/client-ssl/**"},
    {"restMethod": "GET",    "resourceMask": "/mgmt/tm/ltm/profile/client-ssl"},
    {"restMethod": "POST",   "resourceMask": "/mgmt/tm/ltm/profile/client-ssl"},
    {"restMethod": "PATCH",  "resourceMask": "/mgmt/tm/ltm/profile/client-ssl/**"},
    {"restMethod": "GET",    "resourceMask": "/mgmt/tm/sys/file/ssl-cert/**"},
    {"restMethod": "DELETE", "resourceMask": "/mgmt/tm/sys/file/ssl-cert/**"},
    {"restMethod": "DELETE", "resourceMask": "/mgmt/tm/sys/file/ssl-key/**"},
    {"restMethod": "POST",   "resourceMask": "/mgmt/shared/file-transfer/uploads/**"},
    {"restMethod": "POST",   "resourceMask": "/mgmt/tm/sys/crypto/**"}
  ]
}
```

Capture the returned `selfLink`. Expected response: HTTP 200.

4. POST `https://<BIGIP_DNS>/mgmt/shared/authz/roles` with body:

```json
{
  "name": "<ROLE_NAME>",
  "userReferences": [
    {"link": "https://localhost/mgmt/shared/authz/users/<TECHNICAL_USER_NAME>"}
  ],
  "resourceGroupReferences": [
    {"link": "<selfLink from step 3>"}
  ]
}
```

Expected response: HTTP 200 with the role linked to the technical user and the resource group.

## Horizon setup steps

1. Settings > Credentials > New > Login (target: third-party connectors). Set name to `F5_CREDENTIAL_NAME`, display name to `F5_CREDENTIAL_DISPLAY_NAME`. Login is `TECHNICAL_USER_NAME`, password is `TECHNICAL_USER_PASSWORD` (sensitive). Verify with `list_credentials` filtered by `name_contains: <F5_CREDENTIAL_NAME>`.
2. Configuration > Third-Party > F5 > Connectors > New. Set name to `F5_CONNECTOR_NAME`, display name to `F5_CONNECTOR_DISPLAY_NAME`. Wire the BIG-IP endpoint and the credential created in step 1. The MCP server does not currently expose a list tool for third-party connectors; verification is reading the success status from the UI.
3. Configuration > Triggers > New. Variant gate: when `F5_TRIGGER_TYPE` is `f5client` and a REST notification fits the F5 client lifecycle, the skill MAY use `create_rest_notification` (gate behind the standard mutating-tool confirmation). Otherwise create the trigger from the UI. Set name to `F5_TRIGGER_NAME`, display name to `F5_TRIGGER_DISPLAY_NAME`. Verify with `list_triggers` filtered by `trigger_type: <F5_TRIGGER_TYPE>` and `name_contains: <F5_TRIGGER_NAME>`. Note: `list_triggers` accepts only `max_items`, `name_contains`, and `trigger_type` arguments.
4. Bind the trigger to `PROFILE_NAME` via triggerHooks (UI). Verify with `get_profile` that `F5_TRIGGER_NAME` appears in the appropriate `triggerHooks` slot for `PROFILE_NAME`.
5. WebRA Scheduled Task. Create a scheduled task named `SCHEDULED_TASK_NAME` with cron expression `SCHEDULED_TASK_CRON`. The MCP server does not currently expose a create tool for scheduled tasks; flag `create_scheduled_task` as missing.
6. Discovery campaign. The Horizon `DataSourceType` enum currently includes only `dns`, `ldap`, and `rest`; F5 BIG-IP discovery is NOT yet wired into `create_discovery_campaign`. Walk the user through running `horizon-cli netimport bigip` against `BIGIP_DNS` for `DISCOVERY_SCOPE`, as documented in `horizon://knowledge/discovery-workflows`. Flag `create_f5_datasource` and the `discovery_source_type` extension as missing.

## Verification

1. `list_credentials` filtered by `name_contains: <F5_CREDENTIAL_NAME>` returns the F5 credential.
2. `list_triggers` filtered by `trigger_type: <F5_TRIGGER_TYPE>` and `name_contains: <F5_TRIGGER_NAME>` returns exactly one trigger.
3. `get_profile` against `PROFILE_NAME` shows `F5_TRIGGER_NAME` in the `triggerHooks` for the relevant lifecycle events.
4. `simulate_trigger` against `F5_TRIGGER_NAME` succeeds. Note that `simulate_trigger` is read-only (executes the trigger with synthetic test context); no confirmation gate is required.
5. After at least one scheduled-task fire and one discovery import, `search_discovery_events` with the HCQL `campaign equals "<DISCOVERY_CAMPAIGN_NAME>"` returns events, and `search_certificates` with `discoverydata.paths exists` returns the BIG-IP-served certificates.

All HCQL field names are lowercase. The query above uses `campaign` and `discoverydata.paths`, not camelCase variants.

## Common failure points

| Symptom | Cause | Fix |
|---------|-------|-----|
| Step 4 of the iControl REST setup fails. | The selfLink captured from step 3 was not used verbatim. | Re-read step 3's response and re-issue step 4 with the exact selfLink. |
| Trigger save fails with an unknown enum. | F5_TRIGGER_TYPE not one of `f5client` or `f5as3`. | Pick one of the two enum values. |
| Trigger does not fire. | Not attached to PROFILE_NAME triggerHooks. | Re-open the profile and add F5_TRIGGER_NAME under the right lifecycle event. |
| Discovery returns nothing. | F5 datasource type is not yet supported by create_discovery_campaign. | Run horizon-cli netimport bigip out of band. The skill flags this gap explicitly. |
| simulate_trigger fails. | Stale credentials in F5_CREDENTIAL_NAME. | Update the credential value. |
