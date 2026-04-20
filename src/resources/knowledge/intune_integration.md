# Intune Integration Recipe

## Choose The Variant First

- Use module `intune` for Intune SCEP.
- Use module `intunepkcs` for Intune PKCS.

Both variants require:

- a third-party connector,
- a PKI connector,
- a profile that references both.

## Documentation Path

1. Call `search_docs` for `Intune` or `Intune PKCS`.
2. Call `search_docs` for `WinHorizon AD configuration` when the deployment touches AD-bound Windows components.
3. Fetch the selected pages with `get_doc_page`.

## Connector Drift To Know About

Horizon `2.9.0` release notes explicitly state that `tenant` was renamed to
`azureTenant` for AKV, Intune, and Intune PKCS configuration objects.

Use `azureTenant` when targeting current Horizon versions, even though some
OpenAPI component required lists still mention `tenant`.

## Third-Party Connector Checklist

### `intune`

Verified in source, OpenAPI, and source API tests:

- `type: "intune"`
- `name`
- `throttleDuration`
- `throttleParallelism`
- `azureTenant`
- `credentials`
- `legacyRevocationMode`

### `intunepkcs`

Verified in source, OpenAPI, and source API tests:

- `type: "intunepkcs"`
- `name`
- `throttleDuration`
- `throttleParallelism`
- `azureTenant`
- `credentials`
- `pubKey`
- `keyName`

## Profile Checklist

### `intune` profile

Required fields verified in Horizon OpenAPI:

- `module: "intune"`
- `name`
- `enabled`
- `mode`
- `thirdPartyConnector`
- `pkiConnector`
- `scepRA`
- `caps`
- `encryptionAlgorithm`
- `authorizationLevels`
- `requestsPolicy`
- `selfPermissions`
- `cryptoPolicy`

### `intunepkcs` profile

Required fields verified in Horizon OpenAPI:

- `module: "intunepkcs"`
- `name`
- `enabled`
- `pkiConnector`
- `thirdPartyConnector`
- `authorizationLevels`
- `requestsPolicy`
- `cryptoPolicy`
- `selfPermissions`

## Horizon Object Order

1. Create the Intune password credential.
2. Create the Intune or Intune PKCS third-party connector.
3. Create or update the PKI connector used to issue the certificate.
4. Create or update the `intune` or `intunepkcs` profile that references both connector names.

## Common Failure Points

- Using `tenant` instead of `azureTenant` on recent Horizon versions.
- Creating the profile before the third-party connector exists.
- Forgetting that both Intune variants still need a `pkiConnector`.
- Mixing the `intune` and `intunepkcs` module names.
