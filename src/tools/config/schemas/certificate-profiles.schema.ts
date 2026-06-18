/**
 * Embedded request JSON Schema for Certificate Profiles (polymorphic).
 *
 * Build-time constant mirroring docs/audit/certificate_profiles.schema.json.
 * Surfaced verbatim by `describe_certificate_profile_schema` so the model can
 * build a correct body before create_certificate_profile /
 * update_certificate_profile.
 *
 * Polymorphic: a oneOf over 11 documented subtypes discriminated by the
 * lowercase string field `module` (acme, acme-external, est, scep, wcce, webra,
 * crmp, intune, intunepkcs, jamf, monitored). Server-populated fields _id and
 * tenant are ignored/stripped on write. Names are the primary key and immutable;
 * module is also immutable after creation.
 */
export const certificateProfileRequestSchema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  title:
    'CertificateProfiles (request body) - create (POST /api/v1/certificate/profiles) and update (PUT /api/v1/certificate/profiles)',
  description:
    'Polymorphic certificate profile request body. Discriminated by the lowercase string field "module". One of 11 documented subtypes (OpenAPI). The server JSON Reads additionally accepts module=aws and module=f5client (AWSProfile/F5ClientProfile) which are NOT documented in OpenAPI. Server-populated fields _id and tenant are ignored/stripped on read.',
  oneOf: [
    {
      $ref: '#/$defs/AcmeProfile',
    },
    {
      $ref: '#/$defs/EstProfile',
    },
    {
      $ref: '#/$defs/IntuneProfile',
    },
    {
      $ref: '#/$defs/JamfProfile',
    },
    {
      $ref: '#/$defs/ScepProfile',
    },
    {
      $ref: '#/$defs/WcceProfile',
    },
    {
      $ref: '#/$defs/WebRAProfile',
    },
    {
      $ref: '#/$defs/IntunePKCSProfile',
    },
    {
      $ref: '#/$defs/AcmeExternalProfile',
    },
    {
      $ref: '#/$defs/CrmpProfile',
    },
    {
      $ref: '#/$defs/MonitoredProfile',
    },
  ],
  discriminator: {
    propertyName: 'module',
    mapping: {
      acme: '#/$defs/AcmeProfile',
      est: '#/$defs/EstProfile',
      intune: '#/$defs/IntuneProfile',
      jamf: '#/$defs/JamfProfile',
      scep: '#/$defs/ScepProfile',
      wcce: '#/$defs/WcceProfile',
      webra: '#/$defs/WebRAProfile',
      intunepkcs: '#/$defs/IntunePKCSProfile',
      'acme-external': '#/$defs/AcmeExternalProfile',
      crmp: '#/$defs/CrmpProfile',
      monitored: '#/$defs/MonitoredProfile',
    },
  },
  $defs: {
    AcmeProfile: {
      title: 'ACME Profile',
      properties: {
        module: {
          type: 'string',
          enum: ['acme'],
        },
        name: {
          type: 'string',
        },
        displayName: {
          type: 'array',
          nullable: true,
          items: {
            $ref: '#/$defs/LocalizedString',
          },
        },
        description: {
          type: 'array',
          nullable: true,
          items: {
            $ref: '#/$defs/LocalizedString',
          },
        },
        enabled: {
          type: 'boolean',
        },
        timeout: {
          type: 'string',
          format: 'Finite Duration',
          pattern:
            '^([0-9]+) *(ms|millisecond|milliseconds|s|second|seconds|m|minute|minutes|h|hour|hours|d|day|days)$',
          example: '5 seconds',
        },
        meta: {
          nullable: true,
          type: 'object',
          allOf: [
            {
              $ref: '#/$defs/DirectoryMeta',
            },
          ],
        },
        constraints: {
          nullable: true,
          type: 'object',
          allOf: [
            {
              $ref: '#/$defs/CertificateRequestConstraints',
            },
          ],
        },
        authorizationMethods: {
          type: 'array',
          nullable: true,
          items: {
            type: 'string',
          },
        },
        pkiConnector: {
          type: 'string',
        },
        http01Port: {
          type: 'integer',
          format: 'int32',
          nullable: true,
        },
        tlsAlpn01Port: {
          type: 'integer',
          format: 'int32',
          nullable: true,
        },
        authorizeShortName: {
          type: 'boolean',
        },
        authorizeEmptyContact: {
          type: 'boolean',
        },
        defaultContacts: {
          type: 'array',
          nullable: true,
          items: {
            type: 'string',
          },
        },
        verifyRetryCount: {
          type: 'integer',
          format: 'int32',
        },
        verifyRetryDelay: {
          type: 'string',
          format: 'Finite Duration',
          pattern:
            '^([0-9]+) *(ms|millisecond|milliseconds|s|second|seconds|m|minute|minutes|h|hour|hours|d|day|days)$',
          example: '5 seconds',
        },
        requireTermsOfService: {
          type: 'boolean',
        },
        renewalPeriod: {
          nullable: true,
          type: 'string',
          format: 'Finite Duration',
          pattern:
            '^([0-9]+) *(ms|millisecond|milliseconds|s|second|seconds|m|minute|minutes|h|hour|hours|d|day|days)$',
          example: '5 seconds',
        },
        csrDataMapping: {
          nullable: true,
          type: 'object',
          additionalProperties: {
            type: 'string',
          },
        },
        maxCertificatePerHolderPolicy: {
          nullable: true,
          type: 'object',
          allOf: [
            {
              $ref: '#/$defs/MaxCertificatePerHolderPolicy',
            },
          ],
        },
        maxDnsName: {
          type: 'integer',
          format: 'int32',
          nullable: true,
        },
        proxy: {
          type: 'string',
          nullable: true,
        },
        authorizationLevels: {
          allOf: [
            {
              $ref: '#/$defs/CertificateProfileAuthorizationLevels',
            },
          ],
        },
        triggers: {
          nullable: true,
          type: 'object',
          allOf: [
            {
              $ref: '#/$defs/CertificateProfileTriggers',
            },
          ],
        },
        requestsPolicy: {
          allOf: [
            {
              $ref: '#/$defs/RequestsPolicy',
            },
          ],
        },
        selfPermissions: {
          allOf: [
            {
              $ref: '#/$defs/CertificateProfileSelfPermissions',
            },
          ],
        },
        certificateTemplate: {
          nullable: true,
          type: 'object',
          allOf: [
            {
              $ref: '#/$defs/CertificateTemplate',
            },
          ],
        },
        cryptoPolicy: {
          allOf: [
            {
              $ref: '#/$defs/ManagedCertificateProfileCryptoPolicy',
            },
          ],
        },
        gradingPolicies: {
          type: 'array',
          nullable: true,
          items: {
            type: 'string',
          },
        },
        dsFlow: {
          nullable: true,
          allOf: [
            {
              $ref: '#/$defs/DataSourceFlow',
            },
          ],
        },
        thirdPartyDiscoverySync: {
          nullable: true,
          default: false,
          type: 'boolean',
          description: 'Available from `2.8.2`',
        },
      },
      required: [
        'module',
        'name',
        'enabled',
        'timeout',
        'pkiConnector',
        'authorizeShortName',
        'authorizeEmptyContact',
        'verifyRetryCount',
        'verifyRetryDelay',
        'requireTermsOfService',
        'authorizationLevels',
        'requestsPolicy',
        'selfPermissions',
        'cryptoPolicy',
      ],
    },
    LocalizedString: {
      title: 'LocalizedString',
      properties: {
        lang: {
          description:
            'The ISO 3166-1 (2-letters) code of the language used for the value',
          example: 'en',
          type: 'string',
        },
        value: {
          description: 'The localized value',
          example: 'Value In English',
          type: 'string',
        },
      },
      required: ['lang', 'value'],
    },
    DirectoryMeta: {
      properties: {
        termsOfService: {
          type: 'string',
          nullable: true,
        },
        website: {
          type: 'string',
          nullable: true,
        },
        caaIdentities: {
          type: 'array',
          nullable: true,
          items: {
            type: 'string',
          },
        },
        externalAccountRequired: {
          type: 'boolean',
          nullable: true,
        },
      },
    },
    CertificateRequestConstraints: {
      properties: {
        allowedDomains: {
          type: 'string',
          nullable: true,
        },
        allowedEmailDomains: {
          type: 'string',
          nullable: true,
        },
        allowedDnsDomains: {
          type: 'string',
          nullable: true,
        },
      },
    },
    MaxCertificatePerHolderPolicy: {
      properties: {
        max: {
          type: 'integer',
          format: 'int32',
        },
        behavior: {
          type: 'string',
          enum: ['revoke', 'reject'],
        },
        revocationReason: {
          allOf: [
            {
              $ref: '#/$defs/RevocationReason',
            },
          ],
          nullable: true,
        },
      },
      required: ['max', 'behavior'],
    },
    RevocationReason: {
      title: 'Revocation Reason',
      type: 'string',
      description:
        'One of: `unspecified`, `keycompromise`, `cacompromise`, `affiliationchange`, `superseded`, `cessationofoperation`',
    },
    CertificateProfileAuthorizationLevels: {
      properties: {
        enroll: {
          nullable: true,
          type: 'object',
          allOf: [
            {
              $ref: '#/$defs/AuthorizationLevel',
            },
          ],
        },
        enrollApi: {
          nullable: true,
          type: 'object',
          allOf: [
            {
              $ref: '#/$defs/AuthorizationLevel',
            },
          ],
        },
        requestEnroll: {
          nullable: true,
          type: 'object',
          allOf: [
            {
              $ref: '#/$defs/AuthorizationLevel',
            },
          ],
        },
        approveEnroll: {
          nullable: true,
          type: 'object',
          allOf: [
            {
              $ref: '#/$defs/AuthorizationLevel',
            },
          ],
        },
        revoke: {
          allOf: [
            {
              $ref: '#/$defs/AuthorizationLevel',
            },
          ],
        },
        requestRevoke: {
          allOf: [
            {
              $ref: '#/$defs/AuthorizationLevel',
            },
          ],
        },
        approveRevoke: {
          allOf: [
            {
              $ref: '#/$defs/AuthorizationLevel',
            },
          ],
        },
        search: {
          allOf: [
            {
              $ref: '#/$defs/AuthorizationLevel',
            },
          ],
        },
        update: {
          allOf: [
            {
              $ref: '#/$defs/AuthorizationLevel',
            },
          ],
        },
        requestUpdate: {
          allOf: [
            {
              $ref: '#/$defs/AuthorizationLevel',
            },
          ],
        },
        approveUpdate: {
          allOf: [
            {
              $ref: '#/$defs/AuthorizationLevel',
            },
          ],
        },
        recover: {
          type: 'object',
          nullable: true,
          allOf: [
            {
              $ref: '#/$defs/AuthorizationLevel',
            },
          ],
        },
        recoverApi: {
          type: 'object',
          nullable: true,
          allOf: [
            {
              $ref: '#/$defs/AuthorizationLevel',
            },
          ],
        },
        requestRecover: {
          type: 'object',
          nullable: true,
          allOf: [
            {
              $ref: '#/$defs/AuthorizationLevel',
            },
          ],
        },
        approveRecover: {
          type: 'object',
          nullable: true,
          allOf: [
            {
              $ref: '#/$defs/AuthorizationLevel',
            },
          ],
        },
        migrate: {
          type: 'object',
          nullable: true,
          allOf: [
            {
              $ref: '#/$defs/AuthorizationLevel',
            },
          ],
        },
        requestMigrate: {
          type: 'object',
          nullable: true,
          allOf: [
            {
              $ref: '#/$defs/AuthorizationLevel',
            },
          ],
        },
        approveMigrate: {
          type: 'object',
          nullable: true,
          allOf: [
            {
              $ref: '#/$defs/AuthorizationLevel',
            },
          ],
        },
        renew: {
          type: 'object',
          nullable: true,
          allOf: [
            {
              $ref: '#/$defs/AuthorizationLevel',
            },
          ],
        },
        renewApi: {
          type: 'object',
          nullable: true,
          allOf: [
            {
              $ref: '#/$defs/AuthorizationLevel',
            },
          ],
        },
        requestRenew: {
          type: 'object',
          nullable: true,
          allOf: [
            {
              $ref: '#/$defs/AuthorizationLevel',
            },
          ],
        },
        approveRenew: {
          type: 'object',
          nullable: true,
          allOf: [
            {
              $ref: '#/$defs/AuthorizationLevel',
            },
          ],
        },
        auditRequest: {
          type: 'object',
          nullable: true,
          allOf: [
            {
              $ref: '#/$defs/AuthorizationLevel',
            },
          ],
        },
      },
      required: ['search', 'update', 'requestUpdate', 'approveUpdate'],
    },
    AuthorizationLevel: {
      properties: {
        accessLevel: {
          type: 'string',
          enum: ['everyone', 'authenticated', 'authorized'],
          description: 'The access level required to perform the action',
          example: 'authenticated',
        },
        enforcedIdentityProviders: {
          type: 'array',
          nullable: true,
          items: {
            $ref: '#/$defs/EnforcedIdentityProvider',
          },
          description:
            'The different identity providers that can be enforced to perform the action',
        },
      },
      required: ['accessLevel'],
    },
    EnforcedIdentityProvider: {
      title: 'Enforced identity providers',
      properties: {
        type: {
          type: 'string',
          enum: ['Local', 'OpenId', 'X509', 'Pop'],
          description: 'The type of identity provider to be enforced',
          example: 'Local',
        },
        name: {
          type: 'string',
          description: 'The name of the identity provider to be enforced',
          example: 'local',
        },
      },
      required: ['type', 'name'],
    },
    CertificateProfileTriggers: {
      properties: {
        onEnroll: {
          type: 'array',
          nullable: true,
          items: {
            type: 'string',
          },
        },
        onSubmitEnroll: {
          type: 'array',
          nullable: true,
          items: {
            type: 'string',
          },
        },
        onCancelEnroll: {
          type: 'array',
          nullable: true,
          items: {
            type: 'string',
          },
        },
        onApproveEnroll: {
          type: 'array',
          nullable: true,
          items: {
            type: 'string',
          },
        },
        onDenyEnroll: {
          type: 'array',
          nullable: true,
          items: {
            type: 'string',
          },
        },
        onPendingEnroll: {
          type: 'array',
          nullable: true,
          items: {
            $ref: '#/$defs/CertificateProfileAsynchronousTrigger',
          },
        },
        onRevoke: {
          type: 'array',
          nullable: true,
          items: {
            type: 'string',
          },
        },
        onSubmitRevoke: {
          type: 'array',
          nullable: true,
          items: {
            type: 'string',
          },
        },
        onCancelRevoke: {
          type: 'array',
          nullable: true,
          items: {
            type: 'string',
          },
        },
        onApproveRevoke: {
          type: 'array',
          nullable: true,
          items: {
            type: 'string',
          },
        },
        onDenyRevoke: {
          type: 'array',
          nullable: true,
          items: {
            type: 'string',
          },
        },
        onPendingRevoke: {
          type: 'array',
          nullable: true,
          items: {
            $ref: '#/$defs/CertificateProfileAsynchronousTrigger',
          },
        },
        onUpdate: {
          type: 'array',
          nullable: true,
          items: {
            type: 'string',
          },
        },
        onSubmitUpdate: {
          type: 'array',
          nullable: true,
          items: {
            type: 'string',
          },
        },
        onCancelUpdate: {
          type: 'array',
          nullable: true,
          items: {
            type: 'string',
          },
        },
        onApproveUpdate: {
          type: 'array',
          nullable: true,
          items: {
            type: 'string',
          },
        },
        onDenyUpdate: {
          type: 'array',
          nullable: true,
          items: {
            type: 'string',
          },
        },
        onPendingUpdate: {
          type: 'array',
          nullable: true,
          items: {
            $ref: '#/$defs/CertificateProfileAsynchronousTrigger',
          },
        },
        onRecover: {
          type: 'array',
          nullable: true,
          items: {
            type: 'string',
          },
        },
        onSubmitRecover: {
          type: 'array',
          nullable: true,
          items: {
            type: 'string',
          },
        },
        onCancelRecover: {
          type: 'array',
          nullable: true,
          items: {
            type: 'string',
          },
        },
        onApproveRecover: {
          type: 'array',
          nullable: true,
          items: {
            type: 'string',
          },
        },
        onDenyRecover: {
          type: 'array',
          nullable: true,
          items: {
            type: 'string',
          },
        },
        onPendingRecover: {
          type: 'array',
          nullable: true,
          items: {
            $ref: '#/$defs/CertificateProfileAsynchronousTrigger',
          },
        },
        onMigrate: {
          type: 'array',
          nullable: true,
          items: {
            type: 'string',
          },
        },
        onSubmitMigrate: {
          type: 'array',
          nullable: true,
          items: {
            type: 'string',
          },
        },
        onCancelMigrate: {
          type: 'array',
          nullable: true,
          items: {
            type: 'string',
          },
        },
        onApproveMigrate: {
          type: 'array',
          nullable: true,
          items: {
            type: 'string',
          },
        },
        onDenyMigrate: {
          type: 'array',
          nullable: true,
          items: {
            type: 'string',
          },
        },
        onPendingMigrate: {
          type: 'array',
          nullable: true,
          items: {
            $ref: '#/$defs/CertificateProfileAsynchronousTrigger',
          },
        },
        onExpire: {
          type: 'array',
          nullable: true,
          items: {
            $ref: '#/$defs/CertificateProfileAsynchronousTrigger',
          },
        },
        onRenew: {
          type: 'array',
          nullable: true,
          items: {
            type: 'string',
          },
        },
        onSubmitRenew: {
          type: 'array',
          nullable: true,
          items: {
            type: 'string',
          },
        },
        onCancelRenew: {
          type: 'array',
          nullable: true,
          items: {
            type: 'string',
          },
        },
        onApproveRenew: {
          type: 'array',
          nullable: true,
          items: {
            type: 'string',
          },
        },
        onDenyRenew: {
          type: 'array',
          nullable: true,
          items: {
            type: 'string',
          },
        },
        onPendingRenew: {
          type: 'array',
          nullable: true,
          items: {
            $ref: '#/$defs/CertificateProfileAsynchronousTrigger',
          },
        },
      },
    },
    CertificateProfileAsynchronousTrigger: {
      properties: {
        name: {
          type: 'string',
        },
        activationDate: {
          type: 'integer',
          format: 'epoch',
          nullable: true,
        },
      },
      required: ['name'],
    },
    RequestsPolicy: {
      properties: {
        enroll: {
          nullable: true,
          type: 'string',
          format: 'Finite Duration',
          pattern:
            '^([0-9]+) *(ms|millisecond|milliseconds|s|second|seconds|m|minute|minutes|h|hour|hours|d|day|days)$',
          example: '5 seconds',
        },
        revoke: {
          nullable: true,
          type: 'string',
          format: 'Finite Duration',
          pattern:
            '^([0-9]+) *(ms|millisecond|milliseconds|s|second|seconds|m|minute|minutes|h|hour|hours|d|day|days)$',
          example: '5 seconds',
        },
        recover: {
          nullable: true,
          type: 'string',
          format: 'Finite Duration',
          pattern:
            '^([0-9]+) *(ms|millisecond|milliseconds|s|second|seconds|m|minute|minutes|h|hour|hours|d|day|days)$',
          example: '5 seconds',
        },
        update: {
          nullable: true,
          type: 'string',
          format: 'Finite Duration',
          pattern:
            '^([0-9]+) *(ms|millisecond|milliseconds|s|second|seconds|m|minute|minutes|h|hour|hours|d|day|days)$',
          example: '5 seconds',
        },
        migrate: {
          nullable: true,
          type: 'string',
          format: 'Finite Duration',
          pattern:
            '^([0-9]+) *(ms|millisecond|milliseconds|s|second|seconds|m|minute|minutes|h|hour|hours|d|day|days)$',
          example: '5 seconds',
        },
        renew: {
          nullable: true,
          type: 'string',
          format: 'Finite Duration',
          pattern:
            '^([0-9]+) *(ms|millisecond|milliseconds|s|second|seconds|m|minute|minutes|h|hour|hours|d|day|days)$',
          example: '5 seconds',
        },
      },
    },
    CertificateProfileSelfPermissions: {
      properties: {
        selfRecover: {
          type: 'boolean',
          nullable: true,
          default: false,
        },
        selfUpdate: {
          type: 'boolean',
          nullable: true,
          default: false,
        },
        selfRevoke: {
          type: 'boolean',
          nullable: true,
          default: false,
        },
        selfRenew: {
          type: 'boolean',
          nullable: true,
          default: false,
        },
        selfPopRenew: {
          type: 'boolean',
          nullable: true,
          default: false,
        },
        selfPopRevoke: {
          type: 'boolean',
          nullable: true,
          default: false,
        },
        selfPopUpdate: {
          type: 'boolean',
          nullable: true,
          default: false,
        },
      },
    },
    CertificateTemplate: {
      properties: {
        subject: {
          type: 'array',
          nullable: true,
          items: {
            $ref: '#/$defs/DNElement',
          },
        },
        sans: {
          type: 'array',
          nullable: true,
          items: {
            $ref: '#/$defs/SANElement',
          },
        },
        extensions: {
          type: 'array',
          nullable: true,
          items: {
            $ref: '#/$defs/ExtensionElement',
          },
        },
        ownerPolicy: {
          nullable: true,
          type: 'object',
          allOf: [
            {
              $ref: '#/$defs/OwnerPolicy',
            },
          ],
        },
        teamPolicy: {
          nullable: true,
          type: 'object',
          allOf: [
            {
              $ref: '#/$defs/TeamPolicy',
            },
          ],
        },
        metadataPolicies: {
          type: 'array',
          nullable: true,
          items: {
            $ref: '#/$defs/MetadataPolicy',
          },
        },
        labels: {
          type: 'array',
          nullable: true,
          items: {
            $ref: '#/$defs/LabelElement',
          },
        },
        contactEmailPolicy: {
          nullable: true,
          type: 'object',
          allOf: [
            {
              $ref: '#/$defs/ContactEmailPolicy',
            },
          ],
        },
      },
    },
    DNElement: {
      properties: {
        type: {
          type: 'string',
        },
        value: {
          type: 'string',
          nullable: true,
        },
        computationRule: {
          allOf: [
            {
              $ref: '#/$defs/ComputationRule',
            },
          ],
          nullable: true,
        },
        mandatory: {
          type: 'boolean',
        },
        editableByRequester: {
          type: 'boolean',
          nullable: true,
        },
        editableByApprover: {
          type: 'boolean',
          nullable: true,
        },
        regex: {
          type: 'string',
          nullable: true,
        },
      },
      required: ['type', 'mandatory'],
    },
    ComputationRule: {
      title: 'Computation Rule',
      description:
        "A computation rule that will dynamically generate a string value from the request's context",
      externalDocs: {
        description: 'Computation rules guide',
        url: 'https://docs.evertrust.fr/horizon/admin-guide/-/other/template_string',
      },
      type: 'string',
      example: '{{csr.subject.cn.1}}',
    },
    SANElement: {
      properties: {
        type: {
          type: 'string',
          enum: [
            'RFC822NAME',
            'DNSNAME',
            'URI',
            'IPADDRESS',
            'OTHERNAME_UPN',
            'OTHERNAME_GUID',
            'REGISTERED_ID',
          ],
        },
        computationRule: {
          allOf: [
            {
              $ref: '#/$defs/ComputationRule',
            },
          ],
          nullable: true,
        },
        editableByRequester: {
          type: 'boolean',
          nullable: true,
        },
        editableByApprover: {
          type: 'boolean',
          nullable: true,
        },
        regex: {
          type: 'string',
          nullable: true,
        },
        min: {
          type: 'integer',
          format: 'int32',
          nullable: true,
        },
        max: {
          type: 'integer',
          format: 'int32',
          nullable: true,
        },
      },
      required: ['type'],
    },
    ExtensionElement: {
      properties: {
        type: {
          type: 'string',
          enum: ['ms_sid', 'ms_template', 'ms_template_v2'],
        },
        value: {
          type: 'string',
          nullable: true,
        },
        computationRule: {
          allOf: [
            {
              $ref: '#/$defs/ComputationRule',
            },
          ],
          nullable: true,
        },
        mandatory: {
          type: 'boolean',
        },
        editableByRequester: {
          type: 'boolean',
          nullable: true,
        },
        editableByApprover: {
          type: 'boolean',
          nullable: true,
        },
        regex: {
          type: 'string',
          nullable: true,
        },
      },
      required: ['type', 'mandatory'],
    },
    OwnerPolicy: {
      properties: {
        editableByRequester: {
          type: 'boolean',
        },
        editableByApprover: {
          type: 'boolean',
        },
        computationRule: {
          allOf: [
            {
              $ref: '#/$defs/ComputationRule',
            },
          ],
          nullable: true,
        },
        mandatory: {
          type: 'boolean',
        },
        description: {
          type: 'array',
          nullable: true,
          items: {
            $ref: '#/$defs/LocalizedString',
          },
        },
      },
      required: ['editableByRequester', 'editableByApprover', 'mandatory'],
    },
    TeamPolicy: {
      properties: {
        editableByRequester: {
          type: 'boolean',
        },
        editableByApprover: {
          type: 'boolean',
        },
        regex: {
          type: 'string',
          nullable: true,
        },
        whitelist: {
          type: 'array',
          nullable: true,
          items: {
            type: 'string',
          },
        },
        value: {
          type: 'string',
          nullable: true,
        },
        computationRule: {
          allOf: [
            {
              $ref: '#/$defs/ComputationRule',
            },
          ],
          nullable: true,
        },
        mandatory: {
          type: 'boolean',
        },
        description: {
          type: 'array',
          nullable: true,
          items: {
            $ref: '#/$defs/LocalizedString',
          },
        },
      },
      required: ['editableByRequester', 'editableByApprover', 'mandatory'],
    },
    MetadataPolicy: {
      properties: {
        metadata: {
          type: 'string',
          enum: [
            'gs_order_id',
            'renewed_certificate_id',
            'metapki_id',
            'pki_connector',
            'digicert_id',
            'entrust_id',
            'scep_transid',
            'fcms_id',
            'previous_certificate_id',
            'gsatlas_id',
            'certeurope_id',
            'digicert_order_id',
            'automation_policy',
            'contact_email',
          ],
        },
        editableByRequester: {
          type: 'boolean',
        },
        editableByApprover: {
          type: 'boolean',
        },
      },
      required: ['metadata', 'editableByRequester', 'editableByApprover'],
    },
    LabelElement: {
      title: 'Label',
      properties: {
        label: {
          description: 'The name of the label',
          example: 'BU',
          type: 'string',
        },
        value: {
          description: 'The default value of the label element',
          type: 'string',
          nullable: true,
          example: 'business_unit_1',
        },
        computationRule: {
          allOf: [
            {
              $ref: '#/$defs/ComputationRule',
            },
          ],
          description: 'The computation rule of the label element',
          nullable: true,
        },
        mandatory: {
          description:
            'Whether the label element is mandatory to submit a request',
          type: 'boolean',
          nullable: true,
        },
        editableByRequester: {
          description: 'Whether the label element is editable by the requester',
          type: 'boolean',
          nullable: true,
        },
        editableByApprover: {
          description: 'Whether the label element is editable by the approver',
          type: 'boolean',
          nullable: true,
        },
        regex: {
          description: 'The regex used to validate the label element',
          type: 'string',
          nullable: true,
          example: '^.*aregex$',
        },
        enum: {
          description: 'The whitelist used to validate the label element',
          type: 'array',
          nullable: true,
          example: ['business_unit_1', 'business_unit_2'],
          items: {
            type: 'string',
          },
        },
        suggestions: {
          description:
            'The suggestions used to recommend the label element values',
          type: 'array',
          nullable: true,
          example: ['business_unit_2', 'business_unit_3'],
          items: {
            type: 'string',
          },
        },
      },
      required: ['label'],
    },
    ContactEmailPolicy: {
      properties: {
        value: {
          type: 'string',
          nullable: true,
        },
        computationRule: {
          allOf: [
            {
              $ref: '#/$defs/ComputationRule',
            },
          ],
          nullable: true,
        },
        mandatory: {
          type: 'boolean',
        },
        editableByRequester: {
          type: 'boolean',
          nullable: true,
        },
        editableByApprover: {
          type: 'boolean',
          nullable: true,
        },
        regex: {
          type: 'string',
          nullable: true,
        },
        whitelist: {
          type: 'array',
          nullable: true,
          items: {
            type: 'string',
          },
        },
        description: {
          type: 'array',
          nullable: true,
          items: {
            $ref: '#/$defs/LocalizedString',
          },
        },
      },
      required: ['mandatory'],
    },
    ManagedCertificateProfileCryptoPolicy: {
      title: 'Managed Certificate profile crypto policy',
      properties: {
        centralized: {
          description: 'Whether this profile supports centralized enrollment',
          type: 'boolean',
          nullable: true,
          default: false,
        },
        decentralized: {
          description: 'Whether this profile supports decentralized enrollment',
          type: 'boolean',
          nullable: true,
          default: false,
        },
        defaultKeyType: {
          description: 'Default key type used for centralized enrollment',
          allOf: [
            {
              $ref: '#/$defs/KeyType',
            },
          ],
          nullable: true,
        },
        authorizedKeyTypes: {
          description: 'List of authorized key types for enrollment',
          example: ['rsa-2048', 'rsa-3072', 'rsa-4096'],
          type: 'array',
          nullable: true,
          items: {
            allOf: [
              {
                $ref: '#/$defs/KeyType',
              },
            ],
          },
        },
        preferredEnrollmentMode: {
          description:
            'If both centralized and decentralized enrollment are supported, this is the preferred mode',
          type: 'string',
          nullable: true,
          enum: ['centralized', 'decentralized'],
        },
        escrow: {
          description:
            'Whether this profile will escrow the certificate private keys',
          type: 'boolean',
          nullable: true,
          default: false,
        },
        p12passwordPolicy: {
          description: 'Password policy for the P12 file',
          type: 'string',
          nullable: true,
        },
        p12passwordMode: {
          description:
            'Whether the user will be required to input their PKCS#12 password upon enrollment',
          type: 'string',
          nullable: true,
          enum: ['random', 'manual'],
        },
        p12storeEncryptionType: {
          description: 'Encryption type for the P12 file',
          example: 'AES',
          nullable: true,
          type: 'string',
        },
        showP12PasswordOnEnroll: {
          description:
            'Whether the PKCS#12 password will be displayed to the user upon enrollment',
          type: 'boolean',
          nullable: true,
        },
        showP12OnEnroll: {
          description:
            'Whether the PKCS#12 file will be displayed to the user upon enrollment',
          type: 'boolean',
          nullable: true,
        },
        showP12PasswordOnRecover: {
          description:
            'Whether the PKCS#12 password will be displayed to the user upon recovery',
          type: 'boolean',
          nullable: true,
        },
        showP12OnRecover: {
          description:
            'Whether the PKCS#12 file will be displayed to the user upon recovery',
          type: 'boolean',
          nullable: true,
        },
        keyAvailability: {
          description:
            'Availability of the key in the requests (enroll, recover), as well as time during which a non-escrowed key is available for trigger retries',
          allOf: [
            {
              $ref: '#/$defs/FiniteDuration',
            },
          ],
        },
      },
    },
    KeyType: {
      title: 'Keytype',
      type: 'string',
      pattern:
        '(rsa-2048|rsa-3072|rsa-4096|rsa-8192|ec-secp256r1|ec-secp384r1|ec-secp521r1|ec-brainpoolp256r1|ec-brainpoolp384r1|ec-brainpoolp512r1|ed-448|ed-25519|mldsa-44|mldsa-65|mldsa-87|slhdsa-sha2-128s|slhdsa-sha2-128f|slhdsa-sha2-192s|slhdsa-sha2-192f|slhdsa-sha2-256s|slhdsa-sha2-256f|slhdsa-sha2-128ssha256|slhdsa-sha2-128fsha256|slhdsa-sha2-192ssha512|slhdsa-sha2-192fsha512|slhdsa-sha2-256ssha512|slhdsa-sha2-256fsha512)(\\\\+(rsa-2048|rsa-3072|rsa-4096|rsa-8192|ec-secp256r1|ec-secp384r1|ec-secp521r1|ec-brainpoolp256r1|ec-brainpoolp384r1|ec-brainpoolp512r1|ed-448|ed-25519|mldsa-44|mldsa-65|mldsa-87|slhdsa-sha2-128s|slhdsa-sha2-128f|slhdsa-sha2-192s|slhdsa-sha2-192f|slhdsa-sha2-256s|slhdsa-sha2-256f|slhdsa-sha2-128ssha256|slhdsa-sha2-128fsha256|slhdsa-sha2-192ssha512|slhdsa-sha2-192fsha512|slhdsa-sha2-256ssha512|slhdsa-sha2-256fsha512))?',
      example: 'rsa-2048',
      description:
        'One of `rsa-2048`, `rsa-3072`, `rsa-4096`, `rsa-8192`, `ec-secp256r1`, `ec-secp384r1`, `ec-secp521r1`, `ec-brainpoolp256r1`, `ec-brainpoolp384r1`, `ec-brainpoolp512r1`, `ed-448`, `ed-25519`, `mldsa-44`, `mldsa-65`, `mldsa-87`, `slhdsa-sha2-128s`, `slhdsa-sha2-128f`, `slhdsa-sha2-192s`, `slhdsa-sha2-192f`, `slhdsa-sha2-256s`, `slhdsa-sha2-256f`, `slhdsa-sha2-128ssha256`, `slhdsa-sha2-128fsha256`, `slhdsa-sha2-192ssha512`, `slhdsa-sha2-192fsha512`, `slhdsa-sha2-256ssha512`, `slhdsa-sha2-256fsha512` or `<primary key type>+<alternate key type>`',
    },
    FiniteDuration: {
      nullable: true,
      type: 'string',
      format: 'Finite Duration',
      pattern:
        '^([0-9]+) *(ms|millisecond|milliseconds|s|second|seconds|m|minute|minutes|h|hour|hours|d|day|days)$',
    },
    DataSourceFlow: {
      title: 'Datasource Flow',
      type: 'array',
      description: 'Representation of a datasource execution flow',
      items: {
        allOf: [
          {
            $ref: '#/$defs/DataSourceFlowEntry',
          },
        ],
      },
    },
    DataSourceFlowEntry: {
      title: 'Datasource Flow Entry',
      type: 'object',
      description: 'Parameters to execute a datasource in a flow',
      properties: {
        ds: {
          type: 'string',
          example: 'LDAP_DS',
          description: 'Name of the datasource to execute for this step',
        },
        inputs: {
          nullable: true,
          description: 'List of inputs to use for this datasource',
          type: 'array',
          items: {
            allOf: [
              {
                $ref: '#/$defs/DataSourceInput',
              },
            ],
          },
        },
        stopOnSuccess: {
          type: 'boolean',
          default: false,
          description:
            'Stop the flow if this datasource is successfully executed',
        },
        mandatory: {
          type: 'boolean',
          default: false,
          description:
            'If true, the flow will stop with an error if this datasource does not return any result',
        },
      },
      required: ['ds'],
    },
    DataSourceInput: {
      title: 'Datasource Input',
      type: 'object',
      description: 'Input to execute a datasource in a flow',
      properties: {
        key: {
          type: 'string',
          example: 'LDAP_DS',
          description: 'Name of the datasource to execute for this step',
        },
        value: {
          description: 'Value for this input',
          allOf: [
            {
              $ref: '#/$defs/ComputationRule',
            },
          ],
        },
      },
      required: ['key'],
    },
    EstProfile: {
      title: 'EST Profile',
      properties: {
        module: {
          type: 'string',
          enum: ['est'],
        },
        name: {
          type: 'string',
        },
        displayName: {
          type: 'array',
          nullable: true,
          items: {
            $ref: '#/$defs/LocalizedString',
          },
        },
        description: {
          type: 'array',
          nullable: true,
          items: {
            $ref: '#/$defs/LocalizedString',
          },
        },
        enabled: {
          type: 'boolean',
        },
        ca: {
          type: 'string',
        },
        constraints: {
          nullable: true,
          type: 'object',
          allOf: [
            {
              $ref: '#/$defs/CertificateRequestConstraints',
            },
          ],
        },
        pkiConnector: {
          type: 'string',
        },
        csrDataMapping: {
          nullable: true,
          type: 'object',
          additionalProperties: {
            type: 'string',
          },
        },
        maxCertificatePerHolderPolicy: {
          nullable: true,
          type: 'object',
          allOf: [
            {
              $ref: '#/$defs/MaxCertificatePerHolderPolicy',
            },
          ],
        },
        authorizationMode: {
          type: 'string',
          enum: ['authorized', 'x509', 'challenge', 'auto-validation'],
        },
        dnWhitelist: {
          type: 'boolean',
        },
        enrollAuthorizedCas: {
          type: 'array',
          nullable: true,
          items: {
            type: 'string',
          },
        },
        renewalAuthorizedCas: {
          type: 'array',
          nullable: true,
          items: {
            type: 'string',
          },
        },
        renewalPeriod: {
          nullable: true,
          type: 'string',
          format: 'Finite Duration',
          pattern:
            '^([0-9]+) *(ms|millisecond|milliseconds|s|second|seconds|m|minute|minutes|h|hour|hours|d|day|days)$',
          example: '5 seconds',
        },
        authorizationLevels: {
          allOf: [
            {
              $ref: '#/$defs/CertificateProfileAuthorizationLevels',
            },
          ],
        },
        triggers: {
          nullable: true,
          type: 'object',
          allOf: [
            {
              $ref: '#/$defs/CertificateProfileTriggers',
            },
          ],
        },
        requestsPolicy: {
          allOf: [
            {
              $ref: '#/$defs/RequestsPolicy',
            },
          ],
        },
        passwordPolicy: {
          type: 'string',
          nullable: true,
        },
        cryptoPolicy: {
          allOf: [
            {
              $ref: '#/$defs/ManagedCertificateProfileCryptoPolicy',
            },
          ],
        },
        selfPermissions: {
          allOf: [
            {
              $ref: '#/$defs/CertificateProfileSelfPermissions',
            },
          ],
        },
        certificateTemplate: {
          nullable: true,
          type: 'object',
          allOf: [
            {
              $ref: '#/$defs/CertificateTemplate',
            },
          ],
        },
        gradingPolicies: {
          type: 'array',
          nullable: true,
          items: {
            type: 'string',
          },
        },
        validationRuleset: {
          nullable: true,
          allOf: [
            {
              $ref: '#/$defs/ValidationRuleset',
            },
          ],
        },
        dsFlow: {
          nullable: true,
          allOf: [
            {
              $ref: '#/$defs/DataSourceFlow',
            },
          ],
        },
        thirdPartyDiscoverySync: {
          nullable: true,
          default: false,
          type: 'boolean',
          description: 'Available from `2.8.2`',
        },
      },
      required: [
        'module',
        'name',
        'enabled',
        'ca',
        'pkiConnector',
        'authorizationMode',
        'dnWhitelist',
        'authorizationLevels',
        'requestsPolicy',
        'cryptoPolicy',
        'selfPermissions',
      ],
    },
    ValidationRuleset: {
      title: 'Validation Ruleset',
      description: 'The validation ruleset used for auto validation',
      properties: {
        rules: {
          description: 'The validation rules for this ruleset',
          type: 'array',
          items: {
            type: 'string',
            description: 'A validation rule to use for auto validation',
            example: '{{csr.subject.cn.1}} contains "evertrust"',
          },
        },
        threshold: {
          type: 'integer',
          description:
            'Number of rules to validation in order to allow enrollment',
          example: 1,
        },
      },
      required: ['rules', 'threshold'],
    },
    IntuneProfile: {
      title: 'Intune Profile',
      properties: {
        module: {
          type: 'string',
          enum: ['intune'],
        },
        name: {
          type: 'string',
        },
        displayName: {
          type: 'array',
          nullable: true,
          items: {
            $ref: '#/$defs/LocalizedString',
          },
        },
        description: {
          type: 'array',
          nullable: true,
          items: {
            $ref: '#/$defs/LocalizedString',
          },
        },
        enabled: {
          type: 'boolean',
        },
        mode: {
          type: 'string',
          enum: ['ca', 'ra'],
        },
        thirdPartyConnector: {
          type: 'string',
        },
        pkiConnector: {
          type: 'string',
        },
        renewalPeriod: {
          nullable: true,
          type: 'string',
          format: 'Finite Duration',
          pattern:
            '^([0-9]+) *(ms|millisecond|milliseconds|s|second|seconds|m|minute|minutes|h|hour|hours|d|day|days)$',
          example: '5 seconds',
        },
        constraints: {
          nullable: true,
          type: 'object',
          allOf: [
            {
              $ref: '#/$defs/CertificateRequestConstraints',
            },
          ],
        },
        csrDataMapping: {
          nullable: true,
          type: 'object',
          additionalProperties: {
            type: 'string',
          },
        },
        scepRA: {
          type: 'string',
        },
        caps: {
          type: 'array',
          items: {
            type: 'string',
            enum: ['AES', 'SHA-256', 'Renewal', 'SHA-512', 'SHA-1', 'DES3'],
          },
        },
        postPKIOperation: {
          type: 'boolean',
          nullable: true,
        },
        encryptionAlgorithm: {
          type: 'string',
        },
        deviceIdField: {
          nullable: true,
          type: 'string',
        },
        deviceIdSeparator: {
          type: 'string',
          nullable: true,
        },
        maxCertificatePerHolderPolicy: {
          nullable: true,
          type: 'object',
          allOf: [
            {
              $ref: '#/$defs/MaxCertificatePerHolderPolicy',
            },
          ],
        },
        authorizationLevels: {
          allOf: [
            {
              $ref: '#/$defs/CertificateProfileAuthorizationLevels',
            },
          ],
        },
        triggers: {
          nullable: true,
          type: 'object',
          allOf: [
            {
              $ref: '#/$defs/CertificateProfileTriggers',
            },
          ],
        },
        requestsPolicy: {
          allOf: [
            {
              $ref: '#/$defs/RequestsPolicy',
            },
          ],
        },
        selfPermissions: {
          allOf: [
            {
              $ref: '#/$defs/CertificateProfileSelfPermissions',
            },
          ],
        },
        certificateTemplate: {
          nullable: true,
          type: 'object',
          allOf: [
            {
              $ref: '#/$defs/CertificateTemplate',
            },
          ],
        },
        cryptoPolicy: {
          allOf: [
            {
              $ref: '#/$defs/ManagedCertificateProfileCryptoPolicy',
            },
          ],
        },
        gradingPolicies: {
          type: 'array',
          nullable: true,
          items: {
            type: 'string',
          },
        },
        dsFlow: {
          nullable: true,
          allOf: [
            {
              $ref: '#/$defs/DataSourceFlow',
            },
          ],
        },
        thirdPartyDiscoverySync: {
          nullable: true,
          default: false,
          type: 'boolean',
          description: 'Available from `2.8.2`',
        },
      },
      required: [
        'module',
        'name',
        'enabled',
        'mode',
        'thirdPartyConnector',
        'pkiConnector',
        'scepRA',
        'caps',
        'encryptionAlgorithm',
        'authorizationLevels',
        'requestsPolicy',
        'selfPermissions',
        'cryptoPolicy',
      ],
    },
    JamfProfile: {
      title: 'JAMF Profile',
      properties: {
        module: {
          type: 'string',
          enum: ['jamf'],
        },
        name: {
          type: 'string',
        },
        displayName: {
          type: 'array',
          nullable: true,
          items: {
            $ref: '#/$defs/LocalizedString',
          },
        },
        description: {
          type: 'array',
          nullable: true,
          items: {
            $ref: '#/$defs/LocalizedString',
          },
        },
        enabled: {
          type: 'boolean',
        },
        mode: {
          type: 'string',
          enum: ['ca', 'ra'],
        },
        thirdPartyConnector: {
          type: 'string',
        },
        pkiConnector: {
          type: 'string',
        },
        renewalPeriod: {
          nullable: true,
          type: 'string',
          format: 'Finite Duration',
          pattern:
            '^([0-9]+) *(ms|millisecond|milliseconds|s|second|seconds|m|minute|minutes|h|hour|hours|d|day|days)$',
          example: '5 seconds',
        },
        constraints: {
          nullable: true,
          type: 'object',
          allOf: [
            {
              $ref: '#/$defs/CertificateRequestConstraints',
            },
          ],
        },
        csrDataMapping: {
          nullable: true,
          type: 'object',
          additionalProperties: {
            type: 'string',
          },
        },
        scepRA: {
          type: 'string',
        },
        caps: {
          type: 'array',
          items: {
            type: 'string',
            enum: ['AES', 'SHA-256', 'Renewal', 'SHA-512', 'SHA-1', 'DES3'],
          },
        },
        postPKIOperation: {
          type: 'boolean',
          nullable: true,
        },
        encryptionAlgorithm: {
          type: 'string',
        },
        deviceIdField: {
          nullable: true,
          type: 'string',
        },
        maxCertificatePerHolderPolicy: {
          nullable: true,
          type: 'object',
          allOf: [
            {
              $ref: '#/$defs/MaxCertificatePerHolderPolicy',
            },
          ],
        },
        authorizationLevels: {
          allOf: [
            {
              $ref: '#/$defs/CertificateProfileAuthorizationLevels',
            },
          ],
        },
        triggers: {
          nullable: true,
          type: 'object',
          allOf: [
            {
              $ref: '#/$defs/CertificateProfileTriggers',
            },
          ],
        },
        passwordPolicy: {
          type: 'string',
          nullable: true,
        },
        requestsPolicy: {
          allOf: [
            {
              $ref: '#/$defs/RequestsPolicy',
            },
          ],
        },
        selfPermissions: {
          allOf: [
            {
              $ref: '#/$defs/CertificateProfileSelfPermissions',
            },
          ],
        },
        certificateTemplate: {
          nullable: true,
          type: 'object',
          allOf: [
            {
              $ref: '#/$defs/CertificateTemplate',
            },
          ],
        },
        cryptoPolicy: {
          allOf: [
            {
              $ref: '#/$defs/ManagedCertificateProfileCryptoPolicy',
            },
          ],
        },
        gradingPolicies: {
          type: 'array',
          nullable: true,
          items: {
            type: 'string',
          },
        },
        dsFlow: {
          nullable: true,
          allOf: [
            {
              $ref: '#/$defs/DataSourceFlow',
            },
          ],
        },
        thirdPartyDiscoverySync: {
          nullable: true,
          default: false,
          type: 'boolean',
          description: 'Available from `2.8.2`',
        },
      },
      required: [
        'module',
        'name',
        'enabled',
        'mode',
        'thirdPartyConnector',
        'pkiConnector',
        'scepRA',
        'caps',
        'encryptionAlgorithm',
        'authorizationLevels',
        'requestsPolicy',
        'selfPermissions',
        'cryptoPolicy',
      ],
    },
    ScepProfile: {
      title: 'SCEP Profile',
      properties: {
        module: {
          type: 'string',
          enum: ['scep'],
        },
        name: {
          type: 'string',
        },
        displayName: {
          type: 'array',
          nullable: true,
          items: {
            $ref: '#/$defs/LocalizedString',
          },
        },
        description: {
          type: 'array',
          nullable: true,
          items: {
            $ref: '#/$defs/LocalizedString',
          },
        },
        enabled: {
          type: 'boolean',
        },
        mode: {
          type: 'string',
          enum: ['ca', 'ra'],
        },
        scepRA: {
          type: 'string',
        },
        caps: {
          type: 'array',
          items: {
            type: 'string',
            enum: ['AES', 'SHA-256', 'Renewal', 'SHA-512', 'SHA-1', 'DES3'],
          },
        },
        postPKIOperation: {
          type: 'boolean',
          nullable: true,
        },
        encryptionAlgorithm: {
          type: 'string',
        },
        pkiConnector: {
          type: 'string',
        },
        constraints: {
          nullable: true,
          type: 'object',
          allOf: [
            {
              $ref: '#/$defs/CertificateRequestConstraints',
            },
          ],
        },
        renewalPeriod: {
          nullable: true,
          type: 'string',
          format: 'Finite Duration',
          pattern:
            '^([0-9]+) *(ms|millisecond|milliseconds|s|second|seconds|m|minute|minutes|h|hour|hours|d|day|days)$',
          example: '5 seconds',
        },
        csrDataMapping: {
          nullable: true,
          type: 'object',
          additionalProperties: {
            type: 'string',
          },
        },
        dnWhitelist: {
          type: 'boolean',
        },
        authorizationMode: {
          description:
            "The authorization mode for this profile:\n- `challenge`: a SCEP challenge must be used when submitting a request. \n- `authorized`: the challenge does not come from the challenge but are credentials 'login:password' hex encoded of an account with enroll permissions.\n- `ndes`: challenge requests are automatically generated by an account with enroll permissions.\n",
          type: 'string',
          enum: ['challenge', 'authorized', 'ndes', 'auto-validation'],
        },
        maxCertificatePerHolderPolicy: {
          nullable: true,
          type: 'object',
          allOf: [
            {
              $ref: '#/$defs/MaxCertificatePerHolderPolicy',
            },
          ],
        },
        authorizationLevels: {
          allOf: [
            {
              $ref: '#/$defs/CertificateProfileAuthorizationLevels',
            },
          ],
        },
        triggers: {
          nullable: true,
          type: 'object',
          allOf: [
            {
              $ref: '#/$defs/CertificateProfileTriggers',
            },
          ],
        },
        passwordPolicy: {
          type: 'string',
          nullable: true,
        },
        requestsPolicy: {
          allOf: [
            {
              $ref: '#/$defs/RequestsPolicy',
            },
          ],
        },
        selfPermissions: {
          allOf: [
            {
              $ref: '#/$defs/CertificateProfileSelfPermissions',
            },
          ],
        },
        certificateTemplate: {
          nullable: true,
          type: 'object',
          allOf: [
            {
              $ref: '#/$defs/CertificateTemplate',
            },
          ],
        },
        cryptoPolicy: {
          allOf: [
            {
              $ref: '#/$defs/ManagedCertificateProfileCryptoPolicy',
            },
          ],
        },
        gradingPolicies: {
          type: 'array',
          nullable: true,
          items: {
            type: 'string',
          },
        },
        validationRuleset: {
          nullable: true,
          allOf: [
            {
              $ref: '#/$defs/ValidationRuleset',
            },
          ],
        },
        dsFlow: {
          nullable: true,
          allOf: [
            {
              $ref: '#/$defs/DataSourceFlow',
            },
          ],
        },
        thirdPartyDiscoverySync: {
          nullable: true,
          default: false,
          type: 'boolean',
          description: 'Available from `2.8.2`',
        },
      },
      required: [
        'module',
        'name',
        'enabled',
        'mode',
        'scepRA',
        'caps',
        'encryptionAlgorithm',
        'pkiConnector',
        'dnWhitelist',
        'authorizationMode',
        'authorizationLevels',
        'requestsPolicy',
        'selfPermissions',
        'cryptoPolicy',
      ],
    },
    WcceProfile: {
      title: 'WCCE Profile',
      properties: {
        module: {
          type: 'string',
          enum: ['wcce'],
        },
        name: {
          type: 'string',
        },
        displayName: {
          type: 'array',
          nullable: true,
          items: {
            $ref: '#/$defs/LocalizedString',
          },
        },
        description: {
          type: 'array',
          nullable: true,
          items: {
            $ref: '#/$defs/LocalizedString',
          },
        },
        enabled: {
          type: 'boolean',
        },
        pkiConnector: {
          type: 'string',
        },
        constraints: {
          nullable: true,
          type: 'object',
          allOf: [
            {
              $ref: '#/$defs/CertificateRequestConstraints',
            },
          ],
        },
        csrDataMapping: {
          nullable: true,
          type: 'object',
          additionalProperties: {
            type: 'string',
          },
        },
        maxCertificatePerHolderPolicy: {
          nullable: true,
          type: 'object',
          allOf: [
            {
              $ref: '#/$defs/MaxCertificatePerHolderPolicy',
            },
          ],
        },
        authorizationLevels: {
          allOf: [
            {
              $ref: '#/$defs/CertificateProfileAuthorizationLevels',
            },
          ],
        },
        triggers: {
          nullable: true,
          type: 'object',
          allOf: [
            {
              $ref: '#/$defs/CertificateProfileTriggers',
            },
          ],
        },
        requestsPolicy: {
          allOf: [
            {
              $ref: '#/$defs/RequestsPolicy',
            },
          ],
        },
        selfPermissions: {
          allOf: [
            {
              $ref: '#/$defs/CertificateProfileSelfPermissions',
            },
          ],
        },
        certificateTemplate: {
          nullable: true,
          type: 'object',
          allOf: [
            {
              $ref: '#/$defs/CertificateTemplate',
            },
          ],
        },
        cryptoPolicy: {
          allOf: [
            {
              $ref: '#/$defs/ManagedCertificateProfileCryptoPolicy',
            },
          ],
        },
        gradingPolicies: {
          type: 'array',
          nullable: true,
          items: {
            type: 'string',
          },
        },
        exchangeCertificate: {
          type: 'string',
          nullable: true,
        },
        dsFlow: {
          nullable: true,
          allOf: [
            {
              $ref: '#/$defs/DataSourceFlow',
            },
          ],
        },
        thirdPartyDiscoverySync: {
          nullable: true,
          default: false,
          type: 'boolean',
          description: 'Available from `2.8.2`',
        },
      },
      required: [
        'module',
        'name',
        'enabled',
        'pkiConnector',
        'authorizationLevels',
        'requestsPolicy',
        'selfPermissions',
        'cryptoPolicy',
      ],
    },
    WebRAProfile: {
      title: 'WebRA Profile',
      properties: {
        module: {
          type: 'string',
          enum: ['webra'],
        },
        name: {
          type: 'string',
        },
        displayName: {
          type: 'array',
          nullable: true,
          items: {
            $ref: '#/$defs/LocalizedString',
          },
        },
        description: {
          type: 'array',
          nullable: true,
          items: {
            $ref: '#/$defs/LocalizedString',
          },
        },
        authorizationMode: {
          type: 'string',
          description:
            'The authorization mode to use. \n`authorized` uses permissions to allow enrollment, \n`auto-validation` uses the validation ruleset,\n`auto-validation-authorized` uses the validation ruleset, and if enrollment is denied, uses the permissions\n',
          enum: ['authorized', 'auto-validation', 'auto-validation-authorized'],
        },
        enabled: {
          type: 'boolean',
        },
        pkiConnector: {
          type: 'string',
        },
        csrDataMapping: {
          nullable: true,
          type: 'object',
          additionalProperties: {
            type: 'string',
          },
        },
        maxCertificatePerHolderPolicy: {
          nullable: true,
          type: 'object',
          allOf: [
            {
              $ref: '#/$defs/MaxCertificatePerHolderPolicy',
            },
          ],
        },
        authorizationLevels: {
          allOf: [
            {
              $ref: '#/$defs/CertificateProfileAuthorizationLevels',
            },
          ],
        },
        triggers: {
          nullable: true,
          type: 'object',
          allOf: [
            {
              $ref: '#/$defs/CertificateProfileTriggers',
            },
          ],
        },
        requestsPolicy: {
          allOf: [
            {
              $ref: '#/$defs/RequestsPolicy',
            },
          ],
        },
        cryptoPolicy: {
          allOf: [
            {
              $ref: '#/$defs/ManagedCertificateProfileCryptoPolicy',
            },
          ],
        },
        selfPermissions: {
          allOf: [
            {
              $ref: '#/$defs/CertificateProfileSelfPermissions',
            },
          ],
        },
        certificateTemplate: {
          type: 'object',
          allOf: [
            {
              $ref: '#/$defs/CertificateTemplate',
            },
          ],
        },
        renewalPeriod: {
          nullable: true,
          type: 'string',
          format: 'Finite Duration',
          pattern:
            '^([0-9]+) *(ms|millisecond|milliseconds|s|second|seconds|m|minute|minutes|h|hour|hours|d|day|days)$',
          example: '5 seconds',
        },
        gradingPolicies: {
          type: 'array',
          nullable: true,
          items: {
            type: 'string',
          },
        },
        validationRuleset: {
          nullable: true,
          allOf: [
            {
              $ref: '#/$defs/ValidationRuleset',
            },
          ],
        },
        dsFlow: {
          nullable: true,
          allOf: [
            {
              $ref: '#/$defs/DataSourceFlow',
            },
          ],
        },
        thirdPartyDiscoverySync: {
          nullable: true,
          default: false,
          type: 'boolean',
          description: 'Available from `2.8.2`',
        },
        autoRenewalPolicy: {
          allOf: [
            {
              $ref: '#/$defs/AutoRenewalPolicy',
            },
          ],
        },
      },
      required: [
        'module',
        'name',
        'enabled',
        'pkiConnector',
        'authorizationLevels',
        'authorizationMode',
        'requestsPolicy',
        'cryptoPolicy',
        'selfPermissions',
        'certificateTemplate',
      ],
    },
    AutoRenewalPolicy: {
      title: 'Auto Renewal Policy',
      description:
        'The policy to apply for auto renewal. If not defined, auto renewal is disabled',
      properties: {
        default: {
          type: 'boolean',
          description:
            'The default value for auto renewal status on a new certificate',
        },
        editable: {
          type: 'boolean',
          description:
            'If true, the auto renewal status can be updated on new and existing certificates',
        },
      },
      required: ['default', 'editable'],
    },
    IntunePKCSProfile: {
      title: 'Intune PKCS Profile',
      properties: {
        module: {
          type: 'string',
          enum: ['intunepkcs'],
        },
        name: {
          type: 'string',
        },
        displayName: {
          type: 'array',
          nullable: true,
          items: {
            $ref: '#/$defs/LocalizedString',
          },
        },
        description: {
          type: 'array',
          nullable: true,
          items: {
            $ref: '#/$defs/LocalizedString',
          },
        },
        enabled: {
          type: 'boolean',
        },
        pkiConnector: {
          type: 'string',
        },
        thirdPartyConnector: {
          type: 'string',
        },
        constraints: {
          nullable: true,
          type: 'object',
          allOf: [
            {
              $ref: '#/$defs/CertificateRequestConstraints',
            },
          ],
        },
        csrDataMapping: {
          nullable: true,
          type: 'object',
          additionalProperties: {
            type: 'string',
          },
        },
        maxCertificatePerHolderPolicy: {
          nullable: true,
          type: 'object',
          allOf: [
            {
              $ref: '#/$defs/MaxCertificatePerHolderPolicy',
            },
          ],
        },
        authorizationLevels: {
          allOf: [
            {
              $ref: '#/$defs/CertificateProfileAuthorizationLevels',
            },
          ],
        },
        triggers: {
          nullable: true,
          type: 'object',
          allOf: [
            {
              $ref: '#/$defs/CertificateProfileTriggers',
            },
          ],
        },
        requestsPolicy: {
          allOf: [
            {
              $ref: '#/$defs/RequestsPolicy',
            },
          ],
        },
        cryptoPolicy: {
          allOf: [
            {
              $ref: '#/$defs/ManagedCertificateProfileCryptoPolicy',
            },
          ],
        },
        selfPermissions: {
          allOf: [
            {
              $ref: '#/$defs/CertificateProfileSelfPermissions',
            },
          ],
        },
        certificateTemplate: {
          nullable: true,
          type: 'object',
          allOf: [
            {
              $ref: '#/$defs/CertificateTemplate',
            },
          ],
        },
        gradingPolicies: {
          type: 'array',
          nullable: true,
          items: {
            type: 'string',
          },
        },
        dsFlow: {
          nullable: true,
          allOf: [
            {
              $ref: '#/$defs/DataSourceFlow',
            },
          ],
        },
        thirdPartyDiscoverySync: {
          nullable: true,
          default: false,
          type: 'boolean',
          description: 'Available from `2.8.2`',
        },
      },
      required: [
        'module',
        'name',
        'enabled',
        'pkiConnector',
        'thirdPartyConnector',
        'authorizationLevels',
        'requestsPolicy',
        'cryptoPolicy',
        'selfPermissions',
      ],
    },
    AcmeExternalProfile: {
      title: 'ACME External Profile',
      properties: {
        module: {
          type: 'string',
          enum: ['acme-external'],
        },
        name: {
          type: 'string',
        },
        displayName: {
          type: 'array',
          nullable: true,
          items: {
            $ref: '#/$defs/LocalizedString',
          },
        },
        description: {
          type: 'array',
          nullable: true,
          items: {
            $ref: '#/$defs/LocalizedString',
          },
        },
        enabled: {
          type: 'boolean',
        },
        constraints: {
          nullable: true,
          type: 'object',
          allOf: [
            {
              $ref: '#/$defs/CertificateRequestConstraints',
            },
          ],
        },
        authorizationMethods: {
          type: 'array',
          nullable: true,
          items: {
            type: 'string',
          },
        },
        pkiConnector: {
          type: 'string',
        },
        acmeUrl: {
          type: 'string',
        },
        requireEAB: {
          type: 'boolean',
        },
        maxCertificatePerHolderPolicy: {
          nullable: true,
          type: 'object',
          allOf: [
            {
              $ref: '#/$defs/MaxCertificatePerHolderPolicy',
            },
          ],
        },
        authorizedCas: {
          type: 'array',
          nullable: true,
          items: {
            type: 'string',
          },
        },
        renewalPeriod: {
          nullable: true,
          type: 'string',
          format: 'Finite Duration',
          pattern:
            '^([0-9]+) *(ms|millisecond|milliseconds|s|second|seconds|m|minute|minutes|h|hour|hours|d|day|days)$',
          example: '5 seconds',
        },
        authorizationLevels: {
          allOf: [
            {
              $ref: '#/$defs/CertificateProfileAuthorizationLevels',
            },
          ],
        },
        triggers: {
          nullable: true,
          type: 'object',
          allOf: [
            {
              $ref: '#/$defs/CertificateProfileTriggers',
            },
          ],
        },
        requestsPolicy: {
          allOf: [
            {
              $ref: '#/$defs/RequestsPolicy',
            },
          ],
        },
        selfPermissions: {
          allOf: [
            {
              $ref: '#/$defs/CertificateProfileSelfPermissions',
            },
          ],
        },
        certificateTemplate: {
          nullable: true,
          type: 'object',
          allOf: [
            {
              $ref: '#/$defs/CertificateTemplate',
            },
          ],
        },
        cryptoPolicy: {
          allOf: [
            {
              $ref: '#/$defs/ManagedCertificateProfileCryptoPolicy',
            },
          ],
        },
        gradingPolicies: {
          type: 'array',
          nullable: true,
          items: {
            type: 'string',
          },
        },
        dsFlow: {
          nullable: true,
          allOf: [
            {
              $ref: '#/$defs/DataSourceFlow',
            },
          ],
        },
        thirdPartyDiscoverySync: {
          nullable: true,
          default: false,
          type: 'boolean',
          description: 'Available from `2.8.2`',
        },
      },
      required: [
        'module',
        'name',
        'enabled',
        'pkiConnector',
        'requireEAB',
        'authorizationMethods',
        'authorizedCas',
        'authorizationLevels',
        'requestsPolicy',
        'selfPermissions',
        'cryptoPolicy',
      ],
    },
    CrmpProfile: {
      title: 'CRMP Profile',
      properties: {
        module: {
          type: 'string',
          enum: ['crmp'],
        },
        name: {
          type: 'string',
        },
        displayName: {
          type: 'array',
          nullable: true,
          items: {
            $ref: '#/$defs/LocalizedString',
          },
        },
        description: {
          type: 'array',
          nullable: true,
          items: {
            $ref: '#/$defs/LocalizedString',
          },
        },
        pkiConnector: {
          type: 'string',
        },
        maxCertificatePerHolderPolicy: {
          nullable: true,
          type: 'object',
          allOf: [
            {
              $ref: '#/$defs/MaxCertificatePerHolderPolicy',
            },
          ],
        },
        authorizationLevels: {
          allOf: [
            {
              $ref: '#/$defs/CertificateProfileAuthorizationLevels',
            },
          ],
        },
        triggers: {
          nullable: true,
          type: 'object',
          allOf: [
            {
              $ref: '#/$defs/CertificateProfileTriggers',
            },
          ],
        },
        requestsPolicy: {
          allOf: [
            {
              $ref: '#/$defs/RequestsPolicy',
            },
          ],
        },
        enabled: {
          type: 'boolean',
        },
        cryptoPolicy: {
          allOf: [
            {
              $ref: '#/$defs/ManagedCertificateProfileCryptoPolicy',
            },
          ],
        },
        selfPermissions: {
          allOf: [
            {
              $ref: '#/$defs/CertificateProfileSelfPermissions',
            },
          ],
        },
        dataFieldIdentifier: {
          nullable: true,
          description:
            'Only when escrow is enabled in the cryptoPolicy,\npossible values are: `rfc822name`, `othername_upn`, `mail`, `uid`, `cn` and `label.<label_name>`.\nIf a label is used, it should be defined in the certificateTemplate\n',
          type: 'string',
          pattern: '(rfc822name|othername_upn|mail|uid|cn|label\\..+)',
        },
        constraints: {
          nullable: true,
          type: 'object',
          allOf: [
            {
              $ref: '#/$defs/CertificateRequestConstraints',
            },
          ],
        },
        certificateTemplate: {
          nullable: true,
          type: 'object',
          allOf: [
            {
              $ref: '#/$defs/CertificateTemplate',
            },
          ],
        },
        gradingPolicies: {
          type: 'array',
          nullable: true,
          items: {
            type: 'string',
          },
        },
        dsFlow: {
          nullable: true,
          allOf: [
            {
              $ref: '#/$defs/DataSourceFlow',
            },
          ],
        },
        thirdPartyDiscoverySync: {
          nullable: true,
          default: false,
          type: 'boolean',
          description: 'Available from `2.8.2`',
        },
      },
      required: [
        'name',
        'module',
        'pkiConnector',
        'authorizationLevels',
        'requestsPolicy',
        'enabled',
        'cryptoPolicy',
        'selfPermissions',
      ],
    },
    MonitoredProfile: {
      title: 'Monitored Profile',
      properties: {
        module: {
          type: 'string',
          enum: ['monitored'],
        },
        name: {
          type: 'string',
        },
        displayName: {
          type: 'array',
          nullable: true,
          items: {
            $ref: '#/$defs/LocalizedString',
          },
        },
        description: {
          type: 'array',
          nullable: true,
          items: {
            $ref: '#/$defs/LocalizedString',
          },
        },
        enabled: {
          type: 'boolean',
        },
        authorizationLevels: {
          allOf: [
            {
              $ref: '#/$defs/CertificateProfileAuthorizationLevels',
            },
          ],
        },
        triggers: {
          nullable: true,
          type: 'object',
          allOf: [
            {
              $ref: '#/$defs/CertificateProfileTriggers',
            },
          ],
        },
        requestsPolicy: {
          allOf: [
            {
              $ref: '#/$defs/RequestsPolicy',
            },
          ],
        },
        cryptoPolicy: {
          allOf: [
            {
              $ref: '#/$defs/MonitoredCertificateProfileCryptoPolicy',
            },
          ],
        },
        selfPermissions: {
          allOf: [
            {
              $ref: '#/$defs/CertificateProfileSelfPermissions',
            },
          ],
        },
        certificateTemplate: {
          nullable: true,
          type: 'object',
          allOf: [
            {
              $ref: '#/$defs/CertificateTemplate',
            },
          ],
        },
        gradingPolicies: {
          type: 'array',
          nullable: true,
          items: {
            type: 'string',
          },
        },
      },
      required: [
        'module',
        'name',
        'enabled',
        'authorizationLevels',
        'requestsPolicy',
        'cryptoPolicy',
        'selfPermissions',
      ],
    },
    MonitoredCertificateProfileCryptoPolicy: {
      title: 'Monitored Certificate profile crypto policy',
      properties: {
        authorizedKeyTypes: {
          description: 'List of authorized key types for enrollment',
          example: ['rsa-2048', 'rsa-3072', 'rsa-4096'],
          type: 'array',
          nullable: true,
          items: {
            allOf: [
              {
                $ref: '#/$defs/KeyType',
              },
            ],
          },
        },
        escrow: {
          description:
            'Whether this profile will escrow the certificate private keys',
          type: 'boolean',
          nullable: true,
          default: false,
        },
        p12passwordPolicy: {
          description: 'Password policy for the P12 file',
          type: 'string',
          nullable: true,
        },
        p12passwordMode: {
          description:
            'Whether the user will be required to input their PKCS#12 password upon enrollment',
          type: 'string',
          nullable: true,
          enum: ['random', 'manual'],
        },
        p12storeEncryptionType: {
          description: 'Encryption type for the P12 file',
          example: 'AES',
          nullable: true,
          type: 'string',
        },
        showP12PasswordOnRecover: {
          description:
            'Whether the PKCS#12 password will be displayed to the user upon recovery',
          type: 'boolean',
          nullable: true,
        },
        showP12OnRecover: {
          description:
            'Whether the PKCS#12 file will be displayed to the user upon recovery',
          type: 'boolean',
          nullable: true,
        },
        keyAvailability: {
          description:
            'Availability of the key in the requests (enroll, recover), as well as time during which a non-escrowed key is available for trigger retries',
          allOf: [
            {
              $ref: '#/$defs/FiniteDuration',
            },
          ],
        },
      },
    },
  },
} as const;
