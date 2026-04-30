# Intune Setup Troubleshooting

| Problem | Possible Cause | Solution |
|---------|----------------|----------|
| Intune connector save fails with an unknown azureTenant field. | Horizon is older than 2.9.0 and still uses tenant. | Confirm Horizon version. From 2.9.0 the field is azureTenant for AKV, Intune, and Intune PKCS connectors. Upgrade or fall back to tenant on older Horizon releases. |
| Devices re-enroll a fresh certificate at every Intune sync. | The underlying clientAuth template has no backdate. | Set TEMPLATE_BACKDATE_MINUTES to at least 10 on the issuing template, then update the Horizon profile to point at that template. |
| Devices fail enrollment with a SCEP challenge validation error. | The App Registration is missing scep_challenge_provider on Intune Application permissions. | Open the App Registration > API permissions, add Intune > Application > scep_challenge_provider, then grant admin consent. |
| Devices succeed at challenge validation but Horizon never issues. | The SCEP RA credential references a wrong PKCS#12, or the SCEP RA profile points at the wrong PKI connector. | Confirm SCEP_RA_CREDENTIAL_NAME holds the PKCS#12 enrolled from SCEP_RA_PROFILE_NAME. Confirm the SCEP RA profile points at UNDERLYING_PKI_CONNECTOR. |
| Intune profile creation fails with a certificate template error. | A certificate template was specified in the Horizon Intune profile, but Intune SCEP profiles must not specify one. | Re-open the Horizon profile and clear the certificate template field. |
| SCEP server URL is rejected by Windows machines. | The URL still has a trailing /pkiclient.exe. | For Windows machines and Windows users, drop the trailing /pkiclient.exe in the Intune SCEP profile. |
| Trust chain failures on devices. | One or more CAs in the chain (root or intermediate) were not deployed to Intune as Trusted Certificate profiles. | Repeat Phase 3 step 5 for every CA in the chain. |
| Intune PKCS variant fails on enrollment with a key-wrapping error. | PUB_KEY or KEY_NAME do not match the wrapping key the Intune side expects. | Re-check both values against Azure Key Vault and the Horizon connector configuration. |
| Lifecycle-enroll events never appear after device check-in. | The Microsoft Entra group selected during Intune profile assignment does not include the test device or user. | Confirm the device or user account is in INTUNE_GROUP. |
| Connector save warns about a tenant rename. | Horizon API still references tenant in some places. | Always set azureTenant on current Horizon. Older OpenAPI mentions of tenant are legacy. |
