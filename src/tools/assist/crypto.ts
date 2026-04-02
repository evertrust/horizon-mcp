import * as tls from "node:tls";
import { X509Certificate } from "node:crypto";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { HorizonClient } from "../../client/http.js";

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
    const scheme = url.protocol.replace(":", "").toLowerCase();
    const port = url.port
      ? Number(url.port)
      : DEFAULT_PORTS[scheme] ?? 443;
    return { host, port };
  }

  // host:port (numeric port only)
  if (trimmed.includes(":")) {
    const lastColon = trimmed.lastIndexOf(":");
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
// TLS certificate fetch (node:tls + node:crypto)
// ---------------------------------------------------------------------------

function fetchPeerCertificate(
  host: string,
  port: number,
  timeoutMs: number,
): Promise<X509Certificate> {
  return new Promise((resolve, reject) => {
    const socket = tls.connect(
      {
        host,
        port,
        rejectUnauthorized: false,
        checkServerIdentity: () => undefined,
        timeout: timeoutMs,
      },
      () => {
        const peerCert = socket.getPeerX509Certificate();
        socket.destroy();
        if (!peerCert) {
          reject(new Error("Server did not present a certificate"));
          return;
        }
        resolve(peerCert);
      },
    );

    socket.on("timeout", () => {
      socket.destroy();
      reject(
        new Error(
          `Connection to ${host}:${port} timed out after ${timeoutMs / 1000}s`,
        ),
      );
    });

    socket.on("error", (err: Error) => {
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
  return match?.[1] ?? "N/A";
}

function extractDnsSans(cert: X509Certificate): readonly string[] {
  const raw = cert.subjectAltName;
  if (!raw) return [];
  return raw
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.startsWith("DNS:"))
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

  server.registerTool(
    "decode_x509",
    {
      description:
        "Decode a PEM- or DER-encoded X.509 certificate via Horizon.\n\n" +
        "Safety tier: read-only\n\n" +
        "Sends the certificate to Horizon's RFC 5280 decode endpoint " +
        "(POST /api/v1/rfc5280/x509, multipart/form-data) and returns " +
        "every parsed field.\n\n" +
        "When to use: after fetching a PEM with fetch_exposed_certificate, " +
        "after retrieving a certificate from the Horizon inventory, or when a " +
        "user pastes a PEM block and wants to understand its contents.\n\n" +
        "See also: fetch_exposed_certificate, decode_csr, detect_file.",
      inputSchema: z.object({
        pem: z
          .string()
          .describe(
            "PEM-encoded X.509 certificate string (including BEGIN/END markers) " +
              "or base64-encoded DER bytes.",
          ),
      }),
    },
    async ({ pem }) => {
      const result = await client.postMultipart("/api/v1/rfc5280/x509", [
        {
          fieldName: "x509",
          filename: "certificate.pem",
          mimeType: "application/x-pem-file",
          data: pem,
        },
      ]);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(result) }],
      };
    },
  );

  // -- decode_csr -----------------------------------------------------------

  server.registerTool(
    "decode_csr",
    {
      description:
        "Decode a PEM- or DER-encoded PKCS#10 Certificate Signing Request.\n\n" +
        "Safety tier: read-only\n\n" +
        "Sends the CSR to Horizon's RFC 5280 PKCS#10 decode endpoint " +
        "(POST /api/v1/rfc5280/pkcs10, multipart/form-data) and returns " +
        "the parsed fields.\n\n" +
        "When to use: when a user provides a CSR and wants to inspect " +
        "the subject, public key, or requested extensions before submitting " +
        "it for enrollment.\n\n" +
        "See also: decode_x509, detect_file.",
      inputSchema: z.object({
        pem: z
          .string()
          .describe(
            "PEM-encoded CSR string (including BEGIN/END markers) " +
              "or base64-encoded DER bytes.",
          ),
      }),
    },
    async ({ pem }) => {
      const result = await client.postMultipart("/api/v1/rfc5280/pkcs10", [
        {
          fieldName: "pkcs10",
          filename: "request.pem",
          mimeType: "application/x-pem-file",
          data: pem,
        },
      ]);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(result) }],
      };
    },
  );

  // -- decode_crl -----------------------------------------------------------

  server.registerTool(
    "decode_crl",
    {
      description:
        "Decode a PEM- or DER-encoded Certificate Revocation List (CRL).\n\n" +
        "Safety tier: read-only\n\n" +
        "Sends the CRL to Horizon's RFC 5280 CRL decode endpoint " +
        "(POST /api/v1/rfc5280/crl, multipart/form-data) and returns " +
        "the parsed fields.\n\n" +
        "When to use: when a user provides a CRL and wants to check the " +
        "issuer, update timestamps, or CRL number.\n\n" +
        "See also: decode_x509, detect_file.",
      inputSchema: z.object({
        data: z
          .string()
          .describe(
            "PEM-encoded CRL string (including BEGIN/END markers) " +
              "or base64-encoded DER bytes.",
          ),
      }),
    },
    async ({ data }) => {
      const result = await client.postMultipart("/api/v1/rfc5280/crl", [
        {
          fieldName: "crl",
          filename: "revocation.crl",
          mimeType: "application/x-pem-file",
          data,
        },
      ]);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(result) }],
      };
    },
  );

  // -- decode_ocsp ----------------------------------------------------------

  server.registerTool(
    "decode_ocsp",
    {
      description:
        "Decode an OCSP response (RFC 6960).\n\n" +
        "Safety tier: read-only\n\n" +
        "Sends the OCSP response to Horizon's RFC 6960 decode endpoint " +
        "(POST /api/v1/rfc6960, multipart/form-data) and returns the " +
        "parsed status and per-certificate responses.\n\n" +
        "When to use: when a user has captured an OCSP response (DER " +
        "bytes, typically base64-encoded) and wants to inspect the revocation " +
        "status, responder identity, or per-certificate details.\n\n" +
        "See also: decode_x509.",
      inputSchema: z.object({
        data: z
          .string()
          .describe("Base64-encoded DER bytes of the OCSP response."),
      }),
    },
    async ({ data }) => {
      const result = await client.postMultipart("/api/v1/rfc6960", [
        {
          fieldName: "ocsp-response",
          filename: "response.der",
          mimeType: "application/octet-stream",
          data,
        },
      ]);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(result) }],
      };
    },
  );

  // -- decode_tsa -----------------------------------------------------------

  server.registerTool(
    "decode_tsa",
    {
      description:
        "Decode a TSA (Time-Stamp Authority) response (RFC 3161).\n\n" +
        "Safety tier: read-only\n\n" +
        "Sends the timestamping response to Horizon's RFC 3161 decode " +
        "endpoint (POST /api/v1/rfc3161, multipart/form-data) and returns " +
        "the parsed fields.\n\n" +
        "When to use: when a user has captured a timestamping response " +
        "(DER bytes, typically base64-encoded) and wants to verify the " +
        "timestamp policy and status.\n\n" +
        "See also: decode_x509.",
      inputSchema: z.object({
        data: z
          .string()
          .describe(
            "Base64-encoded DER bytes of the timestamping response.",
          ),
      }),
    },
    async ({ data }) => {
      const result = await client.postMultipart("/api/v1/rfc3161", [
        {
          fieldName: "timestamping-response",
          filename: "timestamp.der",
          mimeType: "application/octet-stream",
          data,
        },
      ]);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(result) }],
      };
    },
  );

  // -- detect_file ----------------------------------------------------------

  server.registerTool(
    "detect_file",
    {
      description:
        "Auto-detect and decode any cryptographic file.\n\n" +
        "Safety tier: read-only\n\n" +
        "Sends the raw data to Horizon's crypto detection endpoint " +
        "(POST /api/v1/crypto/detect, multipart/form-data). Horizon " +
        "identifies the file type and returns both the type label and the " +
        "decoded content.\n\n" +
        "When to use: when the user provides an unknown blob of PEM, " +
        "DER, or PKCS#7 data and you need to figure out what it is before " +
        "choosing the right decode tool.\n\n" +
        "See also: decode_x509, decode_csr, decode_crl, decode_ocsp, decode_tsa.",
      inputSchema: z.object({
        data: z
          .string()
          .describe(
            "The cryptographic data to detect and parse. Can be " +
              "PEM-encoded, base64-encoded DER, or PKCS#7 content.",
          ),
      }),
    },
    async ({ data }) => {
      const result = await client.postMultipart("/api/v1/crypto/detect", [
        {
          fieldName: "file",
          filename: "unknown.bin",
          mimeType: "application/octet-stream",
          data,
        },
      ]);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(result) }],
      };
    },
  );

  // -- fetch_exposed_certificate --------------------------------------------

  server.registerTool(
    "fetch_exposed_certificate",
    {
      description:
        "Fetch the TLS certificate exposed by a remote server.\n\n" +
        "Safety tier: read-only (outbound TLS connection only, no data sent)\n\n" +
        "Connects to the specified host and port, performs a TLS handshake, " +
        "and retrieves the server's leaf certificate. Useful for:\n" +
        "- Verifying a certificate deployed through the CLM is actually live\n" +
        "- Comparing the exposed certificate against what Horizon manages\n" +
        "- Feeding the PEM into decode_x509 for detailed parsing\n" +
        "- Importing discovered certificates into Horizon via discovery feed\n\n" +
        "The URI format is protocol://fqdn:port or just fqdn:port.\n" +
        "The protocol is used only to determine the default port if omitted:\n" +
        "- https -> 443\n" +
        "- ldaps -> 636\n" +
        "- imaps -> 993\n" +
        "- smtps -> 465\n" +
        "- ftps  -> 990\n" +
        "If no protocol and no port, defaults to 443.\n\n" +
        "See also: decode_x509 - decode the fetched PEM for detailed parsing.",
      inputSchema: z.object({
        uri: z
          .string()
          .describe(
            "Target endpoint. Examples: " +
              "https://www.example.com, " +
              "ldaps://dc01.corp.local:636, " +
              "192.168.1.1:8443, " +
              "mail.example.com:993",
          ),
        timeout: z
          .number()
          .int()
          .positive()
          .default(10)
          .describe("Connection timeout in seconds (default 10)."),
      }),
    },
    async ({ uri, timeout }) => {
      const { host, port } = parseTlsUri(uri);
      const timeoutMs = timeout * 1000;

      let cert: X509Certificate;
      try {
        cert = await fetchPeerCertificate(host, port, timeoutMs);
      } catch (err) {
        const message =
          err instanceof Error ? err.message : String(err);

        // Timeout errors
        if (message.includes("timed out")) {
          return {
            content: [
              {
                type: "text" as const,
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
              type: "text" as const,
              text: JSON.stringify({
                error: true,
                content: `Cannot connect to ${host}:${port}: ${message}`,
              }),
            },
          ],
        };
      }

      const pem = cert.toString();
      const cn = extractSubjectCN(cert);
      const dnsSans = extractDnsSans(cert);
      const thumbprint = cert
        .fingerprint256.replace(/:/g, "")
        .toLowerCase();

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
      };

      return {
        content: [{ type: "text" as const, text: JSON.stringify(result) }],
      };
    },
  );

  // -- convert_pkcs12_to_jks (stub) -----------------------------------------

  server.registerTool(
    "convert_pkcs12_to_jks",
    {
      description:
        "Convert a PKCS#12 (.p12/.pfx) bundle to a Java KeyStore (.jks) file. " +
        "Takes a base64-encoded PKCS#12 bundle and password, returns a base64-encoded JKS " +
        "keystore. Chain with download_certificate (format=pkcs12) for Java deployments.",
      inputSchema: z.object({
        pkcs12_base64: z
          .string()
          .describe("Base64-encoded PKCS#12 bundle"),
        pkcs12_password: z
          .string()
          .describe("Password for the PKCS#12 bundle"),
        jks_password: z
          .string()
          .optional()
          .describe(
            "Password for the output JKS keystore (defaults to pkcs12_password)",
          ),
        alias: z
          .string()
          .default("horizon")
          .describe("Key entry alias in the JKS keystore"),
      }),
    },
    async (_params) => {
      throw new Error(
        "convert_pkcs12_to_jks is not yet implemented. " +
          "JKS conversion support will be added in a future release.",
      );
    },
  );
}
