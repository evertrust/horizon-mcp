# F5 BIG-IP Setup Troubleshooting

| Problem | Possible Cause | Solution |
|---------|----------------|----------|
| iControl REST step 1 fails with HTTP 401. | The BIG-IP admin credentials used to bootstrap are wrong, or admin login is restricted to a different partition. | Re-check BIGIP_ADMIN_USER and BIGIP_ADMIN_PASSWORD by hitting GET /mgmt/tm/sys/version manually. Confirm the admin account has resource-admin on all-partitions. |
| iControl REST step 4 fails with a missing user link. | The PUT in step 2 wrote the wrong link, or the user reference was not updated correctly. | Reread the role with GET /mgmt/shared/authz/roles/iControl_REST_API_User and re-issue the PUT with the user removed. |
| Lifecycle pushes succeed but certificates do not appear in BIG-IP. | The resource group is missing one of the nine method/mask pairs. | Recreate the resource group exactly with all nine entries: GET, GET wildcard, POST, PATCH wildcard for client-ssl; GET / DELETE wildcard for ssl-cert; DELETE wildcard for ssl-key; POST wildcard for file-transfer/uploads; POST wildcard for sys/crypto. |
| Trigger save fails with an unknown trigger type. | F5_TRIGGER_TYPE was set to a value that does not match the live Horizon enum. | Pick f5client or f5as3 only. f5client uses iControl REST. f5as3 uses AS3 declarative. |
| Trigger fires but no certificate is pushed. | Trigger not bound to the profile triggerHooks, or scheduled task is not running. | Confirm get_profile shows F5_TRIGGER_NAME under triggerHooks for PROFILE_NAME. Confirm SCHEDULED_TASK_NAME exists and last_fired_at is recent. |
| Discovery campaign returns no certificates from BIG-IP. | BIG-IP datasource not configured (the MCP tool create_f5_datasource does not exist yet). | Run horizon-cli netimport bigip out of band as documented in horizon://knowledge/discovery-workflows. The skill never fabricates a missing tool. |
| simulate_trigger reports authentication failure. | F5_CREDENTIAL_NAME stores stale credentials. | Update the credential value (the credential name is immutable) with the current technical user password. |
| iControl REST role removal step leaves the admin or f5admin unreferenced. | The PUT body removed too many users. | Restore admin and f5admin references in the PUT body and re-issue. Only the technical user reference should be removed. |
| Resource group creation reports a missing field. | Body sent without the leading name field or the resources array. | Re-send the POST with the full body including name and the nine method/mask pairs. |
| f5as3 declarative trigger save fails. | The chosen variant is not licensed or not enabled on the Horizon instance. | Confirm the Horizon instance is licensed for f5as3 third-party connectors and triggers. |
