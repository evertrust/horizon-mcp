## Real-World Examples

### Example 1: Deploy Certificate to a Load Balancer API

When a certificate is enrolled or renewed, push it to a load balancer:

```json
{
  "name": "deploy-to-nginx-api",
  "type": "rest",
  "retries": 5,
  "events": ["on_enroll"],
  "sequence": [
    {
      "url": "https://lb-manager.example.com/api/v1/certificates",
      "authenticationType": "bearer",
      "credentials": "lb-api-token",
      "method": "POST",
      "headers": [{ "name": "Content-Type", "value": "application/json" }],
      "payloadType": "json",
      "payload": "{\"domain\": \"{{certificate.san.dnsname.1}}\", \"certificate\": \"{{certificate.pem}}\", \"serial\": \"{{certificate.serial}}\"}",
      "timeout": "30 seconds",
      "expectedHttpCodes": [200, 201]
    }
  ]
}
```

Create a second trigger for `on_renew` with the same sequence to also handle
renewals.

### Example 2: Multi-Step OAuth + API Call

First obtain an OAuth token, then use it to deploy:

```json
{
  "name": "deploy-with-oauth",
  "type": "rest",
  "retries": 3,
  "events": ["on_enroll"],
  "sequence": [
    {
      "url": "https://auth.example.com/oauth/token",
      "authenticationType": "basic",
      "credentials": "oauth-client-creds",
      "method": "POST",
      "headers": [
        { "name": "Content-Type", "value": "application/x-www-form-urlencoded" }
      ],
      "payloadType": "text",
      "payload": "grant_type=client_credentials&scope=certificates:write",
      "timeout": "10 seconds",
      "expectedHttpCodes": [200]
    },
    {
      "url": "https://api.example.com/certificates/{{certificate.san.dnsname.1}}",
      "authenticationType": "noauth",
      "method": "PUT",
      "headers": [
        { "name": "Content-Type", "value": "application/json" },
        {
          "name": "Authorization",
          "value": "Bearer {{rest.response.1.access_token}}"
        }
      ],
      "payloadType": "json",
      "payload": "{\"pem\": \"{{certificate.pem}}\", \"chain\": \"{{certificate.pem}}\"}",
      "timeout": "30 seconds",
      "expectedHttpCodes": [200, 201, 204]
    }
  ]
}
```

**How it works:**

1. Step 1 calls the OAuth endpoint with Basic auth (client ID + secret)
2. The OAuth response `{"access_token": "eyJ..."}` is parsed
3. Step 2 references `{{rest.response.1.access_token}}` in the Authorization header

### Example 3: Send an Enrollment Request to an External System

Send the request ID, profile, and first DNS SAN when an enrollment request
is submitted. This event uses the request dictionary:

```json
{
  "name": "send-enrollment-request",
  "type": "rest",
  "retries": 3,
  "events": ["on_submit_enroll"],
  "sequence": [
    {
      "url": "https://api.example.com/enrollment-requests",
      "authenticationType": "bearer",
      "credentials": "request-api-key",
      "method": "POST",
      "headers": [{ "name": "Content-Type", "value": "application/json" }],
      "payloadType": "json",
      "payload": "{\"requestId\": \"{{request.id}}\", \"profile\": \"{{request.profile}}\", \"dnsName\": \"{{request.san.dnsname.1}}\"}",
      "timeout": "15 seconds",
      "expectedHttpCodes": [200, 201]
    }
  ]
}
```

### Example 5: Notify SIEM on Revocation

Push revocation events to a SIEM or log aggregation system:

```json
{
  "name": "siem-revocation-alert",
  "type": "rest",
  "retries": 5,
  "events": ["on_revoke"],
  "sequence": [
    {
      "url": "https://siem.example.com/api/events",
      "authenticationType": "bearer",
      "credentials": "siem-token",
      "method": "POST",
      "headers": [{ "name": "Content-Type", "value": "application/json" }],
      "payloadType": "json",
      "payload": "{\"event_type\": \"certificate_revoked\", \"severity\": \"high\", \"certificate_dn\": \"{{certificate.dn}}\", \"serial\": \"{{certificate.serial}}\", \"revocation_reason\": \"{{certificate.revocation_reason}}\", \"revocation_date\": \"{{certificate.revocation_date}}\", \"profile\": \"{{certificate.profile}}\", \"owner\": \"{{certificate.owner}}\"}",
      "timeout": "10 seconds",
      "expectedHttpCodes": [200, 201, 202]
    }
  ]
}
```

### Example 6: Multi-Step - Create Resource Then Activate It

Some APIs require creating a resource first, then activating it:

```json
{
  "name": "create-and-activate",
  "type": "rest",
  "retries": 3,
  "events": ["on_enroll"],
  "sequence": [
    {
      "url": "https://api.example.com/certificates",
      "authenticationType": "bearer",
      "credentials": "api-token",
      "method": "POST",
      "headers": [{ "name": "Content-Type", "value": "application/json" }],
      "payloadType": "json",
      "payload": "{\"cn\": \"{{certificate.subject.cn.1}}\", \"pem\": \"{{certificate.pem}}\"}",
      "timeout": "30 seconds",
      "expectedHttpCodes": [201]
    },
    {
      "url": "https://api.example.com/certificates/{{rest.response.1.id}}/activate",
      "authenticationType": "bearer",
      "credentials": "api-token",
      "method": "POST",
      "headers": [{ "name": "Content-Type", "value": "application/json" }],
      "payloadType": "json",
      "payload": "{\"activate\": true}",
      "timeout": "30 seconds",
      "expectedHttpCodes": [200]
    }
  ]
}
```

**How it works:**

1. Step 1 creates the certificate resource and returns `{"id": "cert-abc123", ...}`
2. Step 2 uses `{{rest.response.1.id}}` in the URL to activate the newly created resource

### Example 7: Expiration Warning to External Ticketing System

Create a ticket 30 days before certificate expiration:

```json
{
  "name": "create-expiry-ticket-30d",
  "type": "rest",
  "retries": 3,
  "runPeriod": "30 days",
  "runOnRenewed": false,
  "events": ["on_expire"],
  "sequence": [
    {
      "url": "https://jira.example.com/rest/api/2/issue",
      "authenticationType": "basic",
      "credentials": "jira-service-account",
      "method": "POST",
      "headers": [{ "name": "Content-Type", "value": "application/json" }],
      "payloadType": "json",
      "payload": "{\"fields\": {\"project\": {\"key\": \"OPS\"}, \"summary\": \"Certificate expiring: {{certificate.subject.cn.1}}\", \"description\": \"Certificate {{certificate.dn}} (serial: {{certificate.serial}}) expires on {{DateTimeFormat({{certificate.not_after}}, \"yyyy-MM-dd\")}}. Profile: {{certificate.profile}}. Owner: {{OrElse({{certificate.owner}}, \"unassigned\")}}\", \"issuetype\": {\"name\": \"Task\"}, \"priority\": {\"name\": \"High\"}}}",
      "timeout": "15 seconds",
      "expectedHttpCodes": [201]
    }
  ]
}
```

**Key points:**

- `runPeriod: "30 days"` means this fires 30 days before expiration
- `runOnRenewed: false` means it won't fire if the certificate was already renewed
- Uses `DateTimeFormat()` to format the expiration date
- Uses `OrElse()` to provide a fallback if owner is not set

---

## Advanced Use-Cases

These examples use response chaining and documented notification events
to connect Horizon with external systems.

### Use-Case A: ServiceNow Incident on Certificate Expiration with Team Assignment

**Goal:** When a certificate is about to expire, create a ServiceNow incident
and assign it to the team that owns the certificate. This requires looking up
the team's ServiceNow assignment group ID first.

**Why multi-step:** ServiceNow needs an `assignment_group` sys_id, but Horizon
only has the team name. Step 1 looks up the sys_id, step 2 creates the incident.

```json
{
  "name": "servicenow-expiry-incident",
  "type": "rest",
  "retries": 5,
  "runPeriod": "30 days",
  "runOnRenewed": false,
  "events": ["on_expire"],
  "sequence": [
    {
      "url": "https://myinstance.service-now.com/api/now/table/sys_user_group?sysparm_query=name={{certificate.team}}&sysparm_fields=sys_id,name&sysparm_limit=1",
      "authenticationType": "basic",
      "credentials": "servicenow-api-creds",
      "method": "GET",
      "headers": [
        { "name": "Content-Type", "value": "application/json" },
        { "name": "Accept", "value": "application/json" }
      ],
      "timeout": "15 seconds",
      "expectedHttpCodes": [200]
    },
    {
      "url": "https://myinstance.service-now.com/api/now/table/incident",
      "authenticationType": "basic",
      "credentials": "servicenow-api-creds",
      "method": "POST",
      "headers": [
        { "name": "Content-Type", "value": "application/json" },
        { "name": "Accept", "value": "application/json" }
      ],
      "payloadType": "json",
      "payload": "{\"short_description\": \"Certificate expiring: {{certificate.subject.cn.1}}\", \"description\": \"Certificate {{certificate.dn}} (serial: {{certificate.serial}}) expires on {{DateTimeFormat({{certificate.not_after}}, \"yyyy-MM-dd\")}}. Profile: {{certificate.profile}}. Owner: {{OrElse({{certificate.owner}}, \"unassigned\")}}.\", \"urgency\": \"2\", \"impact\": \"2\", \"assignment_group\": \"{{rest.response.1.result.1.sys_id}}\", \"category\": \"certificate\", \"subcategory\": \"expiration\"}",
      "timeout": "15 seconds",
      "expectedHttpCodes": [201]
    }
  ]
}
```

**How chaining works:**

1. Step 1 queries ServiceNow's `sys_user_group` table filtering by the
   certificate's team name (`{{certificate.team}}`). ServiceNow returns
   JSON: `{"result": [{"sys_id": "abc123", "name": "DevOps"}]}`
2. Step 2 references `{{rest.response.1.result.1.sys_id}}` to use the
   resolved group sys_id as the `assignment_group` for the incident.

### Use-Case B: Jira ITSM Ticket on License Expiration

**Goal:** Create a high-priority Jira ticket when the Horizon license is
about to expire or when the license cap is about to be reached.

**For license expiration:**

```json
{
  "name": "jira-license-expiry",
  "type": "rest",
  "retries": 3,
  "runPeriod": "30 days",
  "events": ["on_license_expiration"],
  "sequence": [
    {
      "url": "https://jira.example.com/rest/api/2/issue",
      "authenticationType": "basic",
      "credentials": "jira-service-account",
      "method": "POST",
      "headers": [{ "name": "Content-Type", "value": "application/json" }],
      "payloadType": "json",
      "payload": "{\"fields\": {\"project\": {\"key\": \"OPS\"}, \"summary\": \"Horizon license expiring on {{license.expiration_date}}\", \"description\": \"The Horizon CLM license expires on {{license.expiration_date}}. Please renew the license before expiration to avoid service disruption.\", \"issuetype\": {\"name\": \"Task\"}, \"priority\": {\"name\": \"High\"}}}",
      "timeout": "15 seconds",
      "expectedHttpCodes": [201]
    }
  ]
}
```

**For license usage threshold (e.g., 80%):**

```json
{
  "name": "jira-license-usage-80pct",
  "type": "rest",
  "retries": 3,
  "licenceUsagePercent": 80,
  "events": ["on_license_usage"],
  "sequence": [
    {
      "url": "https://jira.example.com/rest/api/2/issue",
      "authenticationType": "basic",
      "credentials": "jira-service-account",
      "method": "POST",
      "headers": [{ "name": "Content-Type", "value": "application/json" }],
      "payloadType": "json",
      "payload": "{\"fields\": {\"project\": {\"key\": \"OPS\"}, \"summary\": \"Horizon license usage at {{license.percent_used}}%\", \"description\": \"License usage has reached {{license.percent_used}}% ({{license.used}} holders). Consider upgrading the license.\", \"issuetype\": {\"name\": \"Task\"}, \"priority\": {\"name\": \"High\"}}}",
      "timeout": "15 seconds",
      "expectedHttpCodes": [201]
    }
  ]
}
```

### Use-Case C: Close ServiceNow Incident on Certificate Renewal

**Goal:** When a certificate is renewed, close the expiration incident that
was previously opened.

Use a caller-chosen correlation key in the external system to locate an
incident in a later notification.

**Solution:** Use the certificate's serial number or thumbprint as a
correlation key. When creating the incident (Use-Case A), include the serial
in a custom field. When closing, search ServiceNow by that correlation key.

```json
{
  "name": "servicenow-close-on-renew",
  "type": "rest",
  "retries": 3,
  "events": ["on_renew"],
  "sequence": [
    {
      "url": "https://myinstance.service-now.com/api/now/table/incident?sysparm_query=category=certificate^subcategory=expiration^short_descriptionLIKE{{previous.certificate.subject.cn.1}}^state!=7&sysparm_fields=sys_id,number&sysparm_limit=1",
      "authenticationType": "basic",
      "credentials": "servicenow-api-creds",
      "method": "GET",
      "headers": [
        { "name": "Content-Type", "value": "application/json" },
        { "name": "Accept", "value": "application/json" }
      ],
      "timeout": "15 seconds",
      "expectedHttpCodes": [200]
    },
    {
      "url": "https://myinstance.service-now.com/api/now/table/incident/{{rest.response.1.result.1.sys_id}}",
      "authenticationType": "basic",
      "credentials": "servicenow-api-creds",
      "method": "PATCH",
      "headers": [
        { "name": "Content-Type", "value": "application/json" },
        { "name": "Accept", "value": "application/json" }
      ],
      "payloadType": "json",
      "payload": "{\"state\": \"7\", \"close_code\": \"Solved (Permanently)\", \"close_notes\": \"Certificate renewed. New serial: {{certificate.serial}}, new expiry: {{DateTimeFormat({{certificate.not_after}}, \"yyyy-MM-dd\")}}\"}",
      "timeout": "15 seconds",
      "expectedHttpCodes": [200]
    }
  ]
}
```

**How it works:**

1. Step 1 searches ServiceNow for open incidents (`state!=7`) in the
   `certificate/expiration` category that mention the **previous** certificate's
   CN (`{{previous.certificate.subject.cn.1}}` - available on `on_renew`).
2. Step 2 uses the returned `sys_id` to close the incident with resolution notes
   including the new certificate serial and expiration date.

**Important:** This uses `previous.certificate.subject.cn.1` (the old cert's CN)
to find the matching incident, because the incident was created with the old
certificate's CN. The `previous.certificate.*` dictionary is only available
on `on_renew` events.

**Alternative correlation approaches:**

- Store the certificate thumbprint in a ServiceNow custom field during creation,
  search by `{{previous.certificate.thumbprint}}` during closure
- Use a label on the certificate to store an external reference (if the external
  system's identifier is known at enrollment time)

## Attaching REST Notifications to Profiles

Profiles reference notifications through `triggers`. Use the documented
hook fields, such as `onEnroll` and `onApproveEnroll`. Configure these hooks
in the Horizon administration UI or through the profile API. See
`horizon://knowledge/automation` for the hook field mapping.

---

## Key Considerations

1. Ask the user for the notification name before creation.
2. Each REST notification uses one event. Create separate notifications for
   `on_enroll` and `on_renew`.
3. Select dictionary keys from the public dictionary reference for the event.
4. Create referenced credentials in Horizon before creating the notification.
5. Set a timeout that suits the target API.
6. List each successful response code in `expectedHttpCodes`, including
   `204` if the target returns it.

---

## Related Resources

- `horizon://knowledge/automation` - trigger attachment, execution policies, all trigger types
- `horizon://knowledge/computation-and-data-flow` - complete computation rule reference
- `horizon://knowledge/dictionary-matrix` - dictionary entry matrix by context and module
- `horizon://knowledge/profiles` - profile configuration and trigger hooks
- `horizon://knowledge/workflows` - certificate lifecycle workflows and events
