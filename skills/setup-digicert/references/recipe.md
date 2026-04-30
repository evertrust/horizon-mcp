# DigiCert CertCentral Integration Recipe

## Architecture summary

Horizon centralizes certificate requests and lets DigiCert CertCentral act as the public CA. The Horizon DigiCert PKI connector authenticates to CertCentral with an API token and submits orders against a specific organization and product. Issued certificates are returned to Horizon, decorated with the DigiCert order metadata (`digicert_id`, `digicert_order_id`), and exposed through normal Horizon search and lifecycle workflows.

DigiCert offers two console regions. US accounts talk to `https://www.digicert.com`; EU accounts talk to `https://certcentral.digicert.eu`. The CertCentral console shows the region in the top-left corner; the connector base URL must match.

DigiCert public issuance requires every requested SAN to be domain-validated on the DigiCert side BEFORE Horizon submits the order. The connector itself does not perform validation; if a domain is missing, CertCentral rejects the order regardless of the Horizon configuration.

## External system prerequisites

| Item | Description |
|------|-------------|
| CertCentral account | Active CertCentral subscription with at least one approved organization. |
| Approved organization | Validated in CertCentral, with a numeric organization identifier the connector will use. |
| Pre-validated domains | Every FQDN that Horizon will request must already show valid status under Validation > Domains. |
| DigiCert product | The product (Name ID) the connector targets must be entitled for the account, including the required SAN types. |
| Administrative user | The user who owns the dedicated API key must hold an administrative role; this is mandatory for revocation. |
| Outbound HTTPS | Horizon must reach the DigiCert API endpoint on TCP/443. |

## Horizon prerequisites

| Item | Description |
|------|-------------|
| Admin login | Horizon admin with permission to create credentials, PKI connectors, and (optionally) profiles. |
| WebRA module licensed | Required for issuing public certificates through Horizon. |
| Outbound network | Horizon must be able to call CertCentral on TCP/443. If an outbound proxy is required, capture it as PROXY_URL. |

## External system setup steps

1. Sign in to CertCentral and confirm the organization the connector will use is in approved state. Read its numeric identifier from Validation > Organizations.
2. Open Validation > Domains and confirm every domain that Horizon will request is in valid status. Check both the apex domain and every SAN entry.
3. Open Automation > API Keys and create a dedicated API key for Horizon. Bind it to a user that holds an administrative role. Set the restriction to Orders. Capture the key value immediately; CertCentral does not show it again.

## Horizon setup steps

1. Open Settings > Credentials and create a credential of type API Token. Set name to `API_TOKEN_CREDENTIAL_NAME`, display name to `API_TOKEN_CREDENTIAL_DISPLAY_NAME`. Set Target to PKI Connectors. Paste `DIGICERT_API_KEY` (sensitive). Verify with `list_credentials` filtered by `name_contains: <API_TOKEN_CREDENTIAL_NAME>`.
2. Open PKIs > PKI Connectors and create a connector of type DigiCert CertCentral. In the General tab set the connector name to `DIGICERT_CONNECTOR_NAME` (no spaces). Set Proxy to `PROXY_URL` if non-empty. In the Details tab set DigiCert CertCentral API Base URL to `CERTCENTRAL_BASE_URL`, DigiCert CertCentral Product ID to `DIGICERT_PRODUCT_ID`, organization id to `DIGICERT_ORG_ID`, apiCredentials to the credential created in step 1, retryInterval to `RETRY_INTERVAL_SECONDS`, timeout to `TIMEOUT_SECONDS`, skipApproval to `SKIP_APPROVAL`, queue to `QUEUE_ENABLED`, caCertId to `CA_CERT_ID`, customConnectorDataMapping to `CUSTOM_CONNECTOR_DATA_MAPPING`. Save. The MCP server does not currently expose a list tool for PKI connectors; verification at this step is reading the Success status from the UI.
3. If `PROFILE_NAME` is `__NEW__`, create a WebRA profile that references the new connector via `pkiConnector`. Otherwise update the existing profile so its `pkiConnector` field equals `DIGICERT_CONNECTOR_NAME`. Verify with `get_profile`.

## Verification

1. `get_profile` against `PROFILE_NAME` confirms `pkiConnector` equals `DIGICERT_CONNECTOR_NAME`.
2. `get_request_template` against `PROFILE_NAME` with `workflow: enroll` returns the enrollment fields required by the chosen product.
3. After explicit user confirmation, run a single test `submit_request` filling only the fields returned by step 2, with at least one SAN drawn from `VALIDATED_DOMAINS`.
4. `search_certificates` with the HCQL `metadata.digicert_id exists and profile equals "<PROFILE_NAME>"` returns the issued certificate, decorated with `digicert_id` and `digicert_order_id`.

All HCQL field names are lowercase. The query above uses `metadata.digicert_id` and `profile`, not camelCase variants.

## Common failure points

| Symptom | Cause | Fix |
|---------|-------|-----|
| Region mismatch error on save. | US connector pointed at EU base URL or vice versa. | Match `CERTCENTRAL_BASE_URL` to the CertCentral console region. |
| Order rejected because domain not validated. | A SAN was requested before its domain was validated. | Validate the domain in CertCentral first, then re-issue. |
| API authentication errors after key rotation. | Horizon still references the old API key. | Update the API Token credential value; the credential name does not change. |
| `submit_request` payload validation errors. | `get_request_template` was skipped. | Always call `get_request_template` before `submit_request`. |
| Revoke fails with a permissions error. | API key user is not an administrator. | Recreate the API key under an administrator user. |
