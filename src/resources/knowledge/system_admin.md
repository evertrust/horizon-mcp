# Horizon System Administration -- Archives, Scheduled Tasks, Configuration, and Analytics

## Overview

Horizon CLM provides a set of system administration features for managing
data exports, scheduled operations, platform configuration, and analytics.
These features are typically restricted to administrators and require
elevated permissions.

The five pillars of system administration are:

- **Archives** -- export certificate or event data to downloadable files
- **Scheduled Tasks** -- automated recurring jobs (third-party sync, reports)
- **System Configuration** -- license, monitoring, and UI customization settings
- **Config Import/Export** -- bulk configuration migration between environments
- **Reports** -- generated CSV reports from scheduled tasks
- **Analytics** -- read-only aggregate statistics for certificates, events, and discovery

---

## Archives

Archives allow bulk export of certificate or event data into downloadable
files. Archives are create-only resources with no update route.

### Archive Types

Archives are discriminated by the `archive_type` field:

| Type                 | Description                                     |
| -------------------- | ----------------------------------------------- |
| `CertificateArchive` | Exports certificates matching an HCQL filter    |
| `EventArchive`       | Exports events older than a specified timestamp |

### CertificateArchive

| Field          | Type    | Description                                            |
| -------------- | ------- | ------------------------------------------------------ |
| `name`         | string  | Unique filename across all archives                    |
| `archive_type` | string  | Must be `"CertificateArchive"`                         |
| `filter`       | string  | Raw HCQL query string (e.g., `"profile is TLS"`)       |
| `archive_keys` | boolean | Optional. Include private keys in the export if `true` |

### EventArchive

| Field          | Type   | Description                                                                |
| -------------- | ------ | -------------------------------------------------------------------------- |
| `name`         | string | Unique filename across all archives                                        |
| `archive_type` | string | Must be `"EventArchive"`                                                   |
| `before`       | number | Epoch milliseconds (NOT ISO 8601). Example: `1704067200000` for 2024-01-01 |

**Warning**: The `before` timestamp must be older than the server's configured
grace period. Attempting to archive recent events will be rejected.

### Archive Constraints

- **Filename uniqueness**: The `name` field must be unique across ALL archives
  (both certificate and event archives share the same namespace).
- **No update route**: Archives cannot be modified after creation. To change
  parameters, delete and recreate the archive.
- **Create-only + actions**: After creation, only retry, cancel, and download
  actions are available.

### Archive Actions

| Action   | Method | Path                               | Description                         |
| -------- | ------ | ---------------------------------- | ----------------------------------- |
| Retry    | GET    | `/api/v1/archives/{name}/retry`    | Retry a failed archive generation   |
| Cancel   | GET    | `/api/v1/archives/{name}/cancel`   | Cancel an in-progress archive       |
| Download | GET    | `/api/v1/archives/{name}/download` | Download the completed archive file |

### Archive API Operations

| Operation      | Method | Path                      |
| -------------- | ------ | ------------------------- |
| List archives  | GET    | `/api/v1/archives`        |
| Get archive    | GET    | `/api/v1/archives/{name}` |
| Create archive | POST   | `/api/v1/archives`        |
| Delete archive | DELETE | `/api/v1/archives/{name}` |

---

## Scheduled Tasks

Scheduled tasks are recurring jobs executed on a cron schedule. They are
discriminated by the `type` field.

### Task Types

| Type         | Description                                                 |
| ------------ | ----------------------------------------------------------- |
| `thirdparty` | Third-party connector synchronization (enroll/revoke/renew) |
| `report`     | Scheduled report generation with email delivery             |

### Common Fields (All Task Types)

| Field         | Type    | Description                                    |
| ------------- | ------- | ---------------------------------------------- |
| `name`        | string  | Unique task name                               |
| `type`        | string  | Discriminator: `"thirdparty"` or `"report"`    |
| `cron`        | string  | Quartz cron expression (e.g., `"0 0 2 * * ?"`) |
| `enabled`     | boolean | Whether the task is active                     |
| `description` | string  | Human-readable description                     |
| `dryRun`      | boolean | If `true`, simulate without making changes     |
| `host`        | string  | Target host for task execution                 |

### ThirdPartyScheduledTask (type="thirdparty")

Additional fields for third-party sync tasks:

| Field       | Type    | Description                       |
| ----------- | ------- | --------------------------------- |
| `module`    | string  | The module to synchronize         |
| `profile`   | string  | Certificate profile to operate on |
| `connector` | string  | Name of the third-party connector |
| `enroll`    | boolean | Enable enrollment synchronization |
| `revoke`    | boolean | Enable revocation synchronization |
| `renew`     | boolean | Enable renewal synchronization    |

### Report Scheduled Tasks (type="report")

Report tasks are further discriminated by the `reportType` field into two
subtypes:

#### AttachmentReportScheduledTask (reportType="attachment_email")

Generates a CSV report and sends it as an email attachment.

| Field         | Type    | Description                        |
| ------------- | ------- | ---------------------------------- |
| `reportType`  | string  | Must be `"attachment_email"`       |
| `compressCsv` | boolean | Compress the CSV attachment (gzip) |

#### LinkReportScheduledTask (reportType="link_email")

Generates a CSV report stored on the server and sends a download link by email.

| Field             | Type   | Description                                     |
| ----------------- | ------ | ----------------------------------------------- |
| `reportType`      | string | Must be `"link_email"`                          |
| `retentionPeriod` | string | Required. How long to retain the report on disk |

### Recipients

Recipients are objects with mutual exclusivity between static and team-based
delivery:

```json
{
  "recipients": [
    { "type": "static", "email": "admin@example.com" },
    { "type": "team", "team": "platform-team" }
  ]
}
```

- **Static recipients**: Require the `email` field. Must NOT include `team`.
- **Team-based recipients**: Require the `team` field. Must NOT include `email`.

### Run Task Manually

| Action | Method | Path                               | Description                 |
| ------ | ------ | ---------------------------------- | --------------------------- |
| Run    | GET    | `/api/v1/scheduler/tasks/{id}/run` | Trigger immediate execution |

**Note**: This uses GET for a mutation operation. This is an unusual pattern
confirmed in the Horizon source code -- it is NOT a mistake.

### Scheduled Task API Operations

| Operation   | Method | Path                                   |
| ----------- | ------ | -------------------------------------- |
| List tasks  | GET    | `/api/v1/scheduler/tasks`              |
| Get task    | GET    | `/api/v1/scheduler/tasks/{id}`         |
| Create task | POST   | `/api/v1/scheduler/tasks`              |
| Update task | PUT    | `/api/v1/scheduler/tasks` (id in body) |
| Delete task | DELETE | `/api/v1/scheduler/tasks/{id}`         |
| Run task    | GET    | `/api/v1/scheduler/tasks/{id}/run`     |

---

## System Configuration

System configuration manages global platform settings. There are three
configuration entry types defined by `SystemConfigurationEntryType`:

| Type                      | Description                                   |
| ------------------------- | --------------------------------------------- |
| `license`                 | License key and activation status             |
| `internal_monitor`        | Internal monitoring and health check settings |
| `interface_customization` | UI branding, theme, and display settings      |

### System Configuration API

Singular routes operate on a single configuration entry:

| Operation            | Method | Path                           |
| -------------------- | ------ | ------------------------------ |
| Get configuration    | GET    | `/api/v1/system/configuration` |
| Update configuration | PUT    | `/api/v1/system/configuration` |

---

## Config Import/Export

Config import/export enables bulk migration of Horizon configuration between
environments (e.g., staging to production).

### Export

Export selected configuration items by specifying which item types to include.

```
POST /api/v1/system/configurations/export
```

The request body is a `HorizonExportableItems` object with 19 named boolean
fields controlling which configuration types to export:

| Field                | Description                          |
| -------------------- | ------------------------------------ |
| `cas`                | Certificate authorities              |
| `pkiConnectors`      | PKI connector configurations         |
| `roles`              | RBAC roles                           |
| `teams`              | Team definitions                     |
| `passwordPolicies`   | Password policy rules                |
| `notifications`      | Notification templates               |
| `datasources`        | External datasource connections      |
| `discoveryCampaigns` | Discovery campaign definitions       |
| `thirdParties`       | Third-party connector configurations |
| `reports`            | Report scheduled task definitions    |
| `triggers`           | Automation triggers                  |
| `automations`        | Automation policy definitions        |
| `executions`         | Execution policy definitions         |
| `profiles`           | Certificate profile configurations   |
| `forestMappings`     | AD forest mapping definitions        |
| `labels`             | Certificate label definitions        |
| `proxies`            | HTTP proxy configurations            |
| `pkiQueues`          | PKI queue configurations             |
| `scimProfiles`       | SCIM provisioning profiles           |

### Import

Import a previously exported configuration bundle.

```
POST /api/v1/system/configurations/import
```

The request body is a `HorizonExport` object:

```json
{
  "info": {
    "version": "3.0.0",
    "createdAt": "2024-01-15T10:30:00Z"
  },
  "items": {
    "cas": [...],
    "profiles": [...],
    "roles": [...]
  }
}
```

**WARNING: There is NO dryRun option for config import. The import is
immediate and irreversible.** Always export the current configuration as a
backup before performing an import.

### Best Practice: Safe Import Workflow

1. Export the current configuration as a backup:
   `POST /api/v1/system/configurations/export` with all fields set to `true`
2. Review the import payload carefully
3. Perform the import
4. Verify critical configuration items after import

---

## Reports

Reports are CSV files generated by report scheduled tasks. They are identified
by UUID.

### Report API

| Operation     | Method | Path                           | Description                                  |
| ------------- | ------ | ------------------------------ | -------------------------------------------- |
| List reports  | GET    | `/api/v1/reports`              | List all generated reports                   |
| Get by name   | GET    | `/api/v1/reports/{reportName}` | Returns a LIST of reports matching that name |
| Delete report | DELETE | `/api/v1/reports/{uuid}`       | Delete a specific report                     |
| Download CSV  | GET    | `/reports/{uuid}`              | Download the CSV file                        |

**Critical path difference**: The CSV download endpoint does NOT have the
`/api/v1` prefix. It is served at `/reports/{uuid}` directly, not at
`/api/v1/reports/{uuid}`. Using the wrong path will result in a 404.

**Note on GET by name**: The `GET /api/v1/reports/{reportName}` endpoint
returns a list of report entries, not a single entry. A scheduled task may
generate multiple reports over time, all sharing the same name.

---

## Analytics

Analytics endpoints provide read-only aggregate statistics about the Horizon
platform. They are GET-only endpoints returning status summaries.

### Available Analytics Endpoints

| Endpoint                                 | Description                      |
| ---------------------------------------- | -------------------------------- |
| `GET /api/v1/analytics/certificates`     | Certificate inventory statistics |
| `GET /api/v1/analytics/events`           | Event activity statistics        |
| `GET /api/v1/analytics/discovery/events` | Discovery event statistics       |

### Constraints

- **No requests analytics**: There is NO `/api/v1/analytics/requests` endpoint.
  Request analytics are not available through the API.
- **Read-only via API**: Only GET operations are exposed. PATCH and DELETE
  operations exist but are admin-only and should be performed through the
  Horizon UI, not through the API.
- **Discovery path**: Note the extra path segment for discovery analytics:
  `/api/v1/analytics/discovery/events` (not `/api/v1/analytics/discovery`).

---

## Key Considerations

1. **Archive immutability**: Archives cannot be updated after creation. Plan
   the filter or timestamp carefully before creating an archive.

2. **Epoch milliseconds for EventArchive**: The `before` field uses epoch
   milliseconds, NOT ISO 8601 strings. Convert dates accordingly (e.g.,
   `new Date("2024-01-01").getTime()` yields `1704067200000`).

3. **GET-for-mutation patterns**: Both archive actions (retry, cancel) and
   scheduled task run use GET requests to trigger mutations. This is by design
   in the Horizon API.

4. **Report download path**: Always use `/reports/{uuid}` (without `/api/v1`)
   for CSV downloads. The `/api/v1/reports` path is for management only.

5. **Config import is destructive**: There is no rollback mechanism. Always
   maintain a backup export before importing configuration changes.

6. **Quartz cron format**: Scheduled tasks use Quartz cron expressions with
   six fields (second, minute, hour, day-of-month, month, day-of-week),
   which differs from standard Unix cron (five fields, no seconds).
