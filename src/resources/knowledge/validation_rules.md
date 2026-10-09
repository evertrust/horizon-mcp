# Validation Rules - Auto-Approval Condition Reference

## Overview

Validation rules control automatic approval of certificate enrollment requests.
They use dictionary entries, including results from datasource flows.

---

## Decision Guide - How to Build a Validation Ruleset

### Step 1: Determine if your module supports validation rules

Only **WebRA**, **SCEP**, and **EST** profiles support auto-validation.
All other modules (ACME, CRMP, WCCE, Intune, Jamf, etc.) do not support a
validation ruleset. If the user's profile uses
a different module, validation rules are not an option.

### Step 2: Choose the authorization mode

- Use `auto-validation` when: you want requests that fail validation to be
  **rejected immediately** with no human fallback.
- Use `auto-validation-authorized` (WebRA only) when: you want failed
  validation to fall through to a **manual approval queue** instead of rejecting.

### Step 3: Identify what data you need to check

| What you need to check     | Where the data comes from                               | Needs datasource? |
| -------------------------- | ------------------------------------------------------- | :---------------: |
| DN / CN pattern matching   | `{{csr.subject.cn.1}}`, `{{webra.enroll.subject.cn.1}}` |        No         |
| SAN pattern matching       | `{{csr.san.dnsname.1}}`, `[[csr.san.dnsname]]`          |        No         |
| Key type / algorithm       | Via profile's cryptoPolicy (not in validation)          |        No         |
| Client IP address          | `{{http.request.ip}}`                                   |        No         |
| DNS resolution check       | `{{csr.san.dnsname.1}} resolvesDNS`                     |        No         |
| CNAME / TXT record content | Needs DNS datasource -> `{{ds.1.1.cname}}`              |      **Yes**      |
| User's AD group membership | Needs LDAP datasource -> `[[ds.1.1.memberOf]]`          |      **Yes**      |
| User's department / role   | Needs LDAP datasource -> `{{ds.1.1.department}}`        |      **Yes**      |
| External API validation    | Needs REST datasource -> `{{ds.1.status}}`              |      **Yes**      |

### Step 4: Create datasources if needed

If you need external data, create the datasource first and add it to the
profile's dsFlow BEFORE configuring the validation ruleset. The datasource
flow executes before validation rules, populating the `ds.*` entries.

See horizon://knowledge/datasources for full datasource setup guide.

### Step 5: Write the condition expressions

Use the operators documented below. Key tips:

- Each rule is a **single string** (not an object)
- Use `{{key}}` for single values, `[[key]]` for lists
- Indexes are **1-based**: `{{csr.san.dnsname.1}}` is the first DNS SAN
- Combine conditions within a single rule using `and` / `or` / `not`
- Use `threshold` to control how many rules must pass

### Step 6: Choose the threshold

- `threshold: 1` = any rule passing is enough (OR logic across rules)
- `threshold: len(rules)` = all rules must pass (AND logic across rules)
- For complex "A AND (B OR C)" logic, use boolean operators within a single
  rule string rather than multiple rules with a threshold

---

## Module Support

**Only 3 modules support validation rules.** Other modules do not accept a
validation ruleset.

| Module        | authorizationMode values                                      | Supports auto-validation |
| ------------- | ------------------------------------------------------------- | :----------------------: |
| **WebRA**     | `authorized`, `auto-validation`, `auto-validation-authorized` |           Yes            |
| **SCEP**      | `authorized`, `ndes`, `challenge`, `auto-validation`          |           Yes            |
| **EST**       | `authorized`, `x509`, `challenge`, `auto-validation`          |           Yes            |
| ACME          | (uses ACME challenges)                                        |            No            |
| ACME External | -                                                             |            No            |
| CRMP          | -                                                             |            No            |
| WCCE          | -                                                             |            No            |
| Intune        | -                                                             |            No            |
| Intune PKCS   | -                                                             |            No            |
| AWS           | -                                                             |            No            |
| F5 Client     | -                                                             |            No            |
| Jamf          | (NDES mode only)                                              |            No            |
| Monitored     | (not a managed profile)                                       |   Field does not exist   |

### Authorization Mode Behavior

- **`authorized`**: Uses the protocol's authorization policy. See the profile
  guide for that protocol.
- **`auto-validation`**: Request is auto-approved if the validation ruleset passes. If it fails, the request is **rejected outright**.
- **`auto-validation-authorized`** (WebRA only): Tries auto-validation first. If rules fail, the request **falls through to manual approval** instead of being rejected.
- **`challenge`** (SCEP/EST): Uses challenge-based validation, not rulesets.
- **`ndes`** (SCEP): Uses NDES challenge protocol.
- **`x509`** (EST): Uses X.509 client certificate authentication.

---

## ValidationRuleset Structure

```json
{
  "validationRuleset": {
    "rules": ["condition1", "condition2"],
    "threshold": 2
  }
}
```

| Field       | Type     | Required | Description                                                 |
| ----------- | -------- | -------- | ----------------------------------------------------------- |
| `rules`     | string[] | Yes      | Boolean condition expressions (plain strings, NOT objects)  |
| `threshold` | integer  | Yes      | Minimum rules that must pass. Must be > 0 and <= len(rules) |

### Threshold Semantics

| Threshold    | Behavior                                 |
| ------------ | ---------------------------------------- |
| `1`          | At least one rule must pass (logical OR) |
| `N`          | At least N rules must pass (quorum)      |
| `len(rules)` | All rules must pass (logical AND)        |

---

## Condition Syntax

Each rule is a string containing a boolean expression. Expressions reference
dictionary entries using computation rule syntax: `{{key}}` for single values,
`[[key]]` for multi-values. Indexes are **1-based**.

### Comparison Operators

These are the EXACT syntaxes accepted by the parser. Using wrong syntax
(e.g., `startsWith` instead of `starts with`) will cause a parse error.

| Operator    | Aliases | Syntax                                | Description                                                                     |
| ----------- | ------- | ------------------------------------- | ------------------------------------------------------------------------------- |
| equals      | `=`     | `{{key}} equals "value"`              | Exact string match (case-sensitive)                                             |
| matches     | `~`     | `{{key}} matches "regex"`             | Java regex full match (`String.matches`)                                        |
| contains    | -       | `{{key}} contains "substring"`        | Substring check on single values. On multi-value fields: exact element match    |
| starts with | -       | `{{key}} starts with "prefix"`        | Starts with prefix. **Two words, not `startsWith`**                             |
| ends with   | -       | `{{key}} ends with "suffix"`          | Ends with suffix. **Two words, not `endsWith`**                                 |
| in          | -       | `{{key}} in ["val1", "val2"]`         | Value is one of the listed values. **Use square brackets, NOT parentheses**     |
| within      | -       | `{{key}} within ["regex1", "regex2"]` | Value matches at least one regex in the list                                    |
| exists      | -       | `{{key}} exists`                      | Single value is defined, even if empty. A list must contain at least one value. |
| is empty    | -       | `{{key}} is empty`                    | Key is absent or empty. Negate: `{{key}} is not empty`                          |
| resolvesDNS | -       | `{{key}} resolvesDNS`                 | Live DNS A/AAAA check. On multi-value: ALL must resolve                         |

**Negation**: Operators support inline `not` before the operator keyword:
`{{key}} not equals "value"`, `{{key}} not matches "regex"`, `{{key}} not in [...]`,
`{{key}} starts not with "prefix"`, `{{key}} is not empty`.
There is NO standalone `not (condition)` or `!(condition)` prefix.

### CIDR / Subnet Matching

```
{{http.request.ip}} in 10.0.0.0/8
{{http.request.ip}} in 192.168.0.0/16
{{http.request.ip}} in fd00::/8
```

Checks if an IP address falls within a CIDR range. Works for both IPv4 and IPv6.

### Boolean Logic

| Operator | Syntax                          |
| -------- | ------------------------------- |
| AND      | `(condition1) and (condition2)` |
| OR       | `(condition1) or (condition2)`  |

Parentheses control grouping: `(A and B) or (C and D)`

**IMPORTANT - NOT / negation**: There is NO standalone `not (condition)` or
`!(condition)` prefix. Negation is ONLY available as an **inline keyword**
before the operator within a condition:

- `{{key}} not equals "value"`
- `{{key}} not matches "regex"`
- `{{key}} not exists`
- `{{key}} is not empty`
- `{{key}} not in ["a", "b"]`
- `{{key}} starts not with "prefix"`
- `{{key}} ends not with "suffix"`

To negate a complex condition, restructure it. For example, instead of
`not (A and B)`, use `(A-negated) or (B-negated)` via De Morgan's law.

### Array Quantifiers and Per-Element Operators

The parser supports `all of` and `any of` prefixes on multi-value fields
for most operators. This lets you check conditions across every element
(or at least one element) of a list.

**Contains quantifiers** (set comparisons):

| Syntax                              | Description                                 |
| ----------------------------------- | ------------------------------------------- |
| `[[key1]] contains any of [[key2]]` | At least one element of key2 exists in key1 |
| `[[key1]] contains all of [[key2]]` | Every element of key2 exists in key1        |

**Per-element operator quantifiers** (apply an operator to each element):

| Syntax                                | Description                              |
| ------------------------------------- | ---------------------------------------- |
| `all of [[key]] matches "regex"`      | Every element matches the regex          |
| `any of [[key]] matches "regex"`      | At least one element matches             |
| `all of [[key]] starts with "prefix"` | Every element starts with prefix         |
| `any of [[key]] starts with "prefix"` | At least one starts with prefix          |
| `all of [[key]] ends with "suffix"`   | Every element ends with suffix           |
| `any of [[key]] ends with "suffix"`   | At least one ends with suffix            |
| `all of [[key]] in ["v1", "v2"]`      | Every element is in the value list       |
| `any of [[key]] in ["v1", "v2"]`      | At least one is in the value list        |
| `all of [[key]] within ["r1", "r2"]`  | Every element matches at least one regex |
| `any of [[key]] within ["r1", "r2"]`  | At least one matches a regex             |
| `all of [[key]] in 10.0.0.0/8`        | Every IP is in the CIDR range            |
| `any of [[key]] in 10.0.0.0/8`        | At least one IP is in range              |

**Double wildcards work**: `[[ds.1.*.a.*]]` matches across both the result
index (which hostname) AND the record sub-index (which A record for that
hostname). Use this for CIDR checks when hostnames may have multiple A records:
`all of [[ds.1.*.a.*]] in 10.0.0.0/8` checks every resolved IP across all
hostnames and all their A records.

`contains all of` and `contains any of` test element inclusion.
An empty right-hand list is always contained.

**resolvesDNS on multi-value**: `[[key]] resolvesDNS` checks that **ALL**
values in the list resolve. There is no `any of` variant for DNS resolution.

---

## Dictionary References Available in Validation Rules

Validation rules access the **same dictionary** as computation rules, including
all entries populated by datasource flows.

### Standard Entries

| Key                                              | Description                     |
| ------------------------------------------------ | ------------------------------- |
| `{{csr.subject.cn.1}}`                           | First CN from the CSR subject   |
| `{{csr.san.dnsname.1}}`, `{{csr.san.dnsname.2}}` | Individual DNS SANs from CSR    |
| `[[csr.san.dnsname]]`                            | All DNS SANs from CSR as a list |
| `{{csr.san.ipaddress.1}}`                        | Individual IP SANs from CSR     |
| `[[csr.san.dnsname]]`                            | All DNS SANs from CSR           |

### Datasource Results

| Key                     | Description                                           |
| ----------------------- | ----------------------------------------------------- |
| `{{ds.1.1.cname}}`      | CNAME from first datasource flow, first result        |
| `[[ds.1.*.a]]`          | All A records from first flow (wildcard result index) |
| `{{ds.1.1.cn}}`         | CN attribute from first LDAP datasource result        |
| `{{ds.2.1.department}}` | Department from second datasource flow                |

### Protocol-Specific

| Key                             | Description                   |
| ------------------------------- | ----------------------------- |
| `{{webra.enroll.subject.cn.1}}` | CN from WebRA enrollment form |
| `{{principal.identifier}}`      | Authenticated user's ID       |
| `{{principal.mail}}`            | Authenticated user's email    |
| `{{http.request.ip}}`           | Client IP address             |

See horizon://knowledge/dictionary-matrix for the complete list by context
and protocol.

---

## Validation Inputs

Datasource flows fill the request dictionary. Computation rules and
validation rules can use this dictionary. See the
[datasource guide](https://docs.evertrust.fr/horizon/2.11/admin-guide/datasources/introduction.html).

---

## Practical Examples

### Example 1: Domain Restriction

Only allow certificates for the corporate domain:

```json
{
  "rules": ["{{csr.subject.cn.1}} matches \".*\\.corp\\.example\\.com$\""],
  "threshold": 1
}
```

### Example 2: DNS CNAME Validation with Datasource

Verify that the first DNS SAN has a CNAME pointing to the PaaS domain.

**Setup:**

1. Create a DNS datasource named `"san-cname-check"` with `lookup: "{{hostname}}"`
2. Add it to the profile's dsFlow: `{"ds": "san-cname-check", "inputs": [{"key": "hostname", "value": "{{csr.san.dnsname.1}}"}]}`
3. Configure the validation ruleset:

```json
{
  "rules": ["{{ds.1.1.cname}} matches \".*\\.paas\\.example\\.com$\""],
  "threshold": 1
}
```

### Example 3: LDAP Group Membership Validation

Verify the requesting user belongs to a PKI-authorized group:

Inspect the datasource output with `test_datasource`. Use the full group
DN from the `memberOf` list. For example:

```json
{
  "rules": [
    "[[ds.1.1.memberOf]] contains \"CN=PKI-Users,OU=Groups,DC=example,DC=com\"",
    "{{ds.1.1.department}} exists"
  ],
  "threshold": 2
}
```

### Example 4: IP-Based Access Control

Restrict enrollment to internal networks:

```json
{
  "rules": ["{{http.request.ip}} in 10.0.0.0/8"],
  "threshold": 1
}
```

### Example 5: DNS Resolution Check

Verify the SAN actually resolves in DNS:

To check every DNS SAN from the CSR, use this standalone condition:

```text
[[csr.san.dnsname]] resolvesDNS
```

```json
{
  "rules": ["{{csr.san.dnsname.1}} resolvesDNS"],
  "threshold": 1
}
```

### Example 6: Complex Boolean Logic

Combine domain restriction with CNAME validation:

```json
{
  "rules": [
    "({{csr.subject.cn.1}} matches \".*\\.corp\\.example\\.com$\") and ({{ds.1.1.cname}} exists)"
  ],
  "threshold": 1
}
```

### Example 7: Multi-Criteria with Quorum

Require at least 2 of 3 checks to pass:

```json
{
  "rules": [
    "{{csr.subject.cn.1}} matches \".*\\.corp\\.example\\.com$\"",
    "{{ds.1.1.department}} equals \"Engineering\"",
    "{{http.request.ip}} in 10.0.0.0/8"
  ],
  "threshold": 2
}
```

### Example 8: CSR Consistency Check

Verify the CSR CN matches the WebRA form CN:

```json
{
  "rules": ["{{csr.subject.cn.1}} equals {{webra.enroll.subject.cn.1}}"],
  "threshold": 1
}
```

---

## Complete Workflow Recipes

These recipes show the full process from datasource creation through validation
rule configuration. Each recipe is self-contained.

### Recipe: LDAP Group Membership Gate for SCEP Enrollment

**Scenario**: SCEP enrollment should auto-approve only for users in the
"Certificate-Issuers" AD group.

1. Create LDAP datasource:

   ```
   create_ldap_datasource(
       name="ad-group-check",
       hostname="ldaps://dc01.corp.example.com",
       credentials="ad-bind-creds",
       base_dn="DC=example,DC=com",
       filter="(sAMAccountName={{principal.identifier}})",
       secure=True, timeout="10s", limit=1,
       attributes=[{"key": "memberOf", "multi": true, "selected": true}]
   )
   ```

2. Configure profile dsFlow:

   ```json
   {
     "dsFlow": [
       {
         "ds": "ad-group-check",
         "inputs": [
           {
             "key": "principal.identifier",
             "value": "{{principal.identifier}}"
           }
         ]
       }
     ]
   }
   ```

3. Set SCEP authorizationMode to `auto-validation`.

4. Use `test_datasource` to inspect the multivalued `memberOf` output.
   Configure `validationRuleset` with the full group DN from that output:
   ```json
   {
     "validationRuleset": {
       "rules": [
         "[[ds.1.1.memberOf]] contains \"CN=Certificate-Issuers,OU=Groups,DC=example,DC=com\""
       ],
       "threshold": 1
     }
   }
   ```

### Recipe: Network + Domain Combined Validation for EST

**Scenario**: EST enrollment auto-approves only from the internal network
AND for hostnames under the corporate domain.

No datasource needed - uses built-in dictionary entries only.

Set EST authorizationMode to `auto-validation`.

```json
{
  "validationRuleset": {
    "rules": [
      "({{http.request.ip}} in 10.0.0.0/8) and ({{csr.subject.cn.1}} matches \".*\\.corp\\.example\\.com$\")"
    ],
    "threshold": 1
  }
}
```

---

## Limitations

- Validate the datasource output with `simulate_datasource_flow` before
  using it in an enrollment condition.
- Use `exists` and `is empty` to check dictionary values. The public
  validation guide defines these checks for single values and arrays.
- `resolvesDNS` checks resolution for each value in an array. An empty
  array returns `false`.
- Use `and` and `or` within a rule for combined conditions.
- WebRA supports `auto-validation-authorized`. SCEP and EST expose
  `auto-validation` in their public authorization-mode enums.

See the public
[validation guide](https://docs.evertrust.fr/horizon/2.11/admin-guide/protocols/autovalidation.html).

---

## Related Resources

- horizon://knowledge/datasources - DNS, LDAP, REST datasource configuration
- horizon://knowledge/computation-and-data-flow - computation rule syntax and functions
- horizon://knowledge/dictionary-matrix - all dictionary entries by context and module
- horizon://knowledge/profiles - profile authorizationMode and validationRuleset structure
