# Microsoft Intune Integration Recipe

## Architecture summary

Horizon issues device certificates to Intune-managed endpoints by acting as the SCEP authority for an Intune SCEP certificate profile (variant `intune`) or by acting as the PKCS provider (variant `intunepkcs`). In both cases Horizon authenticates to Intune and Microsoft Graph through a dedicated Microsoft Entra App Registration, and Intune validates SCEP challenges by calling Horizon back.

The SCEP variant flow: the device receives a SCEP profile from Intune, generates a key pair locally, builds a CSR, and sends a SCEP PKCSReq to Horizon. Horizon validates the encrypted Intune challenge with the App Registration credentials, then enrolls the certificate against an underlying PKI connector (typically Stream) and returns the certificate to the device.

The PKCS variant uses Horizon to wrap the issued PKCS material with a public key managed by Azure Key Vault before pushing it to Intune; the device receives the wrapped material from Intune.

Both variants require: a third-party Intune connector in Horizon, a PKI connector that points at the underlying issuing CA template, and a Horizon profile that ties the two together. The Horizon 2.9.0 release renamed `tenant` to `azureTenant` on AKV, Intune, and Intune PKCS connectors.

## External system prerequisites

| Item | Description |
|------|-------------|
| Microsoft Entra access | Permissions to create an App Registration and a client secret. |
| Intune access | Permissions to create configuration profiles and assign them to a Microsoft Entra group. |
| Microsoft Entra group | Group containing the users or devices that will receive certificates. |
| Trusted CA chain (DER) | Root and every intermediate CA, exported as DER files, ready to upload as Intune Trusted Certificate profiles. |
| Outbound from device | Devices must reach Horizon's external SCEP URL for the SCEP variant. |

## Horizon prerequisites

| Item | Description |
|------|-------------|
| WebRA module licensed | Required to enroll the SCEP RA certificate. |
| Intune (or IntunePKCS) module licensed | Required to register and run the third-party connector. |
| Stream (or other) PKI connector | Underlying issuing connector that holds the clientAuth template with the right key usages and backdate. |
| Externally-reachable Horizon URL | Devices reach the SCEP endpoint at https://<HORIZON_URL>/intune/<INTUNE_PROFILE_NAME>/pkiclient.exe (drop the trailing /pkiclient.exe for Windows machines and users). |

## External system setup steps

1. Microsoft Entra ID > App Registrations > New registration. Name it `APP_REGISTRATION_NAME`. Leave Redirect URI empty. Copy the Application (client) ID into `APP_CLIENT_ID` and the Directory (tenant) ID into `TENANT_DIRECTORY_ID`.
2. App Registration > Certificates & secrets > New client secret. Pick a description and an expiry. Copy the secret value into `APP_CLIENT_SECRET` and record the expiry date in `APP_CLIENT_SECRET_EXPIRY_DATE`. The value is shown only once.
3. App Registration > API permissions > Add a permission > Intune > Application permissions > scep_challenge_provider. Save and grant admin consent.
4. App Registration > API permissions > Add a permission > Microsoft Graph > Application permissions > Application > Application.Read.All. Save and grant admin consent.
5. Intune > Devices > <TARGET_PLATFORM> devices > Configuration > Create. Profile = Trusted certificate. Upload one DER file from `ROOT_CA_DER`. For Windows 8.1 and Windows 10/11 also pick Destination Store. Repeat this step for every CA in the chain (root + intermediates + issuing CA). Assign each profile to `INTUNE_GROUP`.
6. Intune > Devices > <TARGET_PLATFORM> devices > Configuration > Create. Pick the SCEP Certificates template. Set Certificate validity period, Key Storage Provider (TPM preferred for Windows when available), Key Usages matching the underlying PKI template, Key size matching the Horizon profile, Hash algorithm SHA-2 (never SHA-1). Pick the root CA imported in step 5. Pick Extended Key Usage matching `EXPECTED_EKU`. Set SCEP Server URL to `https://<HORIZON_URL>/intune/<INTUNE_PROFILE_NAME>/pkiclient.exe`. For Windows machines or Windows users, REMOVE the trailing `/pkiclient.exe`. Assign to `INTUNE_GROUP`.

## Horizon setup steps

1. WebRA SCEP RA profile. Either pick the existing profile named in `SCEP_RA_PROFILE_NAME`, or create a new WebRA profile that targets a Stream PKI Connector with key usages Critical, Digital Signature, Key Encipherment. Verify with `get_profile`.
2. Enroll the SCEP RA TLS-clientAuth PKCS#12. Call `get_request_template` against `SCEP_RA_PROFILE_NAME` with `workflow: enroll`, then `submit_request` (mutating, gate behind confirmation) using only the fields it returned. Download the issued PKCS#12 and its passphrase securely.
3. Settings > Credentials > New > Certificate (PKCS#12) targeting SCEP RA. Set name to `SCEP_RA_CREDENTIAL_NAME`, display name to `SCEP_RA_CREDENTIAL_DISPLAY_NAME`. Upload the PKCS#12 from step 2. Verify with `list_credentials`.
4. Settings > Credentials > New > Login targeting MDM. Set name to `MDM_CREDENTIAL_NAME`, display name to `MDM_CREDENTIAL_DISPLAY_NAME`. Set login to `APP_CLIENT_ID` (sensitive) and password to `APP_CLIENT_SECRET` (sensitive). Optionally set the credential expiration to `APP_CLIENT_SECRET_EXPIRY_DATE` to fire a notification before the secret expires. Verify with `list_credentials`.
5. Configuration > MDM > Intune (or Intune PKCS) > Connectors > New. Set name to `INTUNE_CONNECTOR_NAME`, display name to `INTUNE_CONNECTOR_DISPLAY_NAME`. Set `azureTenant` to `TENANT_DIRECTORY_ID`. Set throttleDuration to `THROTTLE_DURATION`. Set throttleParallelism to `THROTTLE_PARALLELISM`. Set credentials to `MDM_CREDENTIAL_NAME`. For `intune` set legacyRevocationMode to `LEGACY_REVOCATION_MODE`. For `intunepkcs` set pubKey to `PUB_KEY` and keyName to `KEY_NAME`. Save. The MCP server does not currently expose a list tool for third-party connectors; verification at this step is reading the success status from the UI.
6. PKIs > PKI Connectors > New. Configure the underlying connector that will issue the device certificates. The clientAuth template must have key usages digitalSignature and keyEncipherment, EKU `EXPECTED_EKU`, and a backdate of at least `TEMPLATE_BACKDATE_MINUTES` minutes. Without the backdate, devices re-enroll a fresh certificate on every Intune sync.
7. Configuration > MDM > Intune > Profiles > New. Set name to `INTUNE_PROFILE_NAME`, display name to `INTUNE_PROFILE_DISPLAY_NAME`. Wire the Intune connector created in step 5 and the PKI connector created in step 6. Pick the SCEP RA credential created in step 3 as the SCEP Authority (mode RA). Define the certificate-per-holder policy. DO NOT specify a certificate template in this profile (templates are configured upstream on the PKI connector).
8. Trust chain import. Import the root and intermediate CAs into Horizon (Configuration > Certification Authorities) so Horizon trusts the chain when issuing.
9. Copy the generated SCEP server URL `https://<HORIZON_URL>/intune/<INTUNE_PROFILE_NAME>/pkiclient.exe` into the Intune SCEP profile created in External setup step 6. Drop the trailing `/pkiclient.exe` for Windows.

## Verification

1. `get_profile` against `INTUNE_PROFILE_NAME` returns the new profile with the matching connector references.
2. `list_credentials` filtered by `name_contains: <SCEP_RA_CREDENTIAL_NAME>` and `name_contains: <MDM_CREDENTIAL_NAME>` returns both credentials.
3. After a device check-in via Company Portal (or MDM sync on the chosen platform), `search_events` with the HCQL `type equals "lifecycle-enroll" and profile equals "<INTUNE_PROFILE_NAME>"` returns at least one event in the configured window.
4. Optional: `fetch_exposed_certificate` against an enrolled device endpoint, when the device exposes the issued certificate over TLS.

All HCQL field names are lowercase. The query above uses `type` and `profile`, not camelCase variants.

## Common failure points

| Symptom | Cause | Fix |
|---------|-------|-----|
| `tenant` field rejected. | Horizon 2.9.0 or later expects `azureTenant`. | Use `azureTenant` always. |
| Certificates re-enroll at every Intune sync. | Clientauth template lacks the backdate. | Set TEMPLATE_BACKDATE_MINUTES at least 10 on the issuing template. |
| Intune profile rejects creation. | Certificate template was specified inside the Horizon Intune profile. | Clear the template field; the underlying PKI connector defines it. |
| Windows enrollment fails, other platforms succeed. | SCEP URL still has the trailing `/pkiclient.exe` for Windows. | Drop the trailing `/pkiclient.exe` for Windows machines and users. |
| `submit_request` for the SCEP RA fails with missing fields. | `get_request_template` was skipped. | Always call `get_request_template` first. |
