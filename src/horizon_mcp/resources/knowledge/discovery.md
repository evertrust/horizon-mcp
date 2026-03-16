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
| `ip`                      | string or null — The certificate's host IP                |
| `sources`                 | Array of strings or null — Discovery type (e.g. `["localscan"]`) |
| `hostnames`               | Array of strings or null — Host hostnames, netscan only (e.g. `["tomcat-01.orb.local"]`) |
| `operatingSystems`        | Array of strings or null — Host OS, localscan only (e.g. `["linux"]`) |
| `paths`                   | Array of strings or null — Certificate file paths on host, localscan only (e.g. `["/opt/tomcat/conf/keystore.jks"]`) |
| `usages`                  | Array of strings or null — Config file paths used to find the certificate, localscan only (e.g. `["tomcat-*:8443", "/opt/tomcat/conf"]`) |
| `tlsPorts`                | Array of TlsPort objects or null — Ports where the certificate is exposed for HTTPS (netscan only) |

These fields are searchable in HCQL as `discoverydata.<field>` — see the
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
