# Validation Rules - Auto-Approval Condition Reference

## Overview

Validation rules control automatic approval of certificate enrollment requests.
They are evaluated **after** datasource flows and computation rules execute,
giving them access to the full enriched dictionary including `ds.*` entries.

---

## Decision Guide - How to Build a Validation Ruleset

### Step 1: Determine if your module supports validation rules

Only **WebRA**, **SCEP**, and **EST** profiles support auto-validation.
All other modules (ACME, CRMP, WCCE, Intune, Jamf, etc.) do NOT - the field
is hardcoded to None in the Horizon source code. If the user's profile uses
a different module, validation rules are not an option.

### Step 2: Choose the authorization mode

- Use `auto-validation` when: you want requests that fail validation to be
  **rejected immediately** with no human fallback.
- Use `auto-validation-authorized` (WebRA only) when: you want failed
  validation to fall through to a **manual approval queue** instead of rejecting.

### Step 3: Identify what data you need to check

| What you need to check     | Where the data comes from                        | Needs datasource? |
| -------------------------- | ------------------------------------------------ | :---------------: |
| DN / CN pattern matching   | `{{subject.cn.1}}`, `{{csr.subject.cn.1}}`       |        No         |
| SAN pattern matching       | `{{san.dns.1}}`, `[[san.dns]]`                   |        No         |
| Key type / algorithm       | Via profile's cryptoPolicy (not in validation)   |        No         |
| Client IP address          | `{{http.request.ip}}`                            |        No         |
| DNS resolution check       | `{{san.dns.1}} resolvesDNS`                      |        No         |
| CNAME / TXT record content | Needs DNS datasource -> `{{ds.1.1.cname}}`       |      **Yes**      |
| User's AD group membership | Needs LDAP datasource -> `{{ds.1.1.memberOf}}`   |      **Yes**      |
| User's department / role   | Needs LDAP datasource -> `{{ds.1.1.department}}` |      **Yes**      |
| External API validation    | Needs REST datasource -> `{{ds.1.1.status}}`     |      **Yes**      |

### Step 4: Create datasources if needed

If you need external data, create the datasource first and add it to the
profile's dsFlow BEFORE configuring the validation ruleset. The datasource
flow executes before validation rules, populating the `ds.*` entries.

See horizon://knowledge/datasources for full datasource setup guide.

### Step 5: Write the condition expressions

Use the operators documented below. Key tips:

- Each rule is a **single string** (not an object)
- Use `{{key}}` for single values, `[[key]]` for lists
- Indexes are **1-based**: `{{san.dns.1}}` is the first DNS SAN
- Combine conditions within a single rule using `and` / `or` / `not`
- Use `threshold` to control how many rules must pass

### Step 6: Choose the threshold

- `threshold: 1` = any rule passing is enough (OR logic across rules)
- `threshold: len(rules)` = all rules must pass (AND logic across rules)
- For complex "A AND (B OR C)" logic, use boolean operators within a single
  rule string rather than multiple rules with a threshold

---

## Module Support

**Only 3 modules support validation rules.** This is enforced in source code -
all other managed profiles hardcode `validationRuleset = None`.

| Module        | authorizationMode values                                      | Supports auto-validation |
| ------------- | ------------------------------------------------------------- | :----------------------: |
| **WebRA**     | `authorized`, `auto-validation`, `auto-validation-authorized` |           Yes            |
| **SCEP**      | `authorized`, `ndes`, `challenge`, `auto-validation`          |           Yes            |
| **EST**       | `authorized`, `x509`, `challenge`, `auto-validation`          |           Yes            |
| ACME          | (uses ACME challenges)                                        |   No - hardcoded None    |
| ACME External | -                                                             |   No - hardcoded None    |
| CRMP          | -                                                             |   No - hardcoded None    |
| WCCE          | -                                                             |   No - hardcoded None    |
| Intune        | -                                                             |   No - hardcoded None    |
| Intune PKCS   | -                                                             |   No - hardcoded None    |
| AWS           | -                                                             |   No - hardcoded None    |
| F5 Client     | -                                                             |   No - hardcoded None    |
| Jamf          | (hardcoded NDES mode)                                         |   No - hardcoded None    |
| Monitored     | (not a managed profile)                                       |   Field does not exist   |

### Authorization Mode Behavior

- **`authorized`**: Every request requires manual operator approval. No validation rules evaluated.
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

**Short-circuit**: Evaluation stops once the threshold is met.

---

## Condition Syntax

Each rule is a string containing a boolean expression. Expressions reference
dictionary entries using computation rule syntax: `{{key}}` for single values,
`[[key]]` for multi-values. Indexes are **1-based**.

### Comparison Operators

These are the EXACT syntaxes accepted by the parser. Using wrong syntax
(e.g., `startsWith` instead of `starts with`) will cause a parse error.

| Operator    | Aliases | Syntax                                | Description                                                                  |
| ----------- | ------- | ------------------------------------- | ---------------------------------------------------------------------------- |
| equals      | `=`     | `{{key}} equals "value"`              | Exact string match (case-sensitive)                                          |
| matches     | `~`     | `{{key}} matches "regex"`             | Java regex full match (`String.matches`)                                     |
| contains    | -       | `{{key}} contains "substring"`        | Substring check on single values. On multi-value fields: exact element match |
| starts with | -       | `{{key}} starts with "prefix"`        | Starts with prefix. **Two words, not `startsWith`**                          |
| ends with   | -       | `{{key}} ends with "suffix"`          | Ends with suffix. **Two words, not `endsWith`**                              |
| in          | -       | `{{key}} in ["val1", "val2"]`         | Value is one of the listed values. **Use square brackets, NOT parentheses**  |
| within      | -       | `{{key}} within ["regex1", "regex2"]` | Value matches at least one regex in the list                                 |
| exists      | -       | `{{key}} exists`                      | Key is present and non-empty in dictionary                                   |
| is empty    | -       | `{{key}} is empty`                    | Key is absent or empty. Negate: `{{key}} is not empty`                       |
| resolvesDNS | -       | `{{key}} resolvesDNS`                 | Live DNS A/AAAA check. On multi-value: ALL must resolve                      |

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

| Syntax                                | Description                                                  |
| ------------------------------------- | ------------------------------------------------------------ |
| `[[key1]] contains any of [["key2"]]` | At least one element of key2 exists in key1                  |
| `[[key1]] contains all of [["key2"]]` | key2 is a **contiguous subsequence** of key1 (order matters) |

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

**Important**: `contains all of` uses `containsSlice` - it checks that the
right-hand list appears as a contiguous ordered slice within the left-hand
list. This is stricter than "all elements exist regardless of order".

**resolvesDNS on multi-value**: `[[key]] resolvesDNS` checks that **ALL**
values in the list resolve. There is no `any of` variant for DNS resolution.

---

## Dictionary References Available in Validation Rules

Validation rules access the **same dictionary** as computation rules, including
all entries populated by datasource flows.

### Standard Entries

| Key                              | Description                       |
| -------------------------------- | --------------------------------- |
| `{{subject.cn.1}}`               | First CN from certificate subject |
| `{{san.dns.1}}`, `{{san.dns.2}}` | Individual DNS SANs (1-indexed)   |
| `[[san.dns]]`                    | All DNS SANs as a list            |
| `{{san.ip.1}}`                   | Individual IP SANs                |
| `{{csr.subject.cn.1}}`           | CN from CSR                       |
| `[[csr.san.dnsname]]`            | All DNS SANs from CSR             |

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

See horizon://knowledge/dictionary-entries for the complete list by context
and protocol.

---

## Processing Order

```
1. Request submitted
2. Datasource flows execute  ->  populate ds.* dictionary entries
3. Computation rules execute  ->  transform fields using ds.* and other entries
4. Validation ruleset evaluated  ->  has access to ALL dictionary entries
5. Decision based on result + authorizationMode:
   - auto-validation: pass -> approve, fail -> reject
   - auto-validation-authorized: pass -> approve, fail -> manual queue
```

---

## Practical Examples

### Example 1: Domain Restriction

Only allow certificates for the corporate domain:

```json
{
  "rules": ["{{subject.cn.1}} matches \".*\\.corp\\.example\\.com$\""],
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
  "rules": ["{{ds.1.1.cname}} matches \".*\\.paas\\.internal$\""],
  "threshold": 1
}
```

### Example 3: LDAP Group Membership Validation

Verify the requesting user belongs to a PKI-authorized group:

```json
{
  "rules": [
    "{{ds.1.1.memberOf}} contains \"CN=PKI-Users\"",
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

```json
{
  "rules": ["{{san.dns.1}} resolvesDNS"],
  "threshold": 1
}
```

### Example 6: Complex Boolean Logic

Combine domain restriction with CNAME validation:

```json
{
  "rules": [
    "({{subject.cn.1}} matches \".*\\.corp\\.local$\") and ({{ds.1.1.cname}} exists)"
  ],
  "threshold": 1
}
```

### Example 7: Multi-Criteria with Quorum

Require at least 2 of 3 checks to pass:

```json
{
  "rules": [
    "{{subject.cn.1}} matches \".*\\.corp\\.local$\"",
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

### Recipe: DNS CNAME Validation for All SANs

**Scenario**: Validate that all DNS SANs in an enrollment request have CNAME
records pointing to an expected target domain.

**Key technique**: The DNS datasource splits comma-separated lookup values
into separate queries. Use `Join([[csr.san.dnsname]], ",")` in the dsFlow
input to look up every SAN in one flow entry.

**Datasource**: `create_dns_datasource(name="san-cname-check", lookup="{{hostnames}}", record_types=["cname"])`

**dsFlow**: `{"ds": "san-cname-check", "inputs": [{"key": "hostnames", "value": "Join([[csr.san.dnsname]], \",\")"}]}`

**Validation ruleset** (combine multiple rules for defense-in-depth):

```json
{
  "rules": [
    "all of [[csr.san.dnsname]] matches \".*\\.expected\\.domain$\"",
    "[[csr.san.dnsname]] resolvesDNS",
    "all of [[ds.1.*.cname]] matches \".*\\.target\\.domain$\""
  ],
  "threshold": 3
}
```

Rule 1 restricts SANs to an allowed domain. Rule 2 catches fabricated
hostnames that don't exist in DNS. Rule 3 validates all CNAME targets.

**Important**: Rule 3 only checks CNAMEs that exist. If a SAN resolves via
a direct A record (no CNAME), it is invisible to Rule 3. This is safe when
the DNS zone only contains CNAME records for the target domain. When direct
A records may also exist, add a CIDR rule on A records
(`all of [[ds.1.*.a.1]] in <expected-cidr>`) and omit the `recordTypes`
filter on the datasource so it returns both CNAME and A results. See the
Limitations section for full details on the `all of` visibility gap.

### Recipe: LDAP Group Membership Gate for SCEP Enrollment

**Scenario**: SCEP enrollment should auto-approve only for users in the
"Certificate-Issuers" AD group.

1. Create LDAP datasource:

   ```
   create_ldap_datasource(
       name="ad-group-check",
       hostname="ldaps://dc01.corp.local",
       credentials="ad-bind-creds",
       base_dn="DC=corp,DC=local",
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

4. Configure validationRuleset:
   ```json
   {
     "validationRuleset": {
       "rules": ["{{ds.1.1.memberOf}} contains \"CN=Certificate-Issuers\""],
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
      "({{http.request.ip}} in 10.0.0.0/8) and ({{subject.cn.1}} matches \".*\\.corp\\.local$\")"
    ],
    "threshold": 1
  }
}
```

---

## Limitations

1. **DNS comma-split enables per-SAN validation for unbounded lists**: The DNS
   datasource splits comma-separated lookup values into separate queries.
   Combined with `Join([[csr.san.dnsname]], ",")` in the dsFlow input, this
   performs one DNS lookup per SAN for any number of SANs. Use
   `all of [[ds.1.*.cname]]` or similar array quantifiers to validate all
   results. LDAP and REST datasources do NOT have comma-split behavior.

2. **The `all of` quantifier only checks elements that exist**: When using
   the Join + comma-split pattern, `all of [[ds.1.*.cname]] matches "regex"`
   validates all CNAME results that were returned. But if a SAN has no CNAME
   record (e.g., it resolves via a direct A record), no `ds.1.N.cname` entry
   is produced for that index, and `all of` silently skips it. The rule
   passes even though one SAN lacks a CNAME.

   The underlying mechanism: `all of` internally uses `reduceAnd` which
   returns true when all elements in the list match. If 3 SANs were submitted
   but only 2 have CNAMEs, the CNAME list has 2 elements, both match, and
   the rule passes - the missing 3rd SAN is invisible.

   **Why you cannot check "A records exist without CNAME"**: DNS A queries
   transparently follow CNAME chains (RFC 1034). When you query A records for
   a hostname that has a CNAME, the DNS resolver follows the chain and returns
   the A record of the final target. The datasource result contains an A record
   in BOTH cases - whether the hostname has a CNAME or resolves directly. There
   is no way to distinguish "A record obtained via CNAME chain" from "direct A
   record" in the datasource output. Therefore, a rule like "check that A
   records don't exist" cannot work - A records always exist for any resolvable
   hostname.

   **Mitigation strategies** (combine multiple rules - choose by DNS architecture):

   **Strategy A - CNAME-only datasource** (when the DNS zone guarantees no
   direct A records exist for the target domain - only CNAMEs or no record):
   - Configure datasource with `recordTypes: ["cname"]`
   - Add `[[csr.san.dnsname]] resolvesDNS` as a separate rule to catch
     SANs that don't exist at all in DNS
   - Use `auto-validation-authorized` (WebRA) as a safety net
   - This is airtight when the DNS zone contains only CNAME records (a
     hostname either has a CNAME or doesn't exist - nothing in between)

   **Strategy B - CNAME + A with CIDR check** (when direct A records might
   exist in the DNS zone and need to be caught):
   - Configure datasource WITHOUT `recordTypes` filter (returns all types)
   - Add a CIDR rule to catch SANs that resolve to IPs outside the expected
     infrastructure. Use double wildcards to cover all A/AAAA records per
     hostname (a single hostname can return multiple A and AAAA records):
     `(all of [[ds.1.*.a.*]] in <ipv4-cidr>) and (all of [[ds.1.*.aaaa.*]] in <ipv6-cidr>)`
   - Single wildcard `[[ds.1.*.a.1]]` only checks the FIRST A record per
     hostname - use `[[ds.1.*.a.*]]` to check ALL of them
   - This narrows the gap to: a direct A/AAAA record that happens to point
     into the expected IP range (very narrow edge case)

   **Strategy C - Capped per-index** (when airtight detection of missing
   CNAMEs is required regardless of DNS architecture):
   - Set `max` on the DNSNAME SAN element in the profile template
   - Use one dsFlow entry + one validation rule per SAN index with
     `({{ds.N.1.cname}} matches "regex") or ({{csr.san.dnsname.N}} is empty)`
   - This detects missing CNAMEs because `matches` returns false when the
     field doesn't exist, and `is empty` returns false when the SAN exists

   **Threat matrix for combining rules** (each rule catches specific threats):

   | Threat                                    | `resolvesDNS` | CNAME match | A/AAAA CIDR |
   | ----------------------------------------- | :-----------: | :---------: | :---------: |
   | SAN doesn't exist in DNS                  |    Catches    |      -      |      -      |
   | CNAME points to wrong target              |       -       |   Catches   |  May catch  |
   | No CNAME, direct A outside expected range |       -       |  Invisible  |   Catches   |
   | No CNAME, direct A inside expected range  |       -       |  Invisible  |  Invisible  |

3. **resolvesDNS checks A/AAAA resolution, not specific record types**: It
   verifies the hostname resolves but cannot check CNAME targets, TXT content,
   or other record-type-specific data. On multi-value fields like
   `[[csr.san.dnsname]]`, it checks ALL elements - if any single SAN fails
   to resolve, the entire rule fails. Use a DNS datasource flow for
   record-type-specific validation.

4. **Threshold is global**: You cannot express "rule A AND (rule B OR rule C)"
   at the ruleset level. For complex boolean logic, use `and`/`or`
   operators **within a single rule** condition string.

5. **Only WebRA supports auto-validation-authorized**: SCEP and EST only have
   `auto-validation` (hard reject on failure, no fallback to manual approval).

6. **No count or length function**: There is no way to compare the number of
   elements in two multi-valued fields. This means you cannot verify that
   "the number of CNAME results equals the number of SANs" without capping
   the SAN count and using per-index rules.

---

## Related Resources

- horizon://knowledge/datasources - DNS, LDAP, REST datasource configuration
- horizon://knowledge/computation-and-data-flow - computation rule syntax and functions
- horizon://knowledge/dictionary-entries - all dictionary entries by context and module
- horizon://knowledge/profiles - profile authorizationMode and validationRuleset structure
