/**
 * Embedded resolved request JSON Schema for third-party connectors.
 *
 * Resolved from the bundled OpenAPI. Polymorphic union discriminated by
 * 'type' (15 subtypes). Surfaced verbatim through describe_thirdparty_connector_schema
 * so the model never guesses the per-subtype structure.
 *
 * Server-only fields '_id' and 'tenant' are intentionally NOT part of the
 * request body.
 */
export const thirdpartyConnectorRequestSchema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'https://evertrust.fr/horizon/schemas/thirdparty_connectors.request.json',
  title: 'ThirdPartyConnectors (create/update request body)',
  description:
    "Self-contained resolved request body for POST/PUT /api/v1/thirdparty/connectors. Polymorphic union discriminated by 'type'. Resolved from the bundled OpenAPI, with corrections for required fields. Server-only fields '_id' and 'tenant' are intentionally NOT part of the request body.",
  oneOf: [
    { $ref: '#/$defs/AWSConnector' },
    { $ref: '#/$defs/AzureKeyVaultConnector' },
    { $ref: '#/$defs/F5AS3Connector' },
    { $ref: '#/$defs/F5ClientConnector' },
    { $ref: '#/$defs/GCMConnector' },
    { $ref: '#/$defs/IntuneConnector' },
    { $ref: '#/$defs/IntunePKCSConnector' },
    { $ref: '#/$defs/JamfConnector' },
    { $ref: '#/$defs/LDAPConnector' },
    { $ref: '#/$defs/MSADConnector' },
    { $ref: '#/$defs/NetscalerConnector' },
    { $ref: '#/$defs/FortiGateConnector' },
    { $ref: '#/$defs/FortiManagerConnector' },
    { $ref: '#/$defs/PanOSFirewallConnector' },
    { $ref: '#/$defs/PanoramaConnector' },
  ],
  $defs: {
    FiniteDuration: {
      type: 'string',
      description: "Finite Duration string, e.g. '5 seconds'.",
      pattern:
        '^([0-9]+) *(ms|millisecond|milliseconds|s|second|seconds|m|minute|minutes|h|hour|hours|d|day|days)$',
      examples: ['5 seconds'],
    },
    RetryParameters: {
      type: 'object',
      title: 'Retry Parameters',
      description:
        'Retry policy for failed asynchronous jobs, with an exponential backoff.',
      additionalProperties: false,
      required: ['attempts', 'minBackoff', 'maxBackoff', 'randomFactor'],
      properties: {
        attempts: {
          type: 'integer',
          description:
            'Maximum number of retry attempts before the job is considered failed.',
          examples: [10],
        },
        minBackoff: {
          allOf: [{ $ref: '#/$defs/FiniteDuration' }],
          description: 'Minimum delay to wait before the first retry.',
          examples: ['10 seconds'],
        },
        maxBackoff: {
          allOf: [{ $ref: '#/$defs/FiniteDuration' }],
          description:
            'Maximum delay between two retries, capping the exponential backoff.',
          examples: ['60 seconds'],
        },
        randomFactor: {
          type: 'number',
          description:
            'Random jitter factor added to each backoff delay (e.g. 0.1 adds up to 10%).',
          examples: [0.1],
        },
      },
    },
    AWSConnector: {
      type: 'object',
      title: 'AWS',
      additionalProperties: false,
      required: ['type', 'name', 'throttleDuration', 'region'],
      properties: {
        type: { const: 'aws' },
        name: {
          type: 'string',
          description: 'Unique identifier; it cannot change after creation.',
        },
        throttleDuration: { $ref: '#/$defs/FiniteDuration' },
        timeout: {
          oneOf: [{ $ref: '#/$defs/FiniteDuration' }, { type: 'null' }],
        },
        proxy: {
          type: ['string', 'null'],
          description: 'Name of an HTTP proxy config.',
        },
        region: { type: 'string' },
        credentials: {
          type: ['string', 'null'],
          description:
            'Name of a password credential (Access Key Id + Secret). Optional: env fallback.',
        },
        resourceGroupName: { type: ['string', 'null'] },
        roleArn: { type: ['string', 'null'] },
        tagKey: { type: ['string', 'null'] },
        tagValue: { type: ['string', 'null'] },
      },
    },
    AzureKeyVaultConnector: {
      type: 'object',
      title: 'Azure Key Vault',
      additionalProperties: false,
      required: [
        'type',
        'name',
        'throttleDuration',
        'throttleParallelism',
        'azureTenant',
        'credentials',
        'vaultBaseUrl',
      ],
      properties: {
        type: { const: 'akv' },
        name: {
          type: 'string',
          description: 'Unique identifier; it cannot change after creation.',
        },
        throttleDuration: { $ref: '#/$defs/FiniteDuration' },
        throttleParallelism: { type: 'integer' },
        timeout: {
          oneOf: [{ $ref: '#/$defs/FiniteDuration' }, { type: 'null' }],
        },
        proxy: { type: ['string', 'null'] },
        azureTenant: { type: 'string' },
        appId: {
          type: ['string', 'null'],
          description:
            "Must be absent for password credentials, present for 'credentials' type. Absent from OpenAPI.",
        },
        credentials: {
          type: 'string',
          description:
            'Name of a password/credentials credential (App ID + Key).',
        },
        vaultBaseUrl: { type: 'string' },
        prefix: { type: ['string', 'null'] },
      },
    },
    F5AS3Connector: {
      type: 'object',
      title: 'F5 AS3',
      additionalProperties: false,
      required: [
        'type',
        'name',
        'throttleDuration',
        'throttleParallelism',
        'hostname',
        'credentials',
      ],
      properties: {
        type: { const: 'f5as3' },
        name: {
          type: 'string',
          description: 'Unique identifier; it cannot change after creation.',
        },
        throttleDuration: { $ref: '#/$defs/FiniteDuration' },
        throttleParallelism: { type: 'integer' },
        timeout: {
          oneOf: [{ $ref: '#/$defs/FiniteDuration' }, { type: 'null' }],
        },
        proxy: { type: ['string', 'null'] },
        hostname: { type: 'string' },
        credentials: { type: 'string' },
        loginProvider: { type: ['string', 'null'] },
        tlsInsecure: { type: 'boolean', default: false },
        withChain: { type: 'boolean', default: true },
      },
    },
    F5ClientConnector: {
      type: 'object',
      title: 'F5',
      additionalProperties: false,
      required: [
        'type',
        'name',
        'throttleDuration',
        'throttleParallelism',
        'maxStoredCertificatePerHolder',
        'bigIPHostname',
        'credentials',
      ],
      properties: {
        type: { const: 'f5client' },
        name: {
          type: 'string',
          description: 'Unique identifier; it cannot change after creation.',
        },
        throttleDuration: { $ref: '#/$defs/FiniteDuration' },
        throttleParallelism: { type: 'integer' },
        timeout: {
          oneOf: [{ $ref: '#/$defs/FiniteDuration' }, { type: 'null' }],
        },
        proxy: { type: ['string', 'null'] },
        maxStoredCertificatePerHolder: {
          type: 'integer',
          description: 'REQUIRED and must be > 0.',
        },
        bigIPHostname: { type: 'string' },
        credentials: { type: 'string' },
        partition: { type: ['string', 'null'] },
        sslParent: { type: ['string', 'null'] },
        prefix: { type: ['string', 'null'] },
        cipherGroup: { type: ['string', 'null'] },
        version: { type: ['string', 'null'] },
        loginProvider: {
          type: ['string', 'null'],
          description: 'Accepted but not in the OpenAPI.',
        },
        tlsInsecure: { type: 'boolean', default: false },
        overrideProfileConfiguration: {
          type: 'boolean',
          default: true,
          description: 'Accepted but not in the OpenAPI.',
        },
        persistConfiguration: {
          type: 'boolean',
          default: false,
          description:
            'Horizon 2.11+. When true, Horizon saves the F5 running configuration to bigip.conf after each successful deployment, so the changes stay after an appliance reboot. Needs an admin-level F5 technical account.',
        },
      },
    },
    GCMConnector: {
      type: 'object',
      title: 'GCM',
      additionalProperties: false,
      required: [
        'type',
        'name',
        'throttleDuration',
        'credentials',
        'project',
        'location',
      ],
      properties: {
        type: { const: 'gcm' },
        name: {
          type: 'string',
          description: 'Unique identifier; it cannot change after creation.',
        },
        throttleDuration: { $ref: '#/$defs/FiniteDuration' },
        timeout: {
          oneOf: [{ $ref: '#/$defs/FiniteDuration' }, { type: 'null' }],
        },
        proxy: { type: ['string', 'null'] },
        credentials: {
          type: 'string',
          description: "Name of a 'raw' credential (User Account).",
        },
        project: { type: 'string' },
        location: { type: 'string' },
        tagKey: { type: ['string', 'null'] },
        tagValue: { type: ['string', 'null'] },
      },
    },
    IntuneConnector: {
      type: 'object',
      title: 'Intune',
      additionalProperties: false,
      required: [
        'type',
        'name',
        'throttleDuration',
        'throttleParallelism',
        'azureTenant',
        'credentials',
        'legacyRevocationMode',
      ],
      properties: {
        type: { const: 'intune' },
        name: {
          type: 'string',
          description: 'Unique identifier; it cannot change after creation.',
        },
        throttleDuration: { $ref: '#/$defs/FiniteDuration' },
        throttleParallelism: { type: 'integer' },
        timeout: {
          oneOf: [{ $ref: '#/$defs/FiniteDuration' }, { type: 'null' }],
        },
        proxy: { type: ['string', 'null'] },
        azureTenant: { type: 'string' },
        appId: {
          type: ['string', 'null'],
          description:
            "Must be absent for password credentials, present for 'credentials' type. Absent from OpenAPI.",
        },
        credentials: { type: 'string' },
        intuneResourceUrl: { type: ['string', 'null'] },
        osQueryString: { type: ['string', 'null'] },
        legacyRevocationMode: { type: 'boolean' },
      },
    },
    IntunePKCSConnector: {
      type: 'object',
      title: 'Intune PKCS',
      additionalProperties: false,
      required: [
        'type',
        'name',
        'throttleDuration',
        'throttleParallelism',
        'maxStoredCertificatePerHolder',
        'azureTenant',
        'credentials',
        'pubKey',
        'keyName',
      ],
      properties: {
        type: { const: 'intunepkcs' },
        name: {
          type: 'string',
          description: 'Unique identifier; it cannot change after creation.',
        },
        throttleDuration: { $ref: '#/$defs/FiniteDuration' },
        throttleParallelism: { type: 'integer' },
        timeout: {
          oneOf: [{ $ref: '#/$defs/FiniteDuration' }, { type: 'null' }],
        },
        maxStoredCertificatePerHolder: {
          type: 'integer',
          description: 'REQUIRED and must be > 0.',
        },
        proxy: { type: ['string', 'null'] },
        azureTenant: { type: 'string' },
        appId: {
          type: ['string', 'null'],
          description:
            "Must be absent for password credentials, present for 'credentials' type. Absent from OpenAPI.",
        },
        credentials: { type: 'string' },
        pubKey: { type: 'string' },
        keyName: { type: 'string' },
        providerName: { type: ['string', 'null'] },
        intendedPurpose: { type: ['string', 'null'] },
        searchFilter: { type: ['string', 'null'] },
      },
    },
    JamfConnector: {
      type: 'object',
      title: 'JAMF',
      additionalProperties: false,
      required: [
        'type',
        'name',
        'throttleDuration',
        'throttleParallelism',
        'endpoint',
        'credentials',
      ],
      properties: {
        type: { const: 'jamf' },
        name: {
          type: 'string',
          description: 'Unique identifier; it cannot change after creation.',
        },
        throttleDuration: { $ref: '#/$defs/FiniteDuration' },
        throttleParallelism: { type: 'integer' },
        timeout: {
          oneOf: [{ $ref: '#/$defs/FiniteDuration' }, { type: 'null' }],
        },
        proxy: { type: ['string', 'null'] },
        endpoint: { type: 'string' },
        credentials: { type: 'string' },
      },
    },
    LDAPConnector: {
      type: 'object',
      title: 'LDAP',
      additionalProperties: false,
      required: [
        'type',
        'name',
        'throttleDuration',
        'throttleParallelism',
        'maxStoredCertificatePerHolder',
        'hostname',
        'credentials',
        'baseDn',
        'userIdentifierAttribute',
        'certificateAttribute',
      ],
      properties: {
        type: { const: 'ldappub' },
        name: {
          type: 'string',
          description: 'Unique identifier; it cannot change after creation.',
        },
        throttleDuration: { $ref: '#/$defs/FiniteDuration' },
        throttleParallelism: { type: 'integer' },
        timeout: {
          oneOf: [{ $ref: '#/$defs/FiniteDuration' }, { type: 'null' }],
        },
        maxStoredCertificatePerHolder: {
          type: 'integer',
          description: 'REQUIRED and must be > 0.',
        },
        proxy: { type: ['string', 'null'] },
        hostname: { type: 'string' },
        port: { type: ['integer', 'null'] },
        credentials: {
          type: 'string',
          description: 'Name of a password credential (login DN + password).',
        },
        baseDn: { type: 'string' },
        filter: { type: ['string', 'null'] },
        certAttr: { type: ['string', 'null'] },
        followReferrals: { type: ['boolean', 'null'] },
        createEntry: {
          type: ['boolean', 'null'],
          description: 'Accepted but not in the OpenAPI.',
        },
        userIdentifierAttribute: {
          type: 'string',
          enum: ['CN', 'MAIL', 'UID'],
        },
        certificateAttribute: {
          type: 'string',
          description: 'Must be a supported DN element or SAN type.',
          enum: [
            'CN',
            'UID',
            'SERIALNUMBER',
            'SURNAME',
            'GIVENNAME',
            'T',
            'UNSTRUCTUREDADDRESS',
            'UNSTRUCTUREDNAME',
            'E',
            'OU',
            'ORGANIZATIONIDENTIFIER',
            'PSEUDONYM',
            'UNIQUEIDENTIFIER',
            'STREET',
            'ST',
            'L',
            'O',
            'C',
            'DESCRIPTION',
            'DC',
            'VID',
            'PID',
            'NODEID',
            'FWSIGNINGID',
            'ICACID',
            'RCACID',
            'FABRICID',
            'NOCCAT',
            'RFC822NAME',
            'DNSNAME',
            'URI',
            'IPADDRESS',
            'OTHERNAME_UPN',
            'OTHERNAME_GUID',
            'REGISTERED_ID',
          ],
        },
        tlsInsecure: { type: 'boolean', default: false },
      },
    },
    MSADConnector: {
      type: 'object',
      title: 'Microsoft Active Directory',
      additionalProperties: false,
      required: [
        'type',
        'name',
        'throttleDuration',
        'throttleParallelism',
        'hostname',
        'credentials',
        'baseDn',
      ],
      properties: {
        type: { const: 'msad' },
        name: {
          type: 'string',
          description: 'Unique identifier; it cannot change after creation.',
        },
        throttleDuration: { $ref: '#/$defs/FiniteDuration' },
        throttleParallelism: { type: 'integer' },
        timeout: {
          oneOf: [{ $ref: '#/$defs/FiniteDuration' }, { type: 'null' }],
        },
        maxStoredCertificatePerHolder: { type: ['integer', 'null'] },
        proxy: { type: ['string', 'null'] },
        hostname: { type: 'string' },
        port: { type: ['integer', 'null'] },
        credentials: { type: 'string' },
        baseDn: { type: 'string' },
        filter: { type: ['string', 'null'] },
        tlsInsecure: { type: 'boolean', default: false },
      },
    },
    NetscalerConnector: {
      type: 'object',
      title: 'Netscaler',
      additionalProperties: false,
      required: [
        'type',
        'name',
        'throttleDuration',
        'throttleParallelism',
        'timeout',
        'maxStoredCertificatePerHolder',
        'prefix',
        'hostname',
        'credentials',
      ],
      properties: {
        type: { const: 'netscaler' },
        name: {
          type: 'string',
          description: 'Unique identifier; it cannot change after creation.',
        },
        throttleDuration: { $ref: '#/$defs/FiniteDuration' },
        throttleParallelism: { type: 'integer' },
        renewalPeriod: {
          oneOf: [{ $ref: '#/$defs/FiniteDuration' }, { type: 'null' }],
        },
        timeout: {
          allOf: [{ $ref: '#/$defs/FiniteDuration' }],
          description: 'MANDATORY for netscaler; must be > 0.',
        },
        proxy: { type: ['string', 'null'] },
        maxStoredCertificatePerHolder: {
          type: 'integer',
          description: 'REQUIRED and must be > 0.',
        },
        prefix: {
          type: 'string',
          description: 'Required (the OpenAPI marks it nullable).',
        },
        hostname: { type: 'string' },
        credentials: { type: 'string' },
        certificateStorePath: {
          type: ['string', 'null'],
          default: '/nsconfig/ssl',
          description:
            'Optional on Horizon 2.11+ (default /nsconfig/ssl). Horizon 2.10 requires it.',
        },
        tlsInsecure: { type: 'boolean', default: false },
      },
    },
    FortiGateConnector: {
      type: 'object',
      title: 'FortiGate',
      description: 'Horizon 2.11+.',
      additionalProperties: false,
      required: [
        'type',
        'name',
        'throttleDuration',
        'throttleParallelism',
        'timeout',
        'hostname',
        'credentials',
        'prefix',
      ],
      properties: {
        type: { const: 'fortigate' },
        name: {
          type: 'string',
          description: 'Unique identifier; it cannot change after creation.',
        },
        throttleDuration: { $ref: '#/$defs/FiniteDuration' },
        throttleParallelism: { type: 'integer' },
        timeout: { $ref: '#/$defs/FiniteDuration' },
        proxy: { type: ['string', 'null'] },
        hostname: {
          type: 'string',
          description: 'Hostname or URL of the FortiGate appliance.',
        },
        credentials: {
          type: 'string',
          description:
            'Name of the raw credentials that hold the FortiGate REST API key.',
        },
        certificateCredentials: {
          type: ['string', 'null'],
          description:
            'Optional name of the certificate credentials used for mutual TLS in addition to the API key.',
        },
        prefix: {
          type: 'string',
          description:
            'Certificate name prefix used when deploying certificates.',
        },
        tlsInsecure: { type: ['boolean', 'null'], default: false },
        vdom: {
          type: ['string', 'null'],
          description:
            'Virtual domain to deploy to. When absent, the certificate is imported in the global scope.',
        },
      },
    },
    FortiManagerConnector: {
      type: 'object',
      title: 'FortiManager',
      description: 'Horizon 2.11+.',
      additionalProperties: false,
      required: [
        'type',
        'name',
        'throttleDuration',
        'throttleParallelism',
        'timeout',
        'hostname',
        'credentials',
        'prefix',
        'target',
        'jobRetryParameters',
      ],
      properties: {
        type: { const: 'fortimanager' },
        name: {
          type: 'string',
          description: 'Unique identifier; it cannot change after creation.',
        },
        throttleDuration: { $ref: '#/$defs/FiniteDuration' },
        throttleParallelism: { type: 'integer' },
        timeout: { $ref: '#/$defs/FiniteDuration' },
        proxy: { type: ['string', 'null'] },
        hostname: {
          type: 'string',
          description: 'Hostname or URL of the FortiManager appliance.',
        },
        credentials: {
          type: 'string',
          description:
            'Name of the password credentials of the FortiManager account.',
        },
        prefix: {
          type: 'string',
          description:
            'Certificate name prefix used when deploying certificates.',
        },
        tlsInsecure: { type: ['boolean', 'null'], default: false },
        target: {
          type: 'string',
          enum: ['unit', 'device'],
          description:
            "unit deploys to the FortiManager unit's own certificate store. device deploys to a FortiGate device that the FortiManager manages. device requires managedDevice; with unit, omit managedDevice.",
        },
        managedDevice: {
          type: ['object', 'null'],
          description:
            'The managed FortiGate device. Required when target is device.',
          additionalProperties: false,
          required: ['adom', 'device', 'vdom'],
          properties: {
            adom: {
              type: 'string',
              description: 'Administrative domain of the device.',
            },
            device: { type: 'string', description: 'Managed device name.' },
            vdom: {
              type: 'string',
              description: 'Virtual domain on the managed device.',
            },
            synchronizeDevices: {
              type: 'boolean',
              default: false,
              description:
                'Install the configuration on the device after the import.',
            },
          },
        },
        jobRetryParameters: {
          allOf: [{ $ref: '#/$defs/RetryParameters' }],
          description:
            'Retry policy for the asynchronous deployment jobs of this connector.',
        },
      },
    },
    PanOSFirewallConnector: {
      type: 'object',
      title: 'PAN-OS Firewall',
      description: 'Horizon 2.11+.',
      additionalProperties: false,
      required: [
        'type',
        'name',
        'throttleDuration',
        'throttleParallelism',
        'timeout',
        'hostname',
        'credentials',
        'prefix',
        'jobRetryParameters',
      ],
      properties: {
        type: { const: 'panos_firewall' },
        name: {
          type: 'string',
          description: 'Unique identifier; it cannot change after creation.',
        },
        throttleDuration: { $ref: '#/$defs/FiniteDuration' },
        throttleParallelism: { type: 'integer' },
        timeout: { $ref: '#/$defs/FiniteDuration' },
        proxy: { type: ['string', 'null'] },
        hostname: {
          type: 'string',
          description: 'Hostname or URL of the PAN-OS firewall.',
        },
        credentials: {
          type: 'string',
          description:
            'Name of the password credentials of the firewall account.',
        },
        prefix: {
          type: 'string',
          description:
            'Certificate name prefix used when deploying certificates.',
        },
        tlsInsecure: { type: ['boolean', 'null'], default: false },
        vsys: {
          type: ['string', 'null'],
          description: 'Virtual system name, for multi-VSYS firewalls.',
        },
        jobRetryParameters: {
          allOf: [{ $ref: '#/$defs/RetryParameters' }],
          description:
            'Retry policy for the asynchronous deployment jobs of this connector.',
        },
      },
    },
    PanoramaConnector: {
      type: 'object',
      title: 'PAN-OS Panorama',
      description: 'Horizon 2.11+.',
      additionalProperties: false,
      required: [
        'type',
        'name',
        'throttleDuration',
        'throttleParallelism',
        'timeout',
        'hostname',
        'credentials',
        'prefix',
        'jobRetryParameters',
      ],
      properties: {
        type: { const: 'panos_panorama' },
        name: {
          type: 'string',
          description: 'Unique identifier; it cannot change after creation.',
        },
        throttleDuration: { $ref: '#/$defs/FiniteDuration' },
        throttleParallelism: { type: 'integer' },
        timeout: { $ref: '#/$defs/FiniteDuration' },
        proxy: { type: ['string', 'null'] },
        hostname: {
          type: 'string',
          description: 'Hostname or URL of the Panorama appliance.',
        },
        credentials: {
          type: 'string',
          description:
            'Name of the password credentials of the Panorama account.',
        },
        prefix: {
          type: 'string',
          description:
            'Certificate name prefix used when deploying certificates.',
        },
        tlsInsecure: { type: ['boolean', 'null'], default: false },
        templateStack: {
          type: ['string', 'null'],
          description:
            'Name of the Panorama template stack to push changes to.',
        },
        template: {
          type: ['string', 'null'],
          description: 'Name of the Panorama template to push certificates to.',
        },
        vsys: {
          type: ['string', 'null'],
          description:
            'Virtual system name inside the template. Requires template.',
        },
        synchronizeDevices: {
          type: ['boolean', 'null'],
          default: false,
          description:
            'Commit the configuration to the devices that Panorama manages after the certificate push.',
        },
        jobRetryParameters: {
          allOf: [{ $ref: '#/$defs/RetryParameters' }],
          description:
            'Retry policy for the asynchronous deployment jobs of this connector.',
        },
      },
    },
  },
} as const;
