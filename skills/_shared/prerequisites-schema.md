# `prerequisites.yaml` Schema

Every setup skill ships a `references/prerequisites.yaml` file that drives the Phase 2 hard gate. The schema is enforced by `scripts/verify-skills.ts`.

## Top-level shape

```yaml
schema_version: "1"
prerequisites:
  - <prerequisite entry>
  - <prerequisite entry>
  ...
```

## Prerequisite entry fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `key` | string | yes | Placeholder name used everywhere in the skill. Convention: SCREAMING_SNAKE_CASE. |
| `description` | string | yes | Plain-language description shown to the user in the question prompt. |
| `required` | boolean | yes | If `true`, the skill MUST refuse to advance to Phase 3 until the value is collected. |
| `sensitive` | boolean | yes | If `true`, the value is never printed in skill output, summaries, transcripts, or argument previews. |
| `default` | string \| number \| boolean \| null | no | Default value used when `required: false` and the user gives no value. |
| `validator` | string | no | A regular expression (POSIX ERE compatible) the value must match before the skill accepts it. |
| `enum` | array | no | If present, the value MUST be one of these values. Mutually exclusive with `validator`. |
| `applies_to` | array of strings | no | If present, the prerequisite is only collected when the skill's variant gate matches one of these tokens (for example `["intune"]` or `["intunepkcs"]`). Absent means "always". |
| `example` | string | no | A plausible-looking example used in question previews. |

## Worked example (used by setup-adcs)

```yaml
schema_version: "1"
prerequisites:
  - key: ADCS_VARIANT
    description: "Choose the ADCS connector variant: evtadcs (recommended, EverTrust ADCS Connector) or msadcs (legacy Microsoft ADCS Web)."
    required: true
    sensitive: false
    enum: ["evtadcs", "msadcs"]
    default: "evtadcs"
  - key: ADCS_CONNECTOR_URL
    description: "Base URL of the EverTrust ADCS Connector, including scheme and port."
    required: true
    sensitive: false
    validator: "^https://[A-Za-z0-9.-]+:[0-9]+$"
    example: "https://adcs01.corp.example.com:4443"
  - key: ADCS_ENROLLMENT_AGENT_PASSPHRASE
    description: "Passphrase protecting the Enrollment Agent PKCS#12."
    required: true
    sensitive: true
    validator: ".{8,}"
  - key: HORIZON_CRL_FALLBACK_POLICY
    description: "Policy when the CRL Distribution Point is unreachable."
    required: false
    sensitive: false
    enum: ["Last available status", "Strict"]
    default: "Last available status"
```

## Validator semantics

- `validator` regexes are anchored as written. Skills SHOULD use `^` and `$` explicitly.
- `enum` values are compared with strict string equality.
- A prerequisite with `required: true` and no `default` MUST be collected from the user; if the value fails `validator` or `enum`, the skill re-asks the same question.
- Sensitive prerequisites MUST NOT have their values printed in any skill output. The skill prints `<KEY_NAME>` instead.

## Schema version

`schema_version` is `"1"` for v1 of these skills. Future versions of this schema MUST bump the field and update `scripts/verify-skills.ts`.
