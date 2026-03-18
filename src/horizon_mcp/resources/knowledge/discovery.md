# Certificate Discovery -- Scans, Campaigns, and CLI

## Overview

Horizon Discovery scans networks to find certificates deployed on endpoints.
Discovered certificates can be imported into monitored profiles for tracking,
grading, and expiration alerting.

---

## Core Concepts

### Campaign = Bucket

A **discovery campaign** is a named configuration that defines:
- What to scan (hosts, ports, protocols)
- Where to store results (target monitored profile)
- How often to scan (schedule)

Think of a campaign as a "bucket" -- it collects all certificates found
during its scans into a single searchable collection.

### Scan Types

| Scan Type    | Description                                                      | Default Port                    |
|--------------|------------------------------------------------------------------|---------------------------------|
| `NETSCAN`    | Network TLS scan, extracts server certificate chain              | 443                             |
| `LOCALSCAN`  | Scan local filesystem or agent-accessible stores for certificates| N/A                             |
| `NETIMPORT`  | Import certificates discovered from network sources              | N/A                             |
| `IMPORTSCAN` | Bulk import scan from external certificate data                  | N/A                             |

### Host Specifications

Campaigns accept multiple host specification formats:

| Format          | Example              | Description                          |
|-----------------|----------------------|--------------------------------------|
| Single host     | `web.example.com`    | Single hostname or IP                |
| CIDR range      | `10.0.0.0/24`        | Entire subnet                        |
| Range           | `10.0.0.1-10.0.0.50` | IP range                            |
| Wildcard        | `*.example.com`      | DNS wildcard (requires resolver)     |
| File            | `@hosts.txt`         | Read hosts from file, one per line   |

### Default Ports

When no ports are specified, the scanner checks common TLS ports:

```
443, 8443, 636, 993, 995, 465, 5986, 3389
```

---

## Campaign Object Structure

```json
{
  "name": "internal-tls-scan",
  "description": "Scan internal network for TLS certificates",
  "profile": "Monitored-Internal",
  "scanType": "NETSCAN",
  "hosts": ["10.0.0.0/24", "web.internal.example.com"],
  "ports": [443, 8443],
  "schedule": {
    "type": "cron",
    "expression": "0 2 * * 1"
  },
  "enabled": true,
  "timeout": 5000,
  "concurrency": 50
}
```

---

## Discovery CLI

Horizon provides a CLI agent (`horizon-discover`) for running scans.
The agent connects to the Horizon server to report results.

### Basic Usage

```bash
# Run a TLS scan
horizon-discover scan tls \
  --hosts 10.0.0.0/24 \
  --ports 443,8443 \
  --campaign internal-tls-scan \
  --horizon-url https://horizon.example.com \
  --api-key $HORIZON_API_KEY

# Run a file scan
horizon-discover scan file \
  --paths /etc/ssl/certs,/opt/app/certs \
  --campaign file-scan \
  --horizon-url https://horizon.example.com

# Run from campaign config (pulls settings from server)
horizon-discover run --campaign internal-tls-scan \
  --horizon-url https://horizon.example.com
```

### CLI Options

| Flag               | Description                                    |
|--------------------|------------------------------------------------|
| `--hosts`          | Comma-separated host specifications            |
| `--ports`          | Comma-separated port list                      |
| `--campaign`       | Campaign name to report results to             |
| `--horizon-url`    | Horizon server URL                             |
| `--api-key`        | API key for authentication                     |
| `--timeout`        | Per-host connection timeout in ms (default 5000)|
| `--concurrency`    | Maximum concurrent connections (default 50)    |
| `--insecure`       | Skip TLS verification for the Horizon connection|

---

## Campaign API Operations

| Operation          | Method | Path                                      |
|--------------------|--------|-------------------------------------------|
| List campaigns     | GET    | `/api/v1/discovery/campaigns`             |
| Get campaign       | GET    | `/api/v1/discovery/campaigns/{name}`      |
| Create campaign    | POST   | `/api/v1/discovery/campaigns`             |
| Update campaign    | PUT    | `/api/v1/discovery/campaigns/`            |
| Delete campaign    | DELETE | `/api/v1/discovery/campaigns/{name}`      |
| Trigger scan       | POST   | `/api/v1/discovery/campaigns/{name}/scan` |

---

## Discovery Results

Each discovered certificate becomes a discovery event containing:
- The full certificate chain
- The host, port, and protocol where it was found
- TLS configuration details (cipher suite, protocol version)
- A security grade (if a grading policy is configured)
- A timestamp of when it was discovered

Results are searchable via HDQL (Horizon Discovery Query Language).

### Result Lifecycle

1. **New**: First time a certificate is seen on a host
2. **Unchanged**: Same certificate seen again on subsequent scan
3. **Changed**: Different certificate on same host:port (replacement detected)
4. **Missing**: Previously seen certificate no longer found (removed or host down)

---

## Certificate Discovery Data Structures

When a certificate is discovered, Horizon stores rich metadata on the
certificate object itself. This data is accessible via `get_certificate`
(in the API response) and searchable via HCQL `discoverydata.*` fields.

### discoveryData  -  Where the certificate was found

A certificate can be discovered on **multiple hosts**. Each host gets its
own entry in the `discoveryData` array, keyed by IP address.

```json
{
  "discoveryData": [
    {
      "ip": "10.0.1.50",
      "sources": ["horizon-agent-linux"],
      "hostnames": ["web01.corp.example.com"],
      "operatingSystems": ["Ubuntu 22.04"],
      "paths": ["/etc/ssl/certs/web01.pem", "/opt/tomcat/conf/keystore.jks"],
      "usages": ["tomcat-https:8443", "/etc/nginx/sites-enabled/default"],
      "tlsPorts": [
        {"port": 443, "version": "TLSv1.3"},
        {"port": 8443, "version": "TLSv1.2"}
      ]
    },
    {
      "ip": "10.0.1.51",
      "sources": ["netscan-campaign"],
      "hostnames": ["web02.corp.example.com"],
      "tlsPorts": [{"port": 443, "version": "TLSv1.3"}]
    }
  ]
}
```

| Field | Type | Description | Populated by |
|-------|------|-------------|-------------|
| `ip` | string | Host IP address | netscan, localscan |
| `sources` | string[] | Discovery source identifiers (agent name, scan type) | all |
| `hostnames` | string[] | DNS hostnames of the host | netscan, localscan |
| `operatingSystems` | string[] | OS detected on the host | localscan only |
| `paths` | string[] | File paths where cert was found (keystore, PEM, PFX) | localscan only |
| `usages` | string[] | Service bindings: which application uses this cert | localscan only |
| `tlsPorts` | object[] | TLS ports serving the cert (`port` + `version`) | netscan, localscan |

**Netscan vs Localscan field population:**

| Field | Netscan | Localscan |
|-------|---------|-----------|
| `ip` | Always | Always |
| `hostnames` | From reverse DNS | From hostname |
| `tlsPorts` | Always (port + TLS version) | Sometimes |
| `paths` | Never | Always (file paths) |
| `usages` | Never | Always (service configs) |
| `operatingSystems` | Never | Always |

**When to use `discoveryData` in searches:**
- Find all certificates on a host: `discoverydata.ip equals "10.0.1.50"`
- Find certs used by Tomcat: `discoverydata.usages contains "tomcat"` or `discoverydata.paths contains "tomcat"`
- Find certs exposed on port 8443: `discoverydata.tls.port equals 8443`
- Find certs on a subnet: `discoverydata.ip matches "^10\\.0\\.1\\."`
- Find certs with TLS 1.2: `discoverydata.tls.version equals "TLSv1.2"`

### discoveryInfo  -  Which campaigns found the certificate

```json
{
  "discoveryInfo": [
    {
      "campaign": "prod-netscan",
      "lastDiscoveryDate": 1710700800000,
      "identifier": "api-scanner"
    }
  ]
}
```

| Field | Type | Description |
|-------|------|-------------|
| `campaign` | string | Name of the discovery campaign |
| `lastDiscoveryDate` | number | Epoch milliseconds of last discovery |
| `identifier` | string | Principal that fed the data |

A certificate can be tracked by **multiple campaigns** simultaneously.

**When to use in searches:** `discoveryinfo.campaign equals "prod-netscan"`

### discoveredTrusted  -  Trust status

`discoveredTrusted` is a boolean on the certificate. When `true`, the
discovered certificate was issued by a CA that Horizon recognizes as trusted.
When `false` or absent, the issuer is unknown.

**When to use:** `certificate is discovered and discoveredTrusted equals "true"`  -  find
discovered certs from known CAs.

---

## Third-Party Data  -  External System Tracking

When certificates are pushed to or synchronized with external systems via
third-party connectors, Horizon tracks the mapping in `thirdPartyData`.

### thirdPartyData structure

```json
{
  "thirdPartyData": [
    {
      "connector": "aws-acm-prod",
      "id": "arn:aws:acm:us-east-1:123456789:certificate/abc-def-123",
      "fingerprint": "SHA256:abcdef...",
      "pushDate": 1710700800000,
      "removeDate": null
    },
    {
      "connector": "f5-prod-lb",
      "id": "web01-cert|/Common/web01.corp.example.com",
      "pushDate": 1710700900000
    }
  ]
}
```

| Field | Type | Description |
|-------|------|-------------|
| `connector` | string | Name of the third-party connector that manages this cert |
| `id` | string | External identifier in the third-party system (format varies by type) |
| `fingerprint` | string | Certificate fingerprint as known by the external system |
| `pushDate` | number | Epoch ms when the cert was pushed to the external system |
| `removeDate` | number | Epoch ms when the cert was removed (null if still active) |

### Third-party connector types and their ID formats

The `id` field format depends on the connector type:

| Connector Type | ID Format Example | Description |
|---------------|-------------------|-------------|
| **AWS ACM** | `arn:aws:acm:us-east-1:123:certificate/uuid` | AWS Certificate Manager ARN |
| **Azure Key Vault** | `https://vault.vault.azure.net/certificates/name/version` | Azure Key Vault certificate URL |
| **Google Certificate Manager** | `projects/proj/locations/loc/certificates/name` | GCP resource path |
| **F5 iControl REST** | `certname\|/partition/profilename` | Pipe-separated cert name and SSL profile |
| **F5 AS3** | `tenant/app/certname` | AS3 declaration path |
| **Intune SCEP** | `device-guid` | Intune device identifier |
| **Intune PKCS** | `device-guid` | Intune PKCS device identifier |
| **Jamf** | `device-id` | Jamf device identifier |
| **LDAP Publisher** | `uid=user,ou=people,dc=corp` | LDAP entry DN where cert is published |
| **MS Active Directory** | `CN=user,CN=Users,DC=corp` | AD object DN |

### When to use thirdPartyData

**In `get_certificate` responses:** Check `thirdPartyData` to see where a
certificate is deployed externally. If `pushDate` is present and `removeDate`
is null, the certificate is currently active in that system.

**In searches:** The `thirdPartyData` field is available in the API `fields`
parameter as `thirdPartyData`. Use it in combination with `fetch_exposed_certificate`
to verify end-to-end deployment:
1. Search for a certificate in Horizon
2. Check `thirdPartyData` to see which external systems it should be deployed to
3. Use `fetch_exposed_certificate` to verify it's actually serving on the expected endpoints

---

## Integration with Monitored Profiles

Discovery campaigns reference a monitored profile. When certificates are
discovered, they are automatically imported into that profile if:

1. The profile has `importEnabled: true`
2. The campaign is configured to auto-import

Once imported, certificates benefit from:
- Expiration monitoring and notifications
- Security grading
- HCQL-based searching and reporting
- Team-based ownership and visibility

---

## Horizon Client and Service Integrations

The **Evertrust Horizon Client** is an agent installed on hosts that performs
`LOCALSCAN` discovery. It scans the local filesystem and service configurations
to find certificates, then reports rich metadata back to Horizon.

### Discovery metadata collected by the client

When the Horizon Client discovers a certificate, it records:

| Metadata field            | Description                                               |
|---------------------------|-----------------------------------------------------------|
| `ip`                      | string or null  -  The certificate's host IP                |
| `sources`                 | Array of strings or null  -  Discovery type (e.g. `["localscan"]`) |
| `hostnames`               | Array of strings or null  -  Host hostnames, netscan only (e.g. `["tomcat-01.orb.local"]`) |
| `operatingSystems`        | Array of strings or null  -  Host OS, localscan only (e.g. `["linux"]`) |
| `paths`                   | Array of strings or null  -  Certificate file paths on host, localscan only (e.g. `["/opt/tomcat/conf/keystore.jks"]`) |
| `usages`                  | Array of strings or null  -  Config file paths used to find the certificate, localscan only (e.g. `["tomcat-*:8443", "/opt/tomcat/conf"]`) |
| `tlsPorts`                | Array of TlsPort objects or null  -  Ports where the certificate is exposed for HTTPS (netscan only) |

These fields are searchable in HCQL as `discoverydata.<field>`  -  see the
query languages reference for the full field list.

### Natively integrated services

The Horizon Client has native integration with these services, meaning it
can automatically discover certificates used by the service process and
record detailed binding information in `paths` and `usages`:

| Service      | Typical `paths` examples                         | Typical `usages` examples                  |
|--------------|--------------------------------------------------|---------------------------------------------|
| **Tomcat**   | `/opt/tomcat/conf/tomcat-keystore.jks`           | `tomcat-*:8443`, `/opt/tomcat/conf`         |
| **Apache**   | `/etc/apache2/ssl/server.crt`, `/etc/httpd/...`  | `apache:443`, `/etc/apache2/sites-enabled`  |
| **Nginx**    | `/etc/nginx/ssl/cert.pem`                        | `nginx:443`, `/etc/nginx/conf.d`           |
| **WildFly**  | `/opt/wildfly/standalone/configuration/keystore.jks` | `wildfly:8443`, `standalone.xml`       |
| **HAProxy**  | `/etc/haproxy/certs/frontend.pem`                | `haproxy:443`, `/etc/haproxy/haproxy.cfg`  |
| **IIS**      | Windows certificate store                        | `IIS:443`, `Default Web Site`              |

For these services, HCQL queries should search `discoverydata.paths`,
`discoverydata.usages`, and `discoverydata.hostnames` in addition to
`dn` and `san` to get comprehensive results. See the "Service Discovery
Patterns" section in the query languages reference for ready-to-use queries.

---

## Key Considerations

1. **Network access**: The discovery agent needs network access to the target
   hosts. In segmented environments, deploy agents per network zone.

2. **Scan frequency**: Balance between freshness and load. Weekly scans are
   typical for internal networks; daily for internet-facing hosts.

3. **Certificate deduplication**: Horizon deduplicates certificates by
   thumbprint. The same certificate seen on multiple hosts is stored once
   with multiple discovery data entries.

4. **Grading**: Attach grading policies to the monitored profile to
   automatically score discovered certificates for compliance.
