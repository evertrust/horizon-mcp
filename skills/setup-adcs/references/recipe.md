# Microsoft ADCS Integration Recipe

## Architecture summary

Horizon manages the full certificate lifecycle (enrollment, renewal, revocation) through a Microsoft ADCS Certification Authority by talking to the EverTrust ADCS Connector over HTTPS. The connector runs inside the Active Directory forest (either on the ADCS server itself or on a domain-joined host with the AD CS RSAT tools installed) and exposes a REST endpoint on TCP/4443. Horizon authenticates to the connector with a PKCS#12 Enrollment Agent certificate and authenticates to Active Directory with an AD technical account.

Each Microsoft ADCS certificate template that Horizon needs to manage is fronted by its own dedicated PKI connector. Horizon stores credentials separately from connectors so the same enrollment agent and technical account can be reused across multiple template-bound connectors without copy-paste.

A second variant exists for legacy Microsoft ADCS Web (`msadcs`). It does not require the AD NetBIOS name nor the CA Config string because it talks directly to the ADCS web frontend. The `evtadcs` variant is recommended whenever the EverTrust ADCS Connector is available.

## External system prerequisites

| Item | Description |
|------|-------------|
| AD forest with ADCS | The forest must already contain a configured ADCS Certification Authority. |
| ADCS certificate template | The template the connector will issue from must already exist on the CA. |
| Technical account | An AD user account that is not a GMSA, with no interactive logon rights. |
| Template permissions | Grant Read and Enroll on the template to the technical account. |
| CA permissions | Grant Issue and Manage Certificates on the CA to the technical account. |
| Enrollment Agent certificate | A PKCS#12 bundle issued by ADCS for the technical account, used for enroll-on-behalf-of operations. |
| EverTrust ADCS Connector deployed | Installed on the ADCS host or a domain-joined host with the AD CS RSAT tools, listening on TCP/4443. |
| Connector TLS certificate | A TLS certificate (issued by an internal CA) that fronts the connector HTTPS endpoint. |
| CRL Distribution Point | The CRLDP of the issuing CA must be reachable from Horizon over TCP/80. |
| Network flows | Horizon to connector on TCP/4443. Horizon to CRLDP on TCP/80. |

## Horizon prerequisites

| Item | Description |
|------|-------------|
| Admin login | A user account in Horizon with Configuration permissions on Certification Authorities, Credentials, PKI Connectors, and Profiles. |
| WebRA module licensed | Required for issuing certificates against the ADCS via Horizon enrollment workflows. |
| Outbound connectivity | Horizon must reach the ADCS Connector and the CRLDP from its own network. |
| Existing or new profile | Either pick an existing WebRA profile to bind the new connector to, or plan a new profile after the connector exists. |

## External system setup steps

1. Confirm the ADCS certificate template name and the CA Config string (`CA_HOST\CA_NAME`).
2. Create the technical account in Active Directory if not already present. Disable interactive logon. Confirm it is not a Group Managed Service Account.
3. On the ADCS, grant Read and Enroll on the certificate template to the technical account.
4. On the ADCS, grant Issue and Manage Certificates on the CA to the technical account.
5. Issue and export an Enrollment Agent certificate for the technical account as a PKCS#12 bundle. Record its passphrase securely; it must match `ADCS_ENROLLMENT_AGENT_PASSPHRASE`.
6. Install the EverTrust ADCS Connector on the ADCS host or a domain-joined host with the AD CS RSAT tools. Configure its `EverTrustADCSConnector.exe.config` with the `CertHash` of the connector TLS certificate.
7. Verify locally on the connector host that `https://localhost:4443/api/certificate` returns OK.
8. Verify from Horizon that TCP/4443 to the connector and TCP/80 to the CRLDP are reachable.

## Horizon setup steps

1. Trust the issuing CA. Open Certification Authorities and import the connector TLS certificate's issuing CA. Set CRL URL to `CRLDP_URL`. Enable Trust for Server Authentication. Set Outdated revocation status policy to `HORIZON_CRL_FALLBACK_POLICY` (default `Last available status`). The `horizon` MCP server does not currently expose a list tool for CAs, so verification at this step is a manual UI confirmation that the CA shows up under Certification Authorities.
2. Open Security > Credentials and create a Certificate (PKCS#12) credential targeting PKI Connectors. Set name to `ADCS_ENROLLMENT_AGENT_P12_NAME`, display name to `ADCS_ENROLLMENT_AGENT_P12_DISPLAY_NAME`. Upload the Enrollment Agent PKCS#12 and supply the passphrase. Verify with `list_credentials` filtered by `name_contains: <ADCS_ENROLLMENT_AGENT_P12_NAME>`.
3. Open Security > Credentials and create a Login credential targeting PKI Connectors. Set name to `ADCS_TECHNICAL_ACCOUNT_LOGIN_NAME`, display name to `ADCS_TECHNICAL_ACCOUNT_LOGIN_DISPLAY_NAME`. Set login to `ADCS_TECHNICAL_ACCOUNT_LOGIN` and password to `ADCS_TECHNICAL_ACCOUNT_PASSWORD`. Verify with `list_credentials`.
4. Open PKI > Connectors and create the connector with the variant chosen during preflight. For `evtadcs` set Endpoint to `ADCS_CONNECTOR_URL`, AD Domain NetBIOS Name to `AD_NETBIOS_NAME`, MS ADCS Certificate Template Name to `ADCS_CERTIFICATE_TEMPLATE`, CA Config to `ADCS_CA_CONFIG`. Wire Enrollment Agent credentials to the credential created in step 2 and MS ADCS technical credentials to the credential created in step 3. Save. The MCP server does not currently expose a list tool for PKI connectors, so verification at this step is reading the Success status from the UI.
5. If `PROFILE_NAME` is `__NEW__`, create a WebRA profile that references the new connector via `pkiConnector`. Otherwise update the existing profile so its `pkiConnector` field equals `PKI_CONNECTOR_NAME`. Verify with `get_profile`.

## Verification

1. `get_profile` against `PROFILE_NAME` confirms `pkiConnector` equals `PKI_CONNECTOR_NAME`.
2. `get_request_template` against `PROFILE_NAME` with `workflow: enroll` returns the enrollment field set required by the underlying ADCS template. Per the global Horizon rule, `submit_request` is never called without first calling `get_request_template`.
3. After explicit user confirmation, run a single test `submit_request` filling only the fields returned by step 2.
4. `search_certificates` with the HCQL query `module equals "webra" and profile equals "<PROFILE_NAME>"` returns the issued certificate.
5. `decode_x509` on the issued certificate confirms its issuer chain matches the CA imported in Horizon setup step 1.

All HCQL field names are lowercase. The query above uses `module` and `profile`, not `Module` or `Profile`.

## Common failure points

| Symptom | Cause | Fix |
|---------|-------|-----|
| Connector status reports Error after creation. | CRLDP not reachable from Horizon, or the issuing CA TLS cert is rejected. | Set Outdated revocation status policy to Last available status. |
| Enrollment fails authentication. | Technical account lacks Read+Enroll on the template or Issue and Manage Certificates on the CA. | Grant the missing permissions on the ADCS console. |
| Mixing `evtadcs` and `msadcs` field sets. | The two variants have different required fields. | Pick one variant during Phase 2 and stay with it. |
| `submit_request` rejects payload as missing fields. | `get_request_template` was skipped. | Always call `get_request_template` before `submit_request`. |
| Certificates issued but the chain does not match the imported CA. | Multiple ADCS instances issue with the same template. | Confirm `ADCS_CA_CONFIG` matches the CA recorded in Horizon. |
