# Missing MCP Tools - Master Union List

Every setup skill ends with a "Missing MCP Tools" section that is a strict subset of this list. New skills MUST extend this file rather than restate gaps inline.

## Format used by each skill

```
- <tool_name>: <one-line purpose explaining what the tool would automate>
```

## Master union list

### Credentials

- `create_credential`: create a Horizon credential of type `login`, `certificate-pkcs12`, `api-token`, or `raw` and assign its target (PKI Connectors, third-party connectors, MDM, SCEP RA).
- `update_credential`: update an existing credential (rotate password, replace PKCS#12).
- `delete_credential`: delete a credential by name.

### PKI connectors

- `list_pki_connectors`: enumerate all PKI connectors with their type and current status.
- `get_pki_connector`: fetch a PKI connector by name with full configuration.
- `create_pki_connector`: create a PKI connector for any of the 19 connector types in `src/models/enums.ts`.
- `update_pki_connector`: edit the configuration of an existing PKI connector.
- `delete_pki_connector`: delete a PKI connector by name.

### Third-party connectors

- `list_third_party_connectors`: enumerate all third-party connectors.
- `get_third_party_connector`: fetch a third-party connector by name.
- `create_third_party_connector`: create a third-party connector for any of the 10 third-party connector types.
- `update_third_party_connector`: edit the configuration of an existing third-party connector.
- `delete_third_party_connector`: delete a third-party connector by name.

### Profiles

- `create_profile`: create a Horizon profile for any of the 11 module types.
- `update_profile`: edit an existing profile (bind connector, attach trigger, edit policies).
- `delete_profile`: delete a profile by name.

### Certification authorities

- `list_certification_authorities`: enumerate trusted CAs in Horizon.
- `get_certification_authority`: fetch a CA by name with its trust settings.
- `create_certification_authority`: import a trusted CA with CRL URL and trust flags.
- `update_certification_authority`: edit trust flags or CRL fallback policy.
- `delete_certification_authority`: delete a CA by name.
- `import_certificate_chain`: import a multi-cert chain (root + intermediates) in one call.

### Triggers

- `create_email_trigger`: create an email-notification trigger.
- `create_f5client_trigger`: create an F5 iControl REST lifecycle trigger.
- `create_f5as3_trigger`: create an F5 AS3 declarative lifecycle trigger.
- `create_intunepkcs_trigger`: create an Intune PKCS lifecycle trigger.
- `create_akv_trigger`: create an Azure Key Vault lifecycle trigger.
- `create_aws_trigger`: create an AWS ACM lifecycle trigger.
- `create_gcm_trigger`: create a Google Certificate Manager lifecycle trigger.
- `create_webhook_trigger`: create a generic webhook trigger.
- `update_trigger`: edit an existing trigger.
- `attach_trigger_to_profile`: bind a trigger to a profile via `triggerHooks` without going through the UI.

### Scheduled tasks

- `list_scheduled_tasks`: enumerate WebRA scheduled tasks.
- `get_scheduled_task`: fetch a scheduled task by name.
- `create_scheduled_task`: create a WebRA scheduled task with cron expression and target operation.
- `update_scheduled_task`: edit cron, scope, or operation of an existing scheduled task.
- `delete_scheduled_task`: delete a scheduled task by name.

### Discovery datasources beyond DNS / LDAP / REST

- `create_f5_datasource`: create an F5 BIG-IP datasource for `create_discovery_campaign`.
- `create_aws_datasource`: create an AWS ACM / IAM datasource.
- `create_akv_datasource`: create an Azure Key Vault datasource.
- `create_digicert_datasource`: create a DigiCert datasource.
- `create_globalsign_datasource`: create a GlobalSign datasource.
- `create_hashicorp_vault_datasource`: create a HashiCorp Vault datasource.
- `discovery_source_type`: extension to `create_discovery_campaign` so that F5, cloud, and vault sources can be wired without `horizon-cli`.
