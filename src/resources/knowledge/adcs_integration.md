# ADCS Integration Recipe

## Use This Recipe For

- EverTrust ADCS Connector (`evtadcs`)
- Legacy Microsoft ADCS Web connector (`msadcs`)
- Horizon profiles that must issue certificates from Active Directory Certificate Services

## Start With Official Docs

1. Call `search_docs` for `ADCS Connector installation`.
2. Call `search_docs` for `ADCS Connector initial configuration`.
3. Fetch the chosen pages with `get_doc_page`.

The ADCS Connector install guide is the source of truth for machine-side setup.

## Verified Machine-Side Facts

- The ADCS Connector must be deployed inside an Active Directory forest.
- It can run on the ADCS server itself or on another machine in the same domain.
- If it runs on another machine, install the AD CS RSAT tools.
- The connector configuration uses the `CertHash` value in `EverTrustADCSConnector.exe.config`.
- Port `4443` must be reachable from Horizon.
- `https://localhost:4443/api/certificate` should return `OK` when the connector is correctly started.
- You need:
  - a certificate template on ADCS,
  - a technical account allowed to enroll on that template,
  - `Issue and Manage Certificates` rights on the ADCS,
  - an enrollment agent certificate exported as PKCS#12.

## Horizon Object Order

1. Create a password credential for the ADCS technical account.
2. Create a certificate credential for the enrollment agent PKCS#12.
3. Create the PKI connector.
4. Create or update the Horizon profile that references the connector through `pkiConnector`.

## Connector Payload Checklist

### `evtadcs` (EverTrust ADCS Connector)

Required fields verified in Horizon source and OpenAPI:

- `name`
- `type: "evtadcs"`
- `endPoint`
- `caConfig`
- `profile`
- `domain`
- `loginCredentials`
- `enrollmentCredentials`

### `msadcs` (legacy Microsoft ADCS Web)

Required fields verified in Horizon source and OpenAPI:

- `name`
- `type: "msadcs"`
- `endPoint`
- `profile`
- `loginCredentials`
- `enrollmentCredentials`

## Verification Checklist

- `list_credentials` shows both referenced credential names.
- The target profile points to the expected `pkiConnector`.
- The connector endpoint answers on `4443` before troubleshooting Horizon.

## Common Failure Points

- Wrong certificate hash in the ADCS Connector config file.
- Firewall still blocking `4443`.
- Missing enrollment right on the ADCS template.
- Using `msadcs` fields with an `evtadcs` connector, or the reverse.
