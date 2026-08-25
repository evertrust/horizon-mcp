/**
 * Embedded resolved request JSON Schema for PKI connectors.
 *
 * Source of truth: docs/audit/pki_connectors.schema.json (resolved from the
 * Scala case classes + bundled OpenAPI). Polymorphic union discriminated by the
 * lowercase 'type' field (22 subtypes). Surfaced verbatim through
 * describe_pki_connector_schema so the model never guesses the per-subtype
 * structure.
 *
 * Server-managed fields '_id', 'status', 'tenant' are stripped on read and MUST
 * NOT be sent; ACME-enroll 'account'/'accountUrl' are server-populated and
 * ignored on input.
 */
export const pkiConnectorRequestSchema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'https://evertrust.fr/horizon/schemas/pki_connectors.request.json',
  title: 'PKI Connector (request body)',
  description:
    "Self-contained, resolved JSON Schema for the create (POST /api/v1/pki/connectors) and update (PUT /api/v1/pki/connectors) request body. The body is a polymorphic union discriminated by the lowercase string field 'type'. Create and update share the same body; the only difference is server behaviour (existence check). Server-managed fields (_id, status, tenant) are stripped from the body on read and MUST NOT be sent; ACME-enroll 'account'/'accountUrl' are server-populated and ignored on input.",
  oneOf: [
    {
      $ref: '#/$defs/StreamConnector',
    },
    {
      $ref: '#/$defs/AcmeEnrollConnector',
    },
    {
      $ref: '#/$defs/AcmeRevocationConnector',
    },
    {
      $ref: '#/$defs/EverTrustADCSConnector',
    },
    {
      $ref: '#/$defs/AWSACMPCAConnector',
    },
    {
      $ref: '#/$defs/CertEuropeConnector',
    },
    {
      $ref: '#/$defs/CMPConnector',
    },
    {
      $ref: '#/$defs/DigiCertConnector',
    },
    {
      $ref: '#/$defs/EJBCAConnector',
    },
    {
      $ref: '#/$defs/EJBCARESTConnector',
    },
    {
      $ref: '#/$defs/IDCAConnector',
    },
    {
      $ref: '#/$defs/IntegratedCAConnector',
    },
    {
      $ref: '#/$defs/FCMSConnector',
    },
    {
      $ref: '#/$defs/GCPConnector',
    },
    {
      $ref: '#/$defs/GSAtlasConnector',
    },
    {
      $ref: '#/$defs/GSMSSLConnector',
    },
    {
      $ref: '#/$defs/OTPKIConnector',
    },
    {
      $ref: '#/$defs/MetaPKIConnector',
    },
    {
      $ref: '#/$defs/Nameshield',
    },
    {
      $ref: '#/$defs/NexusCMConnector',
    },
    {
      $ref: '#/$defs/SectigoCMSConnector',
    },
    {
      $ref: '#/$defs/SwissSignConnector',
    },
  ],
  $defs: {
    FiniteDuration: {
      type: 'string',
      description: 'A finite duration string.',
      pattern:
        '^([0-9]+) *(ms|millisecond|milliseconds|s|second|seconds|m|minute|minutes|h|hour|hours|d|day|days)$',
      examples: ['5 seconds', '10s', '7 days'],
    },
    PositiveFiniteDuration: {
      type: 'string',
      description: 'A positive finite duration string.',
      pattern:
        '^(0*[1-9][0-9]*) *(ms|millisecond|milliseconds|s|second|seconds|m|minute|minutes|h|hour|hours|d|day|days)$',
      examples: ['5 seconds', '10s', '7 days'],
    },
    ConnectorName: {
      type: 'string',
      description:
        'Primary key, immutable. Server enforces regex (NameIdentifier.scala).',
      pattern: '^[0-9a-zA-Z-_\\.]+$',
    },
    KeyType: {
      type: 'string',
      description:
        "Key type. One primary, optionally '+<alternate>' for hybrid.",
      pattern:
        '(rsa-2048|rsa-3072|rsa-4096|rsa-8192|ec-secp256r1|ec-secp384r1|ec-secp521r1|ec-brainpoolp256r1|ec-brainpoolp384r1|ec-brainpoolp512r1|ed-448|ed-25519|mldsa-44|mldsa-65|mldsa-87|slhdsa-sha2-128s|slhdsa-sha2-128f|slhdsa-sha2-192s|slhdsa-sha2-192f|slhdsa-sha2-256s|slhdsa-sha2-256f|slhdsa-sha2-128ssha256|slhdsa-sha2-128fsha256|slhdsa-sha2-192ssha512|slhdsa-sha2-192fsha512|slhdsa-sha2-256ssha512|slhdsa-sha2-256fsha512)(\\+(rsa-2048|rsa-3072|rsa-4096|rsa-8192|ec-secp256r1|ec-secp384r1|ec-secp521r1|ec-brainpoolp256r1|ec-brainpoolp384r1|ec-brainpoolp512r1|ed-448|ed-25519|mldsa-44|mldsa-65|mldsa-87|slhdsa-sha2-128s|slhdsa-sha2-128f|slhdsa-sha2-192s|slhdsa-sha2-192f|slhdsa-sha2-256s|slhdsa-sha2-256f|slhdsa-sha2-128ssha256|slhdsa-sha2-128fsha256|slhdsa-sha2-192ssha512|slhdsa-sha2-192fsha512|slhdsa-sha2-256ssha512|slhdsa-sha2-256fsha512))?',
      example: 'rsa-2048',
    },
    SecretString: {
      type: 'object',
      description:
        "A secret value passed to Horizon. On create/update, set 'value'. On response the clear value is never returned.",
      properties: {
        value: {
          type: ['string', 'null'],
          description: 'Value of the secret that will be passed to Horizon',
        },
      },
    },
    MapEntry: {
      type: 'object',
      title: 'Map entry',
      properties: {
        key: {
          type: 'string',
          example: 'cn.1',
        },
        value: {
          type: 'string',
          example: 'Evertrust',
        },
      },
    },
    RESTHeader: {
      type: 'object',
      title: 'Header',
      properties: {
        name: {
          type: 'string',
          example: 'Content-Type',
        },
        value: {
          type: 'string',
          example: 'application/json',
        },
      },
      required: ['name', 'value'],
    },
    TemplateString: {
      type: 'string',
      description: 'Template string (supports dynamic attributes).',
    },
    AcmeRestRequest: {
      title: 'ACME REST Request',
      type: 'object',
      properties: {
        url: {
          $ref: '#/$defs/TemplateString',
        },
        method: {
          type: 'string',
          example: 'GET',
        },
        authenticationType: {
          type: 'string',
          enum: ['noauth', 'basic', 'x509', 'bearer', 'custom'],
        },
        credentials: {
          type: ['string', 'null'],
          example: 'myRawCredentials',
        },
        headers: {
          type: ['array', 'null'],
          items: {
            $ref: '#/$defs/RESTHeader',
          },
        },
        payloadType: {
          type: ['string', 'null'],
          example: 'json',
        },
        payload: {
          type: ['string', 'null'],
        },
        expectedHttpCodes: {
          type: 'array',
          items: {
            type: 'integer',
          },
          example: [200, 204],
        },
        proxy: {
          type: ['string', 'null'],
          example: 'ProxyForInternet',
        },
        timeout: {
          $ref: '#/$defs/FiniteDuration',
        },
      },
      required: [
        'url',
        'authenticationType',
        'method',
        'timeout',
        'expectedHttpCodes',
      ],
    },
    ManualDnsChallengeProvider: {
      title: 'Manual DNS Challenge Provider',
      type: 'object',
      properties: {
        type: {
          type: 'string',
          enum: ['manual'],
        },
        setTriggers: {
          type: 'array',
          items: {
            $ref: '#/$defs/AcmeRestRequest',
          },
        },
        unsetTriggers: {
          type: 'array',
          items: {
            $ref: '#/$defs/AcmeRestRequest',
          },
        },
      },
      required: ['type', 'setTriggers'],
    },
    NameshieldDnsChallengeProvider: {
      title: 'Nameshield DNS Challenge Provider',
      type: 'object',
      properties: {
        type: {
          type: 'string',
          enum: ['nameshield'],
        },
        credentials: {
          type: 'string',
          description: 'raw credentials name for the Nameshield API',
        },
        endPoint: {
          type: 'string',
        },
        proxy: {
          type: ['string', 'null'],
        },
        timeout: {
          $ref: '#/$defs/FiniteDuration',
        },
      },
      required: ['type', 'credentials', 'endPoint', 'timeout'],
    },
    DnsChallengeProviders: {
      oneOf: [
        {
          $ref: '#/$defs/ManualDnsChallengeProvider',
        },
        {
          $ref: '#/$defs/NameshieldDnsChallengeProvider',
        },
      ],
    },
    StaticDomainDictionaryProvider: {
      title: 'Static Domain Dictionary Provider',
      type: 'object',
      properties: {
        type: {
          type: 'string',
          enum: ['static'],
        },
        domains: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              domain: {
                type: 'string',
              },
              dictionary: {
                type: 'array',
                items: {
                  $ref: '#/$defs/MapEntry',
                },
              },
            },
            required: ['domain', 'dictionary'],
          },
        },
      },
      required: ['type', 'domains'],
    },
    DomainDictionaryProviders: {
      oneOf: [
        {
          $ref: '#/$defs/StaticDomainDictionaryProvider',
        },
      ],
    },
    IntegratedAsyncParams: {
      type: 'object',
      description:
        'Parameters for the connector to mimic asynchronous enrollment behavior',
      properties: {
        responseDelay: {
          $ref: '#/$defs/FiniteDuration',
        },
        certificateCacheDuration: {
          $ref: '#/$defs/FiniteDuration',
        },
      },
      required: ['responseDelay', 'certificateCacheDuration'],
    },
    StreamConnector: {
      title: 'Stream',
      type: 'object',
      properties: {
        name: {
          $ref: '#/$defs/ConnectorName',
        },
        type: {
          type: 'string',
          enum: ['stream'],
        },
        endPoint: {
          type: 'string',
          description: "Stream's base endpoint",
        },
        template: {
          type: 'string',
          description: "Stream's certificate template to use for enrollment",
        },
        ca: {
          type: 'string',
          description: "Stream's technical name of the CA on which to enroll",
        },
        loginCredentials: {
          type: ['string', 'null'],
          description:
            'password credentials name. At least one of loginCredentials/authenticationCredentials is required (server-enforced).',
        },
        authenticationCredentials: {
          type: ['string', 'null'],
          description:
            'certificate credentials name. At least one of loginCredentials/authenticationCredentials is required (server-enforced).',
        },
        timeout: {
          $ref: '#/$defs/FiniteDuration',
        },
        proxy: {
          type: ['string', 'null'],
        },
        queue: {
          type: ['string', 'null'],
        },
      },
      required: ['name', 'type', 'endPoint', 'template', 'ca'],
    },
    AcmeEnrollConnector: {
      title: 'Acme enroll',
      type: 'object',
      description:
        'Enroll certificates using the ACME protocol with DNS challenge.',
      properties: {
        name: {
          $ref: '#/$defs/ConnectorName',
        },
        type: {
          type: 'string',
          enum: ['acmeenroll'],
        },
        endPoint: {
          type: 'string',
          description: 'The directory url of the ACME endpoint',
        },
        timeout: {
          $ref: '#/$defs/FiniteDuration',
        },
        proxy: {
          type: ['string', 'null'],
        },
        queue: {
          type: ['string', 'null'],
        },
        eab: {
          type: ['string', 'null'],
          description: 'password credentials name for External Account Binding',
        },
        eabMacAlgorithm: {
          type: ['string', 'null'],
          enum: ['HS256', 'HS384', 'HS512', null],
          description: 'Can only be set when eab is defined (server-enforced).',
        },
        accountKeyType: {
          $ref: '#/$defs/KeyType',
        },
        accountEmail: {
          type: ['string', 'null'],
        },
        rotateAccount: {
          type: ['boolean', 'null'],
          description:
            'If true on update, regenerate the account. Reset to null by server after hooks.',
        },
        domainDictionaryProvider: {
          oneOf: [
            {
              $ref: '#/$defs/DomainDictionaryProviders',
            },
            {
              type: 'null',
            },
          ],
        },
        retryInterval: {
          $ref: '#/$defs/PositiveFiniteDuration',
          default: '6s',
        },
        dnsChallengeProvider: {
          $ref: '#/$defs/DnsChallengeProviders',
        },
      },
      required: [
        'name',
        'endPoint',
        'timeout',
        'type',
        'accountKeyType',
        'dnsChallengeProvider',
      ],
    },
    AcmeRevocationConnector: {
      title: 'Acme revocation',
      type: 'object',
      properties: {
        name: {
          $ref: '#/$defs/ConnectorName',
        },
        type: {
          type: 'string',
          enum: ['acmerevoke'],
        },
        acmeDirectoryUrl: {
          type: 'string',
          description: 'The directory url of the ACME endpoint',
        },
        timeout: {
          $ref: '#/$defs/FiniteDuration',
        },
        proxy: {
          type: ['string', 'null'],
        },
        queue: {
          type: ['string', 'null'],
        },
      },
      required: ['name', 'acmeDirectoryUrl', 'type'],
    },
    EverTrustADCSConnector: {
      title: 'ADCS',
      type: 'object',
      properties: {
        name: {
          $ref: '#/$defs/ConnectorName',
        },
        type: {
          type: 'string',
          enum: ['evtadcs'],
        },
        endPoint: {
          type: 'string',
        },
        caConfig: {
          type: 'string',
        },
        profile: {
          type: 'string',
        },
        domain: {
          type: 'string',
        },
        loginCredentials: {
          type: 'string',
          description: 'password credentials name for the technical account',
        },
        enrollmentCredentials: {
          type: 'string',
          description: 'certificate credentials name to enroll',
        },
        timeout: {
          $ref: '#/$defs/FiniteDuration',
        },
        proxy: {
          type: ['string', 'null'],
        },
        queue: {
          type: ['string', 'null'],
        },
      },
      required: [
        'name',
        'type',
        'endPoint',
        'caConfig',
        'profile',
        'domain',
        'loginCredentials',
        'enrollmentCredentials',
      ],
    },
    AWSACMPCAConnector: {
      title: 'AWS ACM PCA',
      type: 'object',
      properties: {
        name: {
          $ref: '#/$defs/ConnectorName',
        },
        type: {
          type: 'string',
          enum: ['awsacmpca'],
        },
        region: {
          type: 'string',
        },
        caArn: {
          type: 'string',
        },
        accessCredentials: {
          type: ['string', 'null'],
          description:
            'password credentials with Access Key Id / Secret Access Key. If absent, environment account is used.',
        },
        templateArn: {
          type: ['string', 'null'],
        },
        roleArn: {
          type: ['string', 'null'],
        },
        validDays: {
          $ref: '#/$defs/FiniteDuration',
        },
        retryInterval: {
          $ref: '#/$defs/PositiveFiniteDuration',
        },
        signingHash: {
          type: ['string', 'null'],
        },
        certificateUsage: {
          type: ['string', 'null'],
        },
        caPolicyOid: {
          type: ['string', 'null'],
        },
        timeout: {
          $ref: '#/$defs/FiniteDuration',
        },
        proxy: {
          type: ['string', 'null'],
        },
        queue: {
          type: ['string', 'null'],
        },
      },
      required: ['name', 'type', 'region', 'caArn'],
    },
    CertEuropeConnector: {
      title: 'CertEurope',
      type: 'object',
      properties: {
        name: {
          $ref: '#/$defs/ConnectorName',
        },
        type: {
          type: 'string',
          enum: ['certeurope'],
        },
        endPoint: {
          type: 'string',
        },
        loginCredentials: {
          type: 'string',
          description: 'password credentials name',
        },
        offerId: {
          type: 'string',
        },
        organizationId: {
          type: 'string',
        },
        revReason: {
          type: ['string', 'null'],
        },
        retryInterval: {
          $ref: '#/$defs/PositiveFiniteDuration',
        },
        authenticationCredentials: {
          type: 'string',
          description: 'certificate credentials name',
        },
        timeout: {
          $ref: '#/$defs/FiniteDuration',
        },
        proxy: {
          type: ['string', 'null'],
        },
        queue: {
          type: ['string', 'null'],
        },
      },
      required: [
        'name',
        'type',
        'endPoint',
        'loginCredentials',
        'offerId',
        'authenticationCredentials',
        'organizationId',
      ],
    },
    CMPConnector: {
      title: "CS-Novidy's TrustyKey",
      type: 'object',
      properties: {
        name: {
          $ref: '#/$defs/ConnectorName',
        },
        type: {
          type: 'string',
          enum: ['cmp'],
        },
        endPoint: {
          type: 'string',
        },
        profile: {
          type: 'string',
        },
        issuerCADN: {
          type: 'string',
        },
        issuerCACert: {
          type: 'string',
        },
        signerCredentials: {
          type: 'string',
          description: 'certificate credentials name to sign',
        },
        emailMap: {
          type: ['string', 'null'],
        },
        sanDnsMap: {
          type: ['string', 'null'],
        },
        cnMap: {
          type: ['string', 'null'],
        },
        profileMap: {
          type: ['string', 'null'],
        },
        issuerMap: {
          type: ['string', 'null'],
        },
        legacyCMPStyle: {
          type: ['boolean', 'null'],
        },
        authenticationCredentials: {
          type: 'string',
          description: 'certificate credentials name',
        },
        timeout: {
          $ref: '#/$defs/FiniteDuration',
        },
        proxy: {
          type: ['string', 'null'],
        },
        queue: {
          type: ['string', 'null'],
        },
      },
      required: [
        'name',
        'type',
        'endPoint',
        'profile',
        'issuerCADN',
        'issuerCACert',
        'signerCredentials',
        'authenticationCredentials',
      ],
    },
    DigiCertConnector: {
      title: 'DigiCert CertCentral',
      type: 'object',
      properties: {
        name: {
          $ref: '#/$defs/ConnectorName',
        },
        type: {
          type: 'string',
          enum: ['digicert'],
        },
        baseUrl: {
          type: 'string',
          enum: [
            'https://www.digicert.com/',
            'https://certcentral.digicert.eu/',
          ],
        },
        productId: {
          type: 'string',
        },
        apiCredentials: {
          type: 'string',
          description: 'raw credentials name containing the API key',
        },
        organizationId: {
          type: 'integer',
          format: 'int32',
        },
        caCertId: {
          type: ['string', 'null'],
        },
        retryInterval: {
          $ref: '#/$defs/PositiveFiniteDuration',
        },
        skipApproval: {
          type: ['boolean', 'null'],
        },
        customConnectorDataMapping: {
          type: ['object', 'null'],
          additionalProperties: {
            type: 'string',
          },
        },
        timeout: {
          $ref: '#/$defs/FiniteDuration',
        },
        proxy: {
          type: ['string', 'null'],
        },
        queue: {
          type: ['string', 'null'],
        },
      },
      required: ['name', 'type', 'baseUrl', 'apiCredentials', 'organizationId'],
    },
    EJBCAConnector: {
      title: 'EJBCA',
      type: 'object',
      properties: {
        name: {
          $ref: '#/$defs/ConnectorName',
        },
        type: {
          type: 'string',
          enum: ['ejbca'],
        },
        endPoint: {
          type: 'string',
        },
        profile: {
          type: 'string',
        },
        caName: {
          type: 'string',
        },
        eeProfile: {
          type: ['string', 'null'],
        },
        authenticationCredentials: {
          type: 'string',
          description: 'certificate credentials name',
        },
        timeout: {
          $ref: '#/$defs/FiniteDuration',
        },
        proxy: {
          type: ['string', 'null'],
        },
        queue: {
          type: ['string', 'null'],
        },
      },
      required: [
        'name',
        'type',
        'endPoint',
        'profile',
        'caName',
        'authenticationCredentials',
      ],
    },
    EJBCARESTConnector: {
      title: 'EJBCA REST',
      type: 'object',
      properties: {
        name: {
          $ref: '#/$defs/ConnectorName',
        },
        type: {
          type: 'string',
          enum: ['ejbca_rest'],
        },
        endPoint: {
          type: 'string',
        },
        profile: {
          type: 'string',
        },
        caName: {
          type: 'string',
        },
        eeProfile: {
          type: ['string', 'null'],
        },
        authenticationCredentials: {
          type: 'string',
          description: 'certificate credentials name',
        },
        timeout: {
          $ref: '#/$defs/FiniteDuration',
        },
        proxy: {
          type: ['string', 'null'],
        },
        queue: {
          type: ['string', 'null'],
        },
      },
      required: [
        'name',
        'type',
        'endPoint',
        'profile',
        'caName',
        'authenticationCredentials',
      ],
    },
    IDCAConnector: {
      title: 'IDCA',
      type: 'object',
      properties: {
        name: {
          $ref: '#/$defs/ConnectorName',
        },
        type: {
          type: 'string',
          enum: ['idca'],
        },
        endPoint: {
          type: 'string',
        },
        profile: {
          type: 'string',
        },
        authenticationCredentials: {
          type: ['string', 'null'],
          description: 'certificate credentials name',
        },
        timeout: {
          oneOf: [
            {
              $ref: '#/$defs/FiniteDuration',
            },
            {
              type: 'null',
            },
          ],
        },
        proxy: {
          type: ['string', 'null'],
        },
        queue: {
          type: ['string', 'null'],
        },
      },
      required: [
        'name',
        'type',
        'endPoint',
        'profile',
        'authenticationCredentials',
      ],
    },
    IntegratedCAConnector: {
      title: 'Integrated CA',
      type: 'object',
      properties: {
        name: {
          $ref: '#/$defs/ConnectorName',
        },
        type: {
          type: 'string',
          enum: ['integrated'],
        },
        caKey: {
          oneOf: [
            {
              $ref: '#/$defs/SecretString',
            },
            {
              type: 'null',
            },
          ],
        },
        caCert: {
          type: ['string', 'null'],
        },
        crlPath: {
          type: ['string', 'null'],
        },
        crlLifetime: {
          $ref: '#/$defs/FiniteDuration',
          default: '7 days',
        },
        certType: {
          type: ['string', 'null'],
        },
        signAlg: {
          type: ['string', 'null'],
        },
        crtLifetime: {
          $ref: '#/$defs/FiniteDuration',
          default: '365 days',
        },
        crtBackDate: {
          $ref: '#/$defs/FiniteDuration',
          default: '5 minutes',
        },
        checkPop: {
          type: ['boolean', 'null'],
          default: false,
        },
        asyncParams: {
          oneOf: [
            {
              $ref: '#/$defs/IntegratedAsyncParams',
            },
            {
              type: 'null',
            },
          ],
        },
        retryInterval: {
          $ref: '#/$defs/PositiveFiniteDuration',
          default: '5 seconds',
        },
        queue: {
          type: ['string', 'null'],
        },
        cryptoType: {
          type: 'string',
          enum: ['legacy', 'hybrid', 'pqc'],
        },
      },
      required: ['name', 'type', 'cryptoType'],
    },
    FCMSConnector: {
      title: 'FISid',
      type: 'object',
      properties: {
        name: {
          $ref: '#/$defs/ConnectorName',
        },
        type: {
          type: 'string',
          enum: ['fcms'],
        },
        endPoint: {
          type: 'string',
        },
        apiCredentials: {
          type: 'string',
          description: 'raw credentials name containing the API key',
        },
        templateId: {
          type: 'integer',
          format: 'int32',
        },
        defaultOwner: {
          type: 'string',
        },
        authenticationDomainId: {
          type: ['integer', 'null'],
          format: 'int32',
          minimum: 1,
        },
        ownerGroups: {
          type: ['string', 'null'],
        },
        deleteOnRevoke: {
          type: 'boolean',
        },
        timeout: {
          $ref: '#/$defs/FiniteDuration',
        },
        proxy: {
          type: ['string', 'null'],
        },
        queue: {
          type: ['string', 'null'],
        },
      },
      required: [
        'name',
        'type',
        'endPoint',
        'apiCredentials',
        'templateId',
        'defaultOwner',
        'deleteOnRevoke',
      ],
    },
    GCPConnector: {
      title: 'GCP Certificate Authority Service',
      type: 'object',
      properties: {
        name: {
          $ref: '#/$defs/ConnectorName',
        },
        type: {
          type: 'string',
          enum: ['gcp'],
        },
        projectId: {
          type: 'string',
          description:
            'Identifier of the Google Cloud project hosting the CA pool',
          example: 'my-issuing-project',
        },
        location: {
          type: 'string',
          description: 'Google Cloud location (region) of the CA pool',
          example: 'europe-west1',
        },
        caPool: {
          type: 'string',
          description:
            'Identifier of the CA pool to issue from. The pool auto-selects an enabled certificate authority.',
          example: 'my-ca-pool',
        },
        certificateLifetime: {
          $ref: '#/$defs/FiniteDuration',
          description:
            'Validity applied to every certificate issued through this connector.',
          example: '90 days',
        },
        credentials: {
          type: 'string',
          example: 'myGcpServiceAccountKey',
          description:
            'Name of the `raw` [credentials](#tag/security.credentials) holding the Google service account key (JSON). If not defined, Application Default Credentials are used (environment variable or workload identity).',
        },
        impersonation: {
          type: 'object',
          description:
            'When set, the resolved credentials impersonate the target service account.',
          properties: {
            target: {
              type: 'string',
              description: 'Email of the service account to impersonate.',
              example: 'issuer@my-issuing-project.iam.gserviceaccount.com',
            },
            lifetime: {
              $ref: '#/$defs/FiniteDuration',
              example: '1 hour',
            },
          },
          required: ['target', 'lifetime'],
        },
        certificateTemplate: {
          type: 'string',
          description:
            'Certificate template governing issuance policy. Accepts the template short name or its full resource path.',
          example: 'my-template',
        },
        endpoint: {
          type: 'string',
          description:
            'Overrides the default Certificate Authority Service address and port (`privateca.googleapis.com:443`). If not set, the default service URL is used.',
          example: 'privateca.myapi.com',
        },
        timeout: {
          $ref: '#/$defs/FiniteDuration',
          example: '5 seconds',
        },
        proxy: {
          type: 'string',
          description: 'Name of the proxy to use to connect to the GCP Api',
        },
        queue: {
          type: ['string', 'null'],
        },
      },
      required: [
        'name',
        'type',
        'projectId',
        'location',
        'caPool',
        'certificateLifetime',
      ],
    },
    GSAtlasConnector: {
      title: 'GlobalSign Atlas',
      type: 'object',
      properties: {
        name: {
          $ref: '#/$defs/ConnectorName',
        },
        type: {
          type: 'string',
          enum: ['gsatlas'],
        },
        loginCredentials: {
          type: 'string',
          description: 'password credentials name',
        },
        hashAlgorithm: {
          type: ['string', 'null'],
        },
        certificateUsage: {
          type: ['string', 'null'],
        },
        retryInterval: {
          $ref: '#/$defs/PositiveFiniteDuration',
        },
        authenticationCredentials: {
          type: 'string',
          description: 'certificate credentials name',
        },
        timeout: {
          $ref: '#/$defs/FiniteDuration',
        },
        proxy: {
          type: ['string', 'null'],
        },
        queue: {
          type: ['string', 'null'],
        },
      },
      required: [
        'name',
        'type',
        'loginCredentials',
        'authenticationCredentials',
      ],
    },
    GSMSSLConnector: {
      title: 'GlobalSign MSSL',
      type: 'object',
      properties: {
        name: {
          $ref: '#/$defs/ConnectorName',
        },
        type: {
          type: 'string',
          enum: ['gsmssl'],
        },
        endpointType: {
          type: 'string',
        },
        profile: {
          type: 'string',
        },
        loginCredentials: {
          type: 'string',
          description: 'password credentials name',
        },
        domainId: {
          type: 'string',
        },
        certificateValidity: {
          type: ['integer', 'null'],
          format: 'int32',
        },
        defaultEmail: {
          type: ['string', 'null'],
        },
        defaultPhone: {
          type: ['string', 'null'],
        },
        retryInterval: {
          $ref: '#/$defs/PositiveFiniteDuration',
        },
        timeout: {
          $ref: '#/$defs/FiniteDuration',
        },
        proxy: {
          type: ['string', 'null'],
        },
        queue: {
          type: ['string', 'null'],
        },
      },
      required: [
        'name',
        'type',
        'endpointType',
        'profile',
        'loginCredentials',
        'domainId',
      ],
    },
    OTPKIConnector: {
      title: 'OpenTrust PKI',
      type: 'object',
      properties: {
        name: {
          $ref: '#/$defs/ConnectorName',
        },
        type: {
          type: 'string',
          enum: ['otpki'],
        },
        endPoint: {
          type: 'string',
        },
        profile: {
          type: 'string',
        },
        emailMap: {
          type: ['string', 'null'],
        },
        sanDnsMap: {
          type: ['string', 'null'],
        },
        sanEmailMap: {
          type: ['string', 'null'],
        },
        uidMap: {
          type: ['string', 'null'],
        },
        zone: {
          type: ['string', 'null'],
        },
        zoneLabel: {
          type: ['string', 'null'],
          description:
            'The label name where the zone value is stored on an enrolled certificate',
        },
        authenticationCredentials: {
          type: 'string',
          description: 'certificate credentials name',
        },
        timeout: {
          $ref: '#/$defs/FiniteDuration',
        },
        proxy: {
          type: ['string', 'null'],
        },
        queue: {
          type: ['string', 'null'],
        },
      },
      required: [
        'name',
        'type',
        'endPoint',
        'profile',
        'authenticationCredentials',
      ],
    },
    MetaPKIConnector: {
      title: 'MetaPKI',
      type: 'object',
      properties: {
        name: {
          $ref: '#/$defs/ConnectorName',
        },
        type: {
          type: 'string',
          enum: ['metapki'],
        },
        endPoint: {
          type: 'string',
          description: 'MetaPKI base endpoint',
        },
        endPointIssuingCA: {
          type: 'string',
          description: 'Certificate authority of the endpoint',
        },
        profile: {
          type: 'string',
        },
        workflow: {
          type: ['string', 'null'],
        },
        profilCle: {
          type: ['string', 'null'],
        },
        validDays: {
          $ref: '#/$defs/FiniteDuration',
        },
        formPorteurName: {
          type: ['string', 'null'],
        },
        authenticationCredentials: {
          type: ['string', 'null'],
          description: 'certificate credentials name',
        },
        timeout: {
          $ref: '#/$defs/FiniteDuration',
        },
        proxy: {
          type: ['string', 'null'],
        },
        queue: {
          type: ['string', 'null'],
        },
      },
      required: [
        'name',
        'type',
        'endPoint',
        'endPointIssuingCA',
        'profile',
        'workflow',
        'profilCle',
      ],
    },
    Nameshield: {
      title: 'Nameshield',
      type: 'object',
      properties: {
        name: {
          $ref: '#/$defs/ConnectorName',
        },
        type: {
          type: 'string',
          enum: ['nameshield'],
        },
        apiCredentials: {
          type: 'string',
          description: 'api-key credentials name',
        },
        environment: {
          type: 'string',
          enum: ['production', 'testing'],
        },
        organizationId: {
          type: 'string',
        },
        productId: {
          type: 'string',
        },
        customerId: {
          type: 'string',
        },
        customConnectorDataMapping: {
          type: ['object', 'null'],
          additionalProperties: {
            type: 'string',
          },
        },
        timeout: {
          $ref: '#/$defs/FiniteDuration',
        },
        proxy: {
          type: ['string', 'null'],
        },
        queue: {
          type: ['string', 'null'],
        },
        retryInterval: {
          $ref: '#/$defs/PositiveFiniteDuration',
        },
      },
      required: [
        'name',
        'type',
        'apiCredentials',
        'environment',
        'organizationId',
        'productId',
        'customerId',
      ],
    },
    NexusCMConnector: {
      title: 'Nexus Certificate Manager',
      type: 'object',
      properties: {
        name: {
          $ref: '#/$defs/ConnectorName',
        },
        type: {
          type: 'string',
          enum: ['nexuscm'],
        },
        endPoint: {
          type: 'string',
        },
        endPointIssuingCA: {
          type: 'string',
        },
        procedure: {
          type: 'string',
        },
        authenticationCredentials: {
          type: 'string',
          description: 'certificate credentials name',
        },
        timeout: {
          $ref: '#/$defs/FiniteDuration',
        },
        proxy: {
          type: ['string', 'null'],
        },
        queue: {
          type: ['string', 'null'],
        },
      },
      required: [
        'name',
        'type',
        'endPoint',
        'endPointIssuingCA',
        'procedure',
        'authenticationCredentials',
      ],
    },
    SectigoCMSConnector: {
      title: 'Sectigo CMS',
      type: 'object',
      properties: {
        name: {
          $ref: '#/$defs/ConnectorName',
        },
        type: {
          type: 'string',
          enum: ['sectigo'],
        },
        loginCredentials: {
          type: 'string',
          description: 'password credentials name',
        },
        customerUri: {
          type: 'string',
        },
        organizationId: {
          type: 'integer',
        },
        profile: {
          type: 'string',
        },
        retryInterval: {
          $ref: '#/$defs/PositiveFiniteDuration',
        },
        validDays: {
          $ref: '#/$defs/FiniteDuration',
        },
        endpointType: {
          type: 'string',
          enum: ['eu', 'hard', 'default'],
        },
        timeout: {
          oneOf: [
            {
              $ref: '#/$defs/FiniteDuration',
            },
            {
              type: 'null',
            },
          ],
        },
        proxy: {
          type: ['string', 'null'],
        },
        queue: {
          type: ['string', 'null'],
        },
      },
      required: [
        'name',
        'type',
        'loginCredentials',
        'customerUri',
        'organizationId',
        'profile',
      ],
    },
    SwissSignConnector: {
      title: 'Swiss Sign managed PKI',
      type: 'object',
      properties: {
        name: {
          $ref: '#/$defs/ConnectorName',
        },
        type: {
          type: 'string',
          enum: ['swisssign'],
        },
        mpkiCredentials: {
          type: 'string',
          description: 'password credentials (login=mpkiId, password=apiKey)',
        },
        endPoint: {
          type: 'string',
          example: 'https://api.ra.pre.swisssign.ch',
        },
        productUuid: {
          type: 'string',
          example: 'pma-533143cc-5v11-4b0d-7634-c69g93c02e63',
        },
        timeout: {
          $ref: '#/$defs/FiniteDuration',
        },
        proxy: {
          type: ['string', 'null'],
        },
        queue: {
          type: ['string', 'null'],
        },
      },
      required: ['name', 'type', 'mpkiCredentials', 'endPoint', 'productUuid'],
    },
  },
} as const;
