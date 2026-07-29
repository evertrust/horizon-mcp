import type { McpServer } from '@modelcontextprotocol/server';
import { X509Certificate } from 'node:crypto';
import * as dns from 'node:dns';
import * as net from 'node:net';
import * as tls from 'node:tls';
import { z } from 'zod';

import { HorizonError, redactValue } from '../../client/errors.js';
import type { HorizonClient } from '../../client/http.js';
import { getLogger } from '../../logging.js';
import { registerTool } from '../register.js';

const cryptoLogger = getLogger('horizon_mcp.tools.crypto');

// Upper bound on crypto decode input size. ~2 MB comfortably covers any real
// PEM/DER/PKCS#7 bundle while bounding the payload forwarded to Horizon.
const MAX_CRYPTO_INPUT_BYTES = 2_000_000;

// ---------------------------------------------------------------------------
// Default port lookup for TLS URI parsing
// ---------------------------------------------------------------------------

const DEFAULT_PORTS: Readonly<Record<string, number>> = {
  https: 443,
  ldaps: 636,
  imaps: 993,
  smtps: 465,
  ftps: 990,
};

// ---------------------------------------------------------------------------
// URI parsing helper
// ---------------------------------------------------------------------------

function parseTlsUri(uri: string): { host: string; port: number } {
  const trimmed = uri.trim();

  // scheme://host[:port]
  const schemeMatch = trimmed.match(/^([a-z]+):\/\//i);
  if (schemeMatch) {
    const url = new URL(trimmed);
    const host = url.hostname;
    const scheme = url.protocol.replace(':', '').toLowerCase();
    const port = url.port ? Number(url.port) : (DEFAULT_PORTS[scheme] ?? 443);
    return { host, port };
  }

  // host:port (numeric port only)
  if (trimmed.includes(':')) {
    const lastColon = trimmed.lastIndexOf(':');
    const maybePort = trimmed.slice(lastColon + 1);
    const parsed = Number(maybePort);
    if (!Number.isNaN(parsed) && parsed > 0 && parsed <= 65535) {
      return { host: trimmed.slice(0, lastColon), port: parsed };
    }
  }

  // bare hostname - default to 443
  return { host: trimmed, port: 443 };
}

// ---------------------------------------------------------------------------
// SSRF guard: block private/link-local IPs unless explicitly allowed
// ---------------------------------------------------------------------------

function parseIpv4(addr: string): readonly number[] | undefined {
  if (net.isIPv4(addr) !== true) return undefined;
  const parts = addr.split('.').map((p) => Number(p));
  return parts.length === 4 && parts.every((p) => Number.isInteger(p))
    ? parts
    : undefined;
}

function isPrivateIpv4(addr: string): boolean {
  const o = parseIpv4(addr);
  if (!o) return false;
  if (o[0] === 10) return true; // 10.0.0.0/8
  if (o[0] === 127) return true; // 127.0.0.0/8 (loopback)
  if (o[0] === 0) return true; // 0.0.0.0/8
  if (o[0]! >= 224) return true; // 224.0.0.0/4 multicast and above (incl. 240/4)
  if (o[0] === 169 && o[1] === 254) return true; // 169.254.0.0/16 link-local
  if (o[0] === 172 && o[1]! >= 16 && o[1]! <= 31) return true; // 172.16.0.0/12
  if (o[0] === 192 && o[1] === 168) return true; // 192.168.0.0/16
  if (o[0] === 100 && o[1]! >= 64 && o[1]! <= 127) return true; // 100.64.0.0/10 CGNAT
  return false;
}

function isPrivateIpv6(addr: string): boolean {
  if (net.isIPv6(addr) !== true) return false;
  const lower = addr.toLowerCase();
  if (lower === '::1') return true; // loopback
  if (lower === '::') return true; // unspecified
  // IPv4-mapped IPv6 (::ffff:0:0/96) - re-check embedded IPv4
  const mapped = lower.match(/^::ffff:([0-9a-f.:]+)$/);
  if (mapped) {
    const embedded = mapped[1]!;
    if (net.isIPv4(embedded)) {
      return isPrivateIpv4(embedded);
    }
  }
  // fe80::/10 link-local
  if (/^fe[89ab][0-9a-f]?:/.test(lower)) return true;
  // fc00::/7 unique local
  if (/^f[cd][0-9a-f]{2}:/.test(lower)) return true;
  return false;
}

function isPrivateAddress(addr: string): boolean {
  return isPrivateIpv4(addr) || isPrivateIpv6(addr);
}

export async function resolveAndCheckHost(
  host: string,
): Promise<{ ip: string }> {
  // If the user already passed an IP literal, bypass DNS entirely.
  const direct = net.isIP(host);
  const ip = direct
    ? host
    : (await dns.promises.lookup(host, { all: false })).address;

  if (
    process.env['HORIZON_ALLOW_PRIVATE_TLS_PROBE'] !== '1' &&
    isPrivateAddress(ip)
  ) {
    throw new Error(
      `Private/link-local IP ${ip} (resolved from ${host}) blocked. ` +
        'Set HORIZON_ALLOW_PRIVATE_TLS_PROBE=1 to override.',
    );
  }

  return { ip };
}

// ---------------------------------------------------------------------------
// TLS certificate fetch (node:tls + node:crypto)
// ---------------------------------------------------------------------------

function fetchPeerCertificate(
  ip: string,
  servername: string,
  port: number,
  timeoutMs: number,
): Promise<X509Certificate> {
  return new Promise((resolve, reject) => {
    // Connect to the resolved IP literal and pass the original hostname as
    // servername for SNI. This avoids a second DNS lookup that could return
    // a different (public) IP than the one we already validated (TOCTOU).
    const socket = tls.connect(
      {
        host: ip,
        servername,
        port,
        rejectUnauthorized: false,
        checkServerIdentity: () => undefined,
        timeout: timeoutMs,
      },
      () => {
        const peerCert = socket.getPeerX509Certificate();
        socket.destroy();
        if (!peerCert) {
          reject(new Error('Server did not present a certificate'));
          return;
        }
        resolve(peerCert);
      },
    );

    socket.on('timeout', () => {
      socket.destroy();
      reject(
        new Error(
          `Connection to ${servername}:${port} timed out after ${timeoutMs / 1000}s`,
        ),
      );
    });

    socket.on('error', (err: Error) => {
      socket.destroy();
      reject(err);
    });
  });
}

// ---------------------------------------------------------------------------
// Certificate metadata extraction
// ---------------------------------------------------------------------------

function extractSubjectCN(cert: X509Certificate): string {
  const match = cert.subject.match(/CN=([^\n]+)/);
  return match?.[1] ?? 'N/A';
}

function extractDnsSans(cert: X509Certificate): readonly string[] {
  const raw = cert.subjectAltName;
  if (!raw) return [];
  return raw
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.startsWith('DNS:'))
    .map((entry) => entry.slice(4));
}

// ---------------------------------------------------------------------------
// Tool registration
// ---------------------------------------------------------------------------

export function registerCryptoTools(
  server: McpServer,
  client: HorizonClient,
): void {
  // -- decode_x509 ----------------------------------------------------------

  registerTool(
    server,
    'decode_x509',
    {
      description:
        'Decode a PEM- or DER-encoded X.509 certificate via Horizon.\n\n' +
        "Sends the certificate to Horizon's RFC 5280 decode endpoint " +
        '(POST /api/v1/rfc5280/x509, multipart/form-data) and returns ' +
        'every parsed field.\n\n' +
        'When to use: after fetching a PEM with fetch_exposed_certificate, ' +
        'after retrieving a certificate from the Horizon inventory, or when a ' +
        'user pastes a PEM block and wants to understand its contents.\n\n' +
        'Returns: JSON object with the following fields:\n' +
        '- dn (str): subject distinguished name.\n' +
        '- dnElements (list): ordered list of DN attribute objects.\n' +
        '- issuerDn (str): issuer distinguished name.\n' +
        '- serial (str): serial number (hex).\n' +
        '- notBefore (int): validity start as epoch milliseconds.\n' +
        '- notAfter (int): validity end as epoch milliseconds.\n' +
        '- keyType (str): public key algorithm, e.g. RSA, EC.\n' +
        '- signingAlgorithm (str): signature algorithm OID / name.\n' +
        '- pem (str): normalised PEM.\n' +
        '- subjectKeyIdentifier (str): SKI hex string.\n' +
        '- certificateThumbprint (str): SHA-256 thumbprint.\n' +
        '- certificateSHAOneThumbprint (str): SHA-1 thumbprint.\n' +
        '- publicKeyThumbprint (str): public-key SHA-256 thumbprint.\n' +
        '- keyUsages (list[str]): key-usage flags.\n' +
        '- isKeyUsagesCritical (bool): whether KU extension is critical.\n' +
        '- extendedKeyUsages (list[str]): EKU OIDs.\n' +
        '- isExtendedKeyUsagesCritical (bool): whether EKU is critical.\n' +
        '- selfSigned (bool): true when issuer == subject and self-signed.\n' +
        '- sans (list[{sanType, value}], optional): subject alternative names.\n' +
        '- basicConstraints (object, optional): CA flag and path length.\n' +
        '- extensions (list, optional): all extensions.\n' +
        '- crldps (list[str], optional): CRL distribution points.\n' +
        '- aias ({crt, ocsp}, optional): authority information access.\n' +
        '- policies (list, optional): certificate policies.\n' +
        '- authorityKeyIdentifier (str, optional): AKI.\n' +
        '- unsupportedExtensions (list, optional): unrecognised extensions.\n\n' +
        '- fetch_exposed_certificate - grab a live server cert then feed its PEM into this tool.\n' +
        '- decode_csr - decode a CSR instead.\n' +
        '- detect_file - auto-detect the file type first.',
      inputSchema: z.object({
        pem: z
          .string()
          .max(MAX_CRYPTO_INPUT_BYTES, 'Input exceeds 2 MB limit')
          .describe(
            'PEM-encoded X.509 certificate string (including BEGIN/END markers) ' +
              'or base64-encoded DER bytes.',
          ),
      }),
    },
    async ({ pem }) => {
      const result = await client.postMultipart('/api/v1/rfc5280/x509', [
        {
          fieldName: 'x509',
          filename: 'certificate.pem',
          mimeType: 'application/x-pem-file',
          data: pem,
        },
      ]);
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(result) }],
      };
    },
  );

  // -- decode_csr -----------------------------------------------------------

  registerTool(
    server,
    'decode_csr',
    {
      description:
        'Decode a PEM- or DER-encoded PKCS#10 Certificate Signing Request.\n\n' +
        "Sends the CSR to Horizon's RFC 5280 PKCS#10 decode endpoint " +
        '(POST /api/v1/rfc5280/pkcs10, multipart/form-data) and returns ' +
        'the parsed fields.\n\n' +
        'When to use: when a user provides a CSR and wants to inspect ' +
        'the subject, public key, or requested extensions before submitting ' +
        'it for enrollment.\n\n' +
        'Returns: JSON object with the following fields:\n' +
        '- dn (str): requested subject distinguished name.\n' +
        '- dnElements (list): ordered list of DN attribute objects.\n' +
        '- keyType (str): public key algorithm.\n' +
        '- pem (str): normalised PEM.\n' +
        '- sans (list[{sanType, value}], optional): requested SANs.\n' +
        '- extensions (list, optional): requested extensions.\n' +
        '- unsupportedExtensions (list, optional): unrecognised extensions.\n\n' +
        '- decode_x509 - decode a certificate instead.\n' +
        '- detect_file - auto-detect whether input is a cert or CSR.',
      inputSchema: z.object({
        pem: z
          .string()
          .max(MAX_CRYPTO_INPUT_BYTES, 'Input exceeds 2 MB limit')
          .describe(
            'PEM-encoded CSR string (including BEGIN/END markers) ' +
              'or base64-encoded DER bytes.',
          ),
      }),
    },
    async ({ pem }) => {
      const result = await client.postMultipart('/api/v1/rfc5280/pkcs10', [
        {
          fieldName: 'pkcs10',
          filename: 'request.pem',
          mimeType: 'application/x-pem-file',
          data: pem,
        },
      ]);
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(result) }],
      };
    },
  );

  // -- decode_crl -----------------------------------------------------------

  registerTool(
    server,
    'decode_crl',
    {
      description:
        'Decode a PEM- or DER-encoded Certificate Revocation List (CRL).\n\n' +
        "Sends the CRL to Horizon's RFC 5280 CRL decode endpoint " +
        '(POST /api/v1/rfc5280/crl, multipart/form-data) and returns ' +
        'the parsed fields.\n\n' +
        'When to use: when a user provides a CRL and wants to check the ' +
        'issuer, update timestamps, or CRL number.\n\n' +
        'Returns: JSON object with the following fields:\n' +
        '- issuerDn (str): CRL issuer distinguished name.\n' +
        '- thisUpdate (int): issuance date as epoch milliseconds.\n' +
        '- nextUpdate (int): next scheduled update as epoch milliseconds.\n' +
        '- number (int, optional): CRL sequence number.\n' +
        '- version (int, optional): CRL version.\n\n' +
        '- decode_x509 - decode the issuing CA certificate.\n' +
        '- detect_file - auto-detect whether input is a CRL.',
      inputSchema: z.object({
        data: z
          .string()
          .max(MAX_CRYPTO_INPUT_BYTES, 'Input exceeds 2 MB limit')
          .describe(
            'PEM-encoded CRL string (including BEGIN/END markers) ' +
              'or base64-encoded DER bytes.',
          ),
      }),
    },
    async ({ data }) => {
      const result = await client.postMultipart('/api/v1/rfc5280/crl', [
        {
          fieldName: 'crl',
          filename: 'revocation.crl',
          mimeType: 'application/x-pem-file',
          data,
        },
      ]);
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(result) }],
      };
    },
  );

  // -- decode_ocsp ----------------------------------------------------------

  registerTool(
    server,
    'decode_ocsp',
    {
      description:
        'Decode an OCSP response (RFC 6960).\n\n' +
        "Sends the OCSP response to Horizon's RFC 6960 decode endpoint " +
        '(POST /api/v1/rfc6960, multipart/form-data) and returns the ' +
        'parsed status and per-certificate responses.\n\n' +
        'When to use: when a user has captured an OCSP response (DER ' +
        'bytes, typically base64-encoded) and wants to inspect the revocation ' +
        'status, responder identity, or per-certificate details.\n\n' +
        'Returns: JSON object with the following fields:\n' +
        '- status (str): top-level response status - one of\n' +
        '  "successful", "malformedRequest", "internalError",\n' +
        '  "tryLater", "sigRequired", "unauthorized".\n' +
        '- respID (str, optional): responder identifier.\n' +
        '- responses (list, optional): per-certificate entries, each with:\n' +
        '    - certID (object): {serial, hashAlg, issuerKeyHash, issuerNameHash}.\n' +
        '    - status (str): certificate status.\n' +
        '    - thisUpdate (int): epoch milliseconds.\n' +
        '    - nextUpdate (int): epoch milliseconds.\n\n' +
        '- decode_x509 - decode the certificate referenced in the OCSP response.',
      inputSchema: z.object({
        data: z
          .string()
          .max(MAX_CRYPTO_INPUT_BYTES, 'Input exceeds 2 MB limit')
          .describe('Base64-encoded DER bytes of the OCSP response.'),
      }),
    },
    async ({ data }) => {
      const result = await client.postMultipart('/api/v1/rfc6960', [
        {
          fieldName: 'ocsp-response',
          filename: 'response.der',
          mimeType: 'application/octet-stream',
          data,
        },
      ]);
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(result) }],
      };
    },
  );

  // -- decode_tsa -----------------------------------------------------------

  registerTool(
    server,
    'decode_tsa',
    {
      description:
        'Decode a TSA (Time-Stamp Authority) response (RFC 3161).\n\n' +
        "Sends the timestamping response to Horizon's RFC 3161 decode " +
        'endpoint (POST /api/v1/rfc3161, multipart/form-data) and returns ' +
        'the parsed fields.\n\n' +
        'When to use: when a user has captured a timestamping response ' +
        '(DER bytes, typically base64-encoded) and wants to verify the ' +
        'timestamp policy and status.\n\n' +
        'Returns: JSON object with the following fields:\n' +
        '- policy (str): OID of the TSA policy.\n' +
        '- status (str|int): response status.\n' +
        '- failInfo (str, optional): failure reason when status is not granted.\n\n' +
        '- decode_x509 - decode the TSA signing certificate.',
      inputSchema: z.object({
        data: z
          .string()
          .max(MAX_CRYPTO_INPUT_BYTES, 'Input exceeds 2 MB limit')
          .describe('Base64-encoded DER bytes of the timestamping response.'),
      }),
    },
    async ({ data }) => {
      const result = await client.postMultipart('/api/v1/rfc3161', [
        {
          fieldName: 'timestamping-response',
          filename: 'timestamp.der',
          mimeType: 'application/octet-stream',
          data,
        },
      ]);
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(result) }],
      };
    },
  );

  // -- detect_file ----------------------------------------------------------

  registerTool(
    server,
    'detect_file',
    {
      description:
        'Auto-detect and decode any cryptographic file.\n\n' +
        "Sends the raw data to Horizon's crypto detection endpoint " +
        '(POST /api/v1/crypto/detect, multipart/form-data). Horizon ' +
        'identifies the file type and returns both the type label and the ' +
        'decoded content.\n\n' +
        'When to use: when the user provides an unknown blob of PEM, ' +
        'DER, or PKCS#7 data and you need to figure out what it is before ' +
        'choosing the right decode tool.\n\n' +
        'Returns: JSON object with the following fields:\n' +
        '- type (str): detected type - one of "certificate",\n' +
        '  "csr", "crl", "bundle", "ocsp-response",\n' +
        '  "timestamping-response", "openssh-cert".\n' +
        '- value (object): decoded content whose schema matches the\n' +
        '  corresponding decode tool (e.g., same fields as decode_x509\n' +
        '  when type is "certificate").\n\n' +
        '- decode_x509, decode_csr, decode_crl,\n' +
        '  decode_ocsp, decode_tsa - specialised decode tools\n' +
        '  for when the file type is already known.',
      inputSchema: z.object({
        data: z
          .string()
          .max(MAX_CRYPTO_INPUT_BYTES, 'Input exceeds 2 MB limit')
          .describe(
            'The cryptographic data to detect and parse. Can be ' +
              'PEM-encoded, base64-encoded DER, or PKCS#7 content.',
          ),
      }),
    },
    async ({ data }) => {
      const result = await client.postMultipart('/api/v1/crypto/detect', [
        {
          fieldName: 'file',
          filename: 'unknown.bin',
          mimeType: 'application/octet-stream',
          data,
        },
      ]);
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(result) }],
      };
    },
  );

  // -- fetch_exposed_certificate --------------------------------------------

  registerTool(
    server,
    'fetch_exposed_certificate',
    {
      description:
        'Fetch the TLS certificate exposed by a remote server.\n\n' +
        'Connects to the specified host and port, performs a TLS handshake, ' +
        "and retrieves the server's leaf certificate. Useful for:\n" +
        '- Verifying a certificate deployed through the CLM is actually live\n' +
        '- Comparing the exposed certificate against what Horizon manages\n' +
        '- Feeding the PEM into decode_x509 for detailed parsing\n' +
        '- Importing discovered certificates into Horizon via discovery feed\n\n' +
        'The URI format is protocol://fqdn:port or just fqdn:port.\n' +
        'The protocol is used only to determine the default port if omitted:\n' +
        '- https -> 443\n' +
        '- ldaps -> 636\n' +
        '- imaps -> 993\n' +
        '- smtps -> 465\n' +
        '- ftps  -> 990\n' +
        'If no protocol and no port, defaults to 443.\n\n' +
        'The certificate is fetched as-is without chain or hostname ' +
        'verification - do not treat the result as a trusted/validated ' +
        'certificate.',
      inputSchema: z.object({
        uri: z
          .string()
          .describe(
            'Target endpoint. Examples: ' +
              'https://www.example.com, ' +
              'ldaps://dc01.corp.local:636, ' +
              '192.168.1.1:8443, ' +
              'mail.example.com:993',
          ),
        timeout: z
          .number()
          .int()
          .positive()
          .default(10)
          .describe('Connection timeout in seconds (default 10).'),
      }),
    },
    async ({ uri, timeout }) => {
      const { host, port } = parseTlsUri(uri);
      const timeoutMs = timeout * 1000;

      let resolvedIp: string;
      try {
        const resolved = await resolveAndCheckHost(host);
        resolvedIp = resolved.ip;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({
                error: true,
                content: `Cannot probe ${host}:${port}: ${redactValue(message)}`,
              }),
            },
          ],
        };
      }

      cryptoLogger.info('fetch_exposed_certificate probe', {
        host,
        resolved_ip: resolvedIp,
        port,
      });

      let cert: X509Certificate;
      try {
        cert = await fetchPeerCertificate(resolvedIp, host, port, timeoutMs);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);

        // Timeout errors
        if (message.includes('timed out')) {
          return {
            content: [
              {
                type: 'text' as const,
                text: JSON.stringify({
                  error: true,
                  content: `Connection to ${host}:${port} timed out after ${timeout}s.`,
                }),
              },
            ],
          };
        }

        // Connection errors
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({
                error: true,
                content: `Cannot connect to ${host}:${port}: ${redactValue(message)}`,
              }),
            },
          ],
        };
      }

      const pem = cert.toString();
      const cn = extractSubjectCN(cert);
      const dnsSans = extractDnsSans(cert);
      const thumbprint = cert.fingerprint256.replace(/:/g, '').toLowerCase();

      const result = {
        content:
          `Certificate from ${host}:${port} - ` +
          `CN=${cn}, ` +
          `expires ${cert.validTo}`,
        pem,
        subject: cert.subject,
        issuer: cert.issuer,
        serial: cert.serialNumber.toLowerCase(),
        not_before: cert.validFrom,
        not_after: cert.validTo,
        thumbprint_sha256: thumbprint,
        dns_sans: dnsSans,
        host,
        port,
        trusted: false,
        validation:
          'skipped (certificate fetched without chain or hostname ' +
          'verification - do not treat as trusted)',
      };

      return {
        content: [{ type: 'text' as const, text: JSON.stringify(result) }],
      };
    },
  );

  // -- convert_pkcs12_to_jks (stub) -----------------------------------------

  registerTool(
    server,
    'convert_pkcs12_to_jks',
    {
      description:
        'Convert a PKCS#12 (.p12/.pfx) bundle to a Java KeyStore (.jks) file. ' +
        'Takes a base64-encoded PKCS#12 bundle and password, returns a base64-encoded JKS ' +
        'keystore. Chain with download_certificate (format=pkcs12) for Java deployments.',
      inputSchema: z.object({
        pkcs12_base64: z.string().describe('Base64-encoded PKCS#12 bundle'),
        pkcs12_password: z.string().describe('Password for the PKCS#12 bundle'),
        jks_password: z
          .string()
          .optional()
          .describe(
            'Password for the output JKS keystore (defaults to pkcs12_password)',
          ),
        alias: z
          .string()
          .default('horizon')
          .describe('Key entry alias in the JKS keystore'),
      }),
    },
    async (_params) => {
      throw new HorizonError(501, {
        message:
          'convert_pkcs12_to_jks is not yet implemented. ' +
          'JKS conversion support will be added in a future release.',
      });
    },
  );
}
