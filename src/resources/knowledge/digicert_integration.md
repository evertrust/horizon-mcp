# DigiCert Integration Recipe

## Use This Recipe For

- Horizon PKI connectors of type `digicert`
- Profiles that must enroll or renew through DigiCert CertCentral

## Documentation Path

1. Call `search_docs` for `DigiCert connector`.
2. If product docs are too thin, call `search_api_docs` for `DigiCert connector`.
3. Fetch the chosen page with `get_doc_page`.

The connector schema in Horizon OpenAPI is the authoritative source for field names.

## Required Connector Fields

Verified in Horizon source and OpenAPI:

- `name`
- `type: "digicert"`
- `baseUrl`
- `apiCredentials`
- `organizationId`

## Supported Base URLs

Verified in OpenAPI:

- `https://www.digicert.com/`
- `https://certcentral.digicert.eu/`

## Optional Fields Worth Deciding Up Front

- `productId`
- `caCertId`
- `retryInterval`
- `skipApproval`
- `timeout`
- `proxy`
- `queue`
- `customConnectorDataMapping`

## Horizon Object Order

1. Create a raw credential containing the DigiCert API key.
2. Create the `digicert` PKI connector that references that credential through `apiCredentials`.
3. Create or update the profile that references the connector through `pkiConnector`.

## Certificate Metadata To Expect Later

Verified in Horizon source and OpenAPI:

- `digicert_id`
- `digicert_order_id`

These metadata fields are useful when correlating Horizon certificates with DigiCert orders.

## Common Failure Points

- Wrong `baseUrl` for the DigiCert region.
- Creating the raw credential but referencing the wrong credential name in `apiCredentials`.
- Missing `organizationId`.
- Expecting the profile to work before `pkiConnector` is wired to the correct profile.
