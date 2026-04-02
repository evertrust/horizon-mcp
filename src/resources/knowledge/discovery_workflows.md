# Discovery Workflows - CLI Operations and Integration Patterns

> **See also:** `horizon://knowledge/discovery` for core concepts (campaigns,
> certificate lifecycle stages, discovery data structures, search patterns).
> This resource covers the operational workflows performed with the Horizon CLI.

## Overview

Certificate discovery in Horizon is performed by the **horizon-cli** agent,
installed on a host with network access to the targets. All discovery
workflows follow the same pattern:

1. **Create a discovery campaign** in Horizon (via the MCP server or UI)
2. **Run the CLI command** on a host where horizon-cli is installed
3. **Verify results** by searching certificates and discovery events in Horizon

The CLI handles the feed session lifecycle automatically: it starts a session,
pushes discovered certificates with their metadata, and ends the session when
the scan completes.

---

## Discovery Types

| Type | CLI Command | Purpose |
|------|-------------|---------|
| Network scan | `horizon-cli netscan` | Scan IP ranges/hosts for TLS certificates on open ports |
| Local scan | `horizon-cli localscan` | Scan local filesystem and service configs for certificates |
| Net import | `horizon-cli netimport <service>` | Import certificates from external cloud/appliance services |
| Import scan | `horizon-cli importscan <tool>` | Import results from third-party scanning tools |
| Local import | `horizon-cli localimport` | Bulk import certificates from a folder or CSV file |

---

## 1. Network Scan (netscan)

Scans network hosts for TLS certificates by connecting to specified ports.

### When to use

- Discover certificates exposed on network endpoints
- Audit TLS configuration across subnets
- Detect certificate changes on known hosts

### Campaign setup

Configure the campaign in Horizon with:
- **Hosts**: individual IPs, IP ranges (`10.0.0.1-10.0.0.50`), CIDR ranges (`10.0.0.0/24`), or DNS names
- **Ports**: specific ports to scan

### Default ports

If no ports are configured on the campaign, the CLI scans:
- 21 (SFTP)
- 443 (HTTPS)
- 8443 (alternative HTTPS)
- 636 (LDAPS)

### CLI usage

```bash
# Basic network scan
horizon-cli netscan --campaign <campaign-name>

# With ping pre-check (skip unreachable hosts)
horizon-cli netscan --campaign <campaign-name> --ping-first

# High-performance scan with more workers
horizon-cli netscan --campaign <campaign-name> \
  --scan-workers 200 \
  --certificate-workers 4 \
  --event-workers 4

# Set up periodic weekly scan
horizon-cli netscan --campaign <campaign-name> \
  --create-periodic-task --period weekly

# Remove periodic task
horizon-cli netscan --campaign <campaign-name> --remove-periodic-task
```

### Key parameters

| Parameter | Default | Description |
|-----------|---------|-------------|
| `--campaign` | (required) | Campaign name in Horizon |
| `--ping-first` | false | Pre-check host reachability via ping |
| `--log-details` | false | Verbose network scan logging |
| `--scan-workers` | 100 | Concurrent scan threads |
| `--certificate-workers` | 1 | Certificate upload threads |
| `--event-workers` | 1 | Event upload threads |
| `--events-batch` | 100 | Events per batch |

### Discovery data produced

Netscan populates these `discoveryData` fields on each certificate:
- `ip` - always
- `hostnames` - from reverse DNS
- `tlsPorts` - always (port + TLS version)
- `sources` - set to the scan source identifier

It does **not** populate: `paths`, `usages`, `operatingSystems` (these are localscan-only).

---

## 2. Local Scan (localscan)

Scans the local filesystem and service configurations on the host where the
CLI is installed. Requires **admin/root privileges**.

### When to use

- Discover certificates installed on servers (not just exposed on ports)
- Find certificates in keystores, PEM files, and service configs
- Inventory certificates used by Tomcat, Apache, Nginx, HAProxy, IIS, WildFly

### How it works

The local scan:
1. Searches configured paths for certificate files by extension
2. Reads supported service configuration files to find certificate references
3. Excludes CA certificates by default (only sends end-entity certs)
4. Reports rich metadata: file paths, service bindings, OS information

### Default scan paths

**Linux/Unix:**
- `/etc`
- `/opt`
- `/usr/local/etc`
- Current user's home directory (`~`)

**Windows:**
- `C:\ProgramData`
- `C:\Program Files`
- `C:\Program Files (x86)`
- Windows certificate stores: `Cert:\LocalMachine` (MY store), `Cert:\CurrentUser` (MY store)

If `--all-paths` is enabled, it scans the entire filesystem (`/` on Linux, all drives on Windows).

### File extensions scanned

**Certificate files:** `.crt`, `.cer`, `.pem`, `.p12`, `.pfx`, `.jks`, `.kdb`

**Configuration files:** `.conf`, `.cnf`, `.xml`, `.json`, `.cfg`, and extensionless files

### Natively integrated services

The CLI can parse configurations of these services to discover which
certificates they reference:

| Service | Typical paths found | Typical usages found |
|---------|---------------------|----------------------|
| Tomcat | `/opt/tomcat/conf/keystore.jks` | `tomcat-*:8443` |
| Apache | `/etc/apache2/ssl/server.crt` | `apache:443` |
| Nginx | `/etc/nginx/ssl/cert.pem` | `nginx:443` |
| WildFly | `/opt/wildfly/.../keystore.jks` | `wildfly:8443` |
| HAProxy | `/etc/haproxy/certs/frontend.pem` | `haproxy:443` |
| IIS | Windows certificate store | `IIS:443` |

### CLI usage

```bash
# Basic local scan
sudo horizon-cli localscan --campaign <campaign-name>

# Scan additional paths
sudo horizon-cli localscan --campaign <campaign-name> \
  --paths /srv/apps,/home/deploy/certs

# Include CA certificates
sudo horizon-cli localscan --campaign <campaign-name> --all-certs

# Scan entire filesystem
sudo horizon-cli localscan --campaign <campaign-name> --all-paths

# Try passwords on PKCS#12/JKS containers
sudo horizon-cli localscan --campaign <campaign-name> \
  --containers-passwords changeit,password123

# Exclude specific files
sudo horizon-cli localscan --campaign <campaign-name> \
  --exclude-files /etc/ssl/certs/ca-certificates.crt

# Custom file extensions
sudo horizon-cli localscan --campaign <campaign-name> \
  --cert-extensions ".txt,.cert" \
  --conf-extensions ".yml,.ini"

# Set up periodic weekly scan
sudo horizon-cli localscan --campaign <campaign-name> \
  --create-periodic-task --period weekly --user root
```

### Key parameters

| Parameter | Default | Description |
|-----------|---------|-------------|
| `--campaign` | (required) | Campaign name in Horizon |
| `--paths` | OS defaults | Additional scan paths (comma-separated) |
| `--cert-extensions` | see above | Additional certificate file extensions |
| `--conf-extensions` | see above | Additional config file extensions |
| `--exclude-files` | none | Absolute paths to exclude |
| `--exclude-default-paths` | false | Don't add OS default paths |
| `--containers-passwords` | none | Passwords to try on PKCS#12/JKS |
| `--all-certs` | false | Include CA certificates |
| `--all-paths` | false | Scan entire filesystem |

### Discovery data produced

Localscan populates all `discoveryData` fields:
- `ip` - always
- `hostnames` - from hostname
- `paths` - certificate file paths found
- `usages` - service config bindings
- `operatingSystems` - detected OS
- `tlsPorts` - sometimes (if cert is bound to a port)
- `sources` - set to the scan source identifier

---

## 3. Net Import (netimport)

Imports certificates from external cloud services, appliances, and PKI platforms.
Each service has its own subcommand with service-specific authentication.

### Available services

| Subcommand | Service | Type |
|------------|---------|------|
| `aws-acm` | AWS Certificate Manager | Cloud certificate store |
| `akv` | Azure Key Vault | Cloud certificate store |
| `akamai` | Akamai CPS | CDN/network appliance |
| `bigip` | F5 BigIP (iControl REST or AS3) | Load balancer |
| `digicert` | DigiCert CertCentral | Public PKI |
| `globalsign` | GlobalSign | Public PKI |
| `gandi` | Gandi | Public certificate broker |
| `vault` | HashiCorp Vault PKI | Secrets engine |
| `nameshield` | Nameshield | Public certificate broker |

### AWS ACM

```bash
horizon-cli netimport aws-acm --campaign <campaign-name> \
  --aws-region us-east-1 \
  --access-key-id $AWS_ACCESS_KEY_ID \
  --secret-access-key $AWS_SECRET_ACCESS_KEY

# With role assumption
horizon-cli netimport aws-acm --campaign <campaign-name> \
  --aws-region us-east-1 \
  --access-key-id $AWS_ACCESS_KEY_ID \
  --secret-access-key $AWS_SECRET_ACCESS_KEY \
  --assume-role-arn arn:aws:iam::123456789:role/discovery-role
```

### Azure Key Vault

```bash
horizon-cli netimport akv --campaign <campaign-name> \
  --vault-name my-vault \
  --azure-tenant $AZURE_TENANT_ID \
  --client-id $AZURE_CLIENT_ID \
  --client-secret $AZURE_CLIENT_SECRET
```

### Akamai CPS

```bash
horizon-cli netimport akamai --campaign <campaign-name> \
  --host $AKAMAI_HOST \
  --client-secret $AKAMAI_CLIENT_SECRET \
  --client-token $AKAMAI_CLIENT_TOKEN \
  --access-token $AKAMAI_ACCESS_TOKEN
```

### F5 BigIP

```bash
# iControl REST (default)
horizon-cli netimport bigip --campaign <campaign-name> \
  --hostname f5.example.com \
  --login admin \
  --password $F5_PASSWORD \
  --partition Common

# AS3 declarative
horizon-cli netimport bigip --campaign <campaign-name> \
  --hostname f5.example.com \
  --login admin \
  --password $F5_PASSWORD \
  --as-3

# With third-party data merge (Horizon 2.7.18+)
horizon-cli netimport bigip --campaign <campaign-name> \
  --hostname f5.example.com \
  --login admin \
  --password $F5_PASSWORD \
  --connector my-f5-connector \
  --merge-third-party
```

### DigiCert CertCentral

```bash
horizon-cli netimport digicert --campaign <campaign-name> \
  --digicert-api-key $DIGICERT_API_KEY
```

### GlobalSign

```bash
horizon-cli netimport globalsign --campaign <campaign-name> \
  --username $GS_USERNAME \
  --password $GS_PASSWORD
```

### Gandi

```bash
horizon-cli netimport gandi --campaign <campaign-name> \
  --access-token $GANDI_ACCESS_TOKEN
```

### HashiCorp Vault

```bash
# Token authentication
horizon-cli netimport vault --campaign <campaign-name> \
  --address https://vault.example.com \
  --token $VAULT_TOKEN \
  --secrets-engines pki,pki-int

# AppRole authentication
horizon-cli netimport vault --campaign <campaign-name> \
  --address https://vault.example.com \
  --app-role-id $VAULT_ROLE_ID \
  --app-role-secret-id $VAULT_SECRET_ID \
  --secrets-engines pki

# With namespace (Vault Enterprise)
horizon-cli netimport vault --campaign <campaign-name> \
  --address https://vault.example.com \
  --token $VAULT_TOKEN \
  --namespace admin/team1 \
  --secrets-engines pki
```

### Nameshield

```bash
horizon-cli netimport nameshield --campaign <campaign-name> \
  --token $NAMESHIELD_TOKEN
```

### Common options

All netimport commands support `--external-proxy` for environments where
outbound access requires a proxy:

```bash
horizon-cli netimport aws-acm --campaign <campaign-name> \
  --aws-region us-east-1 \
  --access-key-id $AWS_ACCESS_KEY_ID \
  --secret-access-key $AWS_SECRET_ACCESS_KEY \
  --external-proxy http://proxy.corp:8080
```

---

## 4. Import Scan (importscan)

Imports results from third-party scanning and vulnerability tools.

### Nmap

Imports certificate data from an nmap XML scan output (`-oX` flag).

```bash
# First, run nmap with SSL script
nmap -p 443,8443 --script ssl-cert -oX scan_results.xml 10.0.0.0/24

# Then import into Horizon
horizon-cli importscan nmap --campaign <campaign-name> \
  --xmlfile scan_results.xml
```

### Qualys CertView

```bash
horizon-cli importscan qualyscv --campaign <campaign-name> \
  --endpoint https://qualysapi.qualys.com \
  --username $QUALYS_USERNAME \
  --password $QUALYS_PASSWORD
```

### Tenable Nessus

```bash
horizon-cli importscan nessus --campaign <campaign-name> \
  --scan-id <nessus-scan-id> \
  --endpoint https://nessus.example.com \
  --username $NESSUS_USERNAME \
  --password $NESSUS_PASSWORD

# Skip TLS verification for self-signed Nessus instance
horizon-cli importscan nessus --campaign <campaign-name> \
  --scan-id <scan-id> \
  --endpoint https://nessus.example.com \
  --username admin \
  --password $NESSUS_PASSWORD \
  --tls-insecure
```

---

## 5. Local Import (localimport)

Bulk imports certificates from a local folder or CSV file. Commonly used when
taking over an existing PKI (e.g., migrating from ADCS, OpenTrust PKI, or EJBCA).

### From a folder

```bash
# Import all certificates from a directory
horizon-cli localimport --campaign <campaign-name> \
  --path /export/certs \
  --source "ADCS-Migration"

# Include CA certificates
horizon-cli localimport --campaign <campaign-name> \
  --path /export/certs \
  --source "EJBCA-Export" \
  --enable-ca-import

# Import PKCS#12 files with password
horizon-cli localimport --campaign <campaign-name> \
  --path /export/pkcs12 \
  --pfx-pwd changeit

# Custom file extensions
horizon-cli localimport --campaign <campaign-name> \
  --path /export/certs \
  --cert-extensions ".txt,.cert"
```

### From a CSV file

```bash
# Import from CSV
horizon-cli localimport --campaign <campaign-name> \
  --csv /export/certificates.csv \
  --source "PKI-Export"

# With custom separator and metadata
horizon-cli localimport --campaign <campaign-name> \
  --csv /export/certs.csv \
  --csv-separator ";" \
  --csv-metadata department,environment
```

### PKI migration patterns

**ADCS migration:** Export certificates from AD Certificate Services, then:
```bash
horizon-cli localimport --campaign adcs-migration \
  --path /export/adcs-certs \
  --source "ADCS" \
  --enable-ca-import
```

**EJBCA migration:** Export from EJBCA database, then:
```bash
horizon-cli localimport --campaign ejbca-migration \
  --csv /export/ejbca-export.csv \
  --source "EJBCA"
```

**OpenTrust PKI migration:** Export certificate store, then:
```bash
horizon-cli localimport --campaign opentrust-migration \
  --path /export/opentrust \
  --source "OpenTrust"
```

---

## End-to-End Discovery Workflow

A complete discovery workflow from campaign creation to certificate verification:

### Step 1: Create a discovery campaign

Use the MCP `create_discovery_campaign` tool (or the Horizon UI):

```
Create a discovery campaign named "prod-netscan" with:
- Hosts: 10.0.0.0/24, 10.0.1.0/24
- Ports: 443, 8443, 636
- Grading policy: default
```

### Step 2: Run the discovery

On a host with horizon-cli installed and network access to the targets:

```bash
horizon-cli netscan --campaign prod-netscan
```

### Step 3: Verify results

Use the MCP tools to check what was discovered:

```
Search for certificates discovered by the "prod-netscan" campaign.
Show me how many certificates were found and their grade distribution.
```

The LLM can use:
- `search_certificates` with HCQL: `discoveryinfo.campaign equals "prod-netscan"`
- `aggregate_certificates` to get grade/status distributions
- `search_discovery_events` to check for scan errors or warnings

### Step 4: Promote certificates (optional)

Discovered certificates can be promoted through the lifecycle:
- **Discovered -> Monitored**: import into a monitored profile for labeling, ownership, and notifications
- **Monitored -> Managed**: move to a managed profile for full lifecycle control

See `horizon://knowledge/discovery` for details on certificate lifecycle stages.

---

## Periodic Execution

All scan types (netscan, localscan) support periodic scheduling:

```bash
# Create a weekly netscan
horizon-cli netscan --campaign prod-netscan \
  --create-periodic-task --period weekly

# Create a daily localscan (Linux, running as root)
sudo horizon-cli localscan --campaign server-inventory \
  --create-periodic-task --period daily --user root

# Remove a periodic task
horizon-cli netscan --campaign prod-netscan --remove-periodic-task
```

Available periods: `daily`, `weekly`, `monthly`.

---

## Troubleshooting

### Common issues

| Symptom | Cause | Fix |
|---------|-------|-----|
| No certificates found (netscan) | Ports not open or filtered | Check with `nmap -p <port> <host>` first |
| No certificates found (localscan) | Not running as admin | Use `sudo` (Linux) or run as Administrator (Windows) |
| Campaign not found | Campaign name mismatch | Verify name with `list_discovery_campaigns` |
| Feed session error | Concurrent session open | End existing sessions or wait for timeout |
| Certificates not in search results | Processing delay | Wait a few seconds after scan completes |
