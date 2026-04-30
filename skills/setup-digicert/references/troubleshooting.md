# DigiCert Setup Troubleshooting

| Problem | Possible Cause | Solution |
|---------|----------------|----------|
| Connector save fails with an authentication error against the DigiCert API. | Wrong API key, the API key user lacks administrator role, or the API key is missing the Orders restriction. | Re-check the API key by curl-ing CertCentral with it. Regenerate the key if needed. The Orders restriction is mandatory for enrollment requests, and revoking certificates also requires the user to hold an administrative role. |
| Connector save fails with a region error. | The CertCentral account lives in EU but the connector points at the US base URL (or vice versa). | Set CERTCENTRAL_BASE_URL to https://certcentral.digicert.eu for EU accounts or https://www.digicert.com for US. CertCentral displays the region in the top-left corner of its console. |
| Enrollment requests stay queued and never issue. | A requested SAN is not validated on the DigiCert side, or the chosen product does not allow that SAN type. | Open Validation > Domains in CertCentral and confirm every requested FQDN appears with valid status. Confirm DIGICERT_PRODUCT_ID accepts the SAN types in the Horizon enrollment payload. |
| Enrollment fails with an organization mismatch. | DIGICERT_ORG_ID does not match a real or active organization on the DigiCert side. | Read the organization id from Validation > Organizations and update the connector. |
| Connector status reports a network error. | Horizon cannot reach the DigiCert API endpoint over HTTPS. | Confirm outbound TCP/443 to the API endpoint. If a proxy is required, set PROXY_URL on the connector. |
| Issued certificates carry no digicert_id metadata. | The connector was wired to the profile after issuance, or the profile is using a different PKI connector. | Confirm that get_profile returns the DigiCert connector name in pkiConnector for that profile. Re-issue. |
| Revocation fails. | The API key user does not hold an administrative role. | Reissue the API key under a user with administrator permissions. |
| Connector created but enrollment payload missing required fields. | submit_request was called without first calling get_request_template. | Always call get_request_template before submit_request and only fill in fields it returns. |
