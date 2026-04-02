# Dashboards and Saved Queries

## Overview

Horizon CLM provides personal dashboards and saved queries that let users
visualize certificate and request data through configurable charts and
persist frequently used HQL queries for quick access.

---

## Dashboard Model

Dashboards are **principal-scoped** -- each dashboard belongs to a specific
authenticated principal and is embedded inside the `PrincipalInfo` object.
Dashboards have no `_id` field; they are identified by their `name` within
the principal's collection.

### Dashboard Fields

| Field         | Type          | Description                                      |
|---------------|---------------|--------------------------------------------------|
| `name`        | str           | Plain string identifier (unique per principal). **Immutable after creation.** |
| `description` | str or None   | Optional human-readable description              |
| `charts`      | list[Chart]   | Ordered list of chart objects (defaults to `[]`)  |
| `type`        | str           | Either `"certificate"` or `"request"`            |

The `type` field determines which query language applies to `localQuery`
filters (HCQL for certificate dashboards, HRQL for request dashboards) and
which aggregation fields are valid in chart `fields`.

---

## Chart Type Catalog

Horizon supports 13 chart types. Each type is suited to different
analytical goals.

| Chart Type                | Best For                                              |
|---------------------------|-------------------------------------------------------|
| `area`                    | Trends over time with volume emphasis                 |
| `donut`                   | Part-of-whole distribution (single dimension)         |
| `heatmap`                 | Density / intensity across two dimensions             |
| `bar-horizontal`          | Comparing categories when labels are long             |
| `line`                    | Trends over time with precise value tracking          |
| `metric`                  | Single KPI / headline number                          |
| `pie`                     | Similar to donut; classic proportional view           |
| `polar`                   | Radial category comparison                            |
| `pyramid`                 | Ranked funnel or tiered distribution                  |
| `radar`                   | Multi-axis profile comparison                         |
| `table`                   | Detailed tabular breakdowns                           |
| `treemap`                 | Hierarchical proportional view (e.g. grade breakdown) |
| `bar-vertical`            | Comparing categories with short labels                |

---

## Chart Schema

Each chart object within a dashboard has the following structure:

| Field        | Type          | Description                                                    |
|--------------|---------------|----------------------------------------------------------------|
| `type`          | str           | One of the 13 chart types listed above                      |
| `title`         | str           | Display title for the chart                                 |
| `description`   | str or None   | Optional chart description                                  |
| `fields`        | list[str]     | groupBy dimensions for the aggregate query                  |
| `limit`         | int or None   | Maximum number of buckets returned; must be >= 0            |
| `having`        | dict or None  | Post-aggregation filter: `{"operator": "gte", "value": 10}` |
| `sortOrder`     | str or None   | Data sort order: `Asc`, `Desc`, `KeyAsc`, or `KeyDesc`     |
| `localQuery`    | str or None   | HCQL (certificate) or HRQL (request) filter expression      |
| `direction`     | str or None   | Visual rendering direction: `asc` or `desc`                 |
| `colors`        | list[str]     | Hex color codes: `["#A6ADF7", "#4D54A2", ...]`              |
| `log`            | bool          | Enable logarithmic scale on value axis (default false)      |
| `i`             | str or None   | Chart identifier for grid layout                            |
| `x`             | int or None   | Grid column position (0-based)                              |
| `y`             | int or None   | Grid row position                                           |
| `w`             | int or None   | Grid column span                                            |
| `h`             | int or None   | Grid row span                                               |

---

## Grid Layout

Dashboards use a **react-grid-layout** compatible 12-column grid system.

- `x` -- column start position (0 through 11)
- `y` -- row start position (0-based, rows grow downward)
- `w` -- number of columns the chart spans (1 through 12)
- `h` -- number of rows the chart spans
- `i` -- unique chart identifier within the grid (string)

Charts are arranged left-to-right, top-to-bottom. When two charts share a
row they tile horizontally up to the 12-column boundary.

**Example layout** -- two charts side by side:

```
Chart A: x=0, y=0, w=6, h=4, i="chart-a"
Chart B: x=6, y=0, w=6, h=4, i="chart-b"
```

---

## sortOrder vs direction

These two fields serve different purposes and must not be confused:

| Property    | Case Style  | Purpose                                          | Values                         |
|-------------|-------------|--------------------------------------------------|--------------------------------|
| `sortOrder` | PascalCase  | Controls data sort order sent to aggregate API   | `Asc`, `Desc`, `KeyAsc`, `KeyDesc` |
| `direction` | lowercase   | Controls visual rendering direction in the UI    | `asc`, `desc`                  |

`sortOrder` determines how the Horizon server orders aggregation buckets
before returning them. `direction` tells the front-end which end of the
visual axis to emphasize. They are independent concerns.

---

## Valid groupBy Fields

### Certificate Dashboards (type = "certificate")

Fields usable in chart `fields` for certificate aggregation:

**Built-in fields:**
`certificateType`, `discoveredTrusted`, `dn`, `expired`, `graded`,
`holderId`, `issuer`, `keyType`, `module`, `profile`,
`publicKeyThumbprint`, `revocationReason`, `revoked`, `selfSigned`,
`signingAlgorithm`, `status`, `team`,
`notAfter.day`, `notAfter.month`, `notAfter.year`,
`notBefore.day`, `notBefore.month`, `notBefore.year`,
`revocationDate.day`, `revocationDate.month`, `revocationDate.year`

**Dynamic fields (instance-specific):**
- `label.<name>`  -  Labels defined on the instance. Use `list_labels` to
  discover available label names. Example: `label.environment`.
- `grade.<name>`  -  Grading policies defined on the instance. Use
  `list_grading_policies` to discover available policy names.
  Example: `grade.Horizon-Grading-Policy`.
- `metadata.*`  -  Certificate metadata keys.

> **Important**: `owner` is NOT a valid groupBy field for certificate
> aggregation. Use `holderId` instead.

### Request Dashboards (type = "request")

Fields usable in chart `fields` for request aggregation:

**Built-in fields:**
`approver`, `contact`, `dn`, `module`, `owner`, `profile`, `requester`,
`status`, `team`, `workflow`,
`expirationDate.day`, `expirationDate.month`, `expirationDate.year`,
`lastModificationDate.day`, `lastModificationDate.month`, `lastModificationDate.year`,
`registrationDate.day`, `registrationDate.month`, `registrationDate.year`

**Dynamic fields (instance-specific):**
- `label.<name>`  -  Labels defined on the instance. Use `list_labels`.
- `metadata.*`  -  Request metadata keys.

---

## Having Operators

The `having` object applies a post-aggregation filter on bucket counts.

| Operator | Meaning                 |
|----------|-------------------------|
| `gt`     | Greater than            |
| `gte`    | Greater than or equal   |
| `lt`     | Less than               |
| `lte`    | Less than or equal      |
| `eq`     | Equal                   |
| `ne`     | Not equal               |

Example: show only buckets with 10 or more certificates:

```json
{ "operator": "gte", "value": 10 }
```

---

## Validation Rules

1. **Colors** must match the pattern `^#[A-Fa-f0-9]{6}$` (six hex digits
   preceded by `#`).
2. **limit** must be >= 0 when provided.
3. **chart type** must be one of the 13 valid enum values listed above.
4. **localQuery** is validated as HCQL (for certificate dashboards) or HRQL
   (for request dashboards) by the server. Use `search_certificates` or
   `search_requests` with `pageSize=1` to pre-validate queries.

---

## Saved Queries

Saved queries are **principal-scoped** and persist frequently used HQL
expressions for quick recall.

### Saved Query Types

| Type   | Query Language | Description                          |
|--------|----------------|--------------------------------------|
| `hcql` | HCQL           | Certificate search queries           |
| `hrql` | HRQL           | Request search queries               |
| `heql` | HEQL           | Event / audit log queries            |
| `hdql` | HDQL           | Discovery event queries              |
| `hpql` | HPQL           | Principal queries                    |

All type values are **lowercase**.

### Upsert Semantics

`POST` creates a new saved query or updates an existing one with the same
name -- true upsert behavior. There is no separate PUT endpoint for saved
queries.

HQL syntax is validated server-side on save. Invalid queries are rejected
with a descriptive error message.

---

## Common Dashboard Recipes

### Certificate Expiry by Profile

Visualize certificates expiring within 30 days, grouped by profile.

```json
{"type": "bar-horizontal", "title": "Expiring Certs by Profile",
 "localQuery": "status is valid and valid.until before 30d",
 "fields": ["profile"], "sortOrder": "Desc",
 "i": "1", "x": 0, "y": 0, "w": 6, "h": 4}
```

### Issuance by Module (Last 7 Days)

Show certificate issuance distribution by module for the past week.

```json
{"type": "donut", "title": "Issuance by Module",
 "localQuery": "valid.from after 7d",
 "fields": ["module"],
 "i": "2", "x": 6, "y": 0, "w": 6, "h": 4}
```

### Key Type Distribution

Show the distribution of key types across all valid certificates.

```json
{"type": "donut", "title": "Key Type Distribution",
 "localQuery": "status is valid",
 "fields": ["keyType"], "sortOrder": "Desc",
 "colors": ["#A6ADF7", "#4D54A2", "#3E459A", "#114446", "#21969A"],
 "i": "3", "x": 0, "y": 4, "w": 6, "h": 4}
```

### Grade Distribution

Display the spread of certificate grades under a grading policy.
Use `list_grading_policies` to discover the policy name on this instance.

```json
{"type": "treemap", "title": "Grade Distribution",
 "fields": ["grade.<policy-name>"], "sortOrder": "KeyAsc",
 "localQuery": "status is valid",
 "i": "4", "x": 6, "y": 4, "w": 6, "h": 4}
```

### Request Status Overview

Show current request pipeline status (for request-type dashboards).

```json
{"type": "metric", "title": "Request Status",
 "fields": ["status"],
 "i": "1", "x": 0, "y": 0, "w": 12, "h": 2}
```

---

## Dashboard Creation Workflow

Dashboards should be built iteratively:

1. **Ask the user for the dashboard name** (and optionally a description).
   The name is **immutable**  -  it cannot be changed after creation. Never
   invent a name on the user's behalf.

2. **Create a blank dashboard** using `create_dashboard` with the chosen
   name, type, and optional description. Start with an empty `charts` list.

3. **Prompt the user** for each chart's configuration: what data they want
   to visualize, which chart type suits their goal, and any filters.

4. **Add charts one at a time** using `add_dashboard_chart`. Each call
   appends a new chart to the dashboard and returns the updated dashboard.

5. **Adjust layout** by setting `x`, `y`, `w`, `h` on each chart to
   arrange them in the 12-column grid.

This incremental approach lets users preview and refine each chart before
adding the next one, avoiding a monolithic configuration step.

---

## HTTP 204 Handling

The `list_dashboards` and `list_saved_queries` endpoints return **HTTP 204
No Content** when the principal has no dashboards or saved queries. This is
distinct from an empty array -- the response body is absent entirely.

Client code must treat 204 as "empty collection" rather than an error. The
MCP tools handle this automatically by returning an empty list.

---

## Key Considerations

1. **No shared dashboards**: Dashboards are strictly personal. To share a
   dashboard configuration, export it as JSON and have another user import
   it.

2. **Query validation**: Always validate `localQuery` expressions before
   saving a chart. Use search with `pageSize=1` to test the query against
   the live server.

3. **Field alignment**: Ensure chart `fields` match the dashboard `type`.
   Certificate fields are invalid on request dashboards and vice versa.

4. **Color consistency**: When specifying `colors`, provide at least as
   many hex values as there are expected data buckets to avoid default
   color fallback.

5. **Logarithmic scale**: Set `log: true` for charts with extreme value
   ranges (e.g., one profile with thousands of certificates alongside
   others with single digits).
