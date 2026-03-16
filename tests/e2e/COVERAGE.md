# E2E Test Coverage Report

## Summary

| Scope | Tools | E2E Tests | Coverage |
|-------|-------|-----------|----------|
| **Phase 1 (master)** | 96 | 132 | ~100% |
| **Phase 2 (mcp-extension)** | 120 | 89 | ~75% |
| **Total** | 216 | 221 | ~90% |

## Phase 1 Coverage (master branch)

All 96 Phase 1 tools have E2E test coverage.

| Module | Tools | Tests | File | Status |
|--------|-------|-------|------|--------|
| Assist (system) | 4 | 4 | `test_assist.py` | Full |
| Assist (query) | 5 | 9 | `test_assist.py` | Full |
| Assist (crypto) | 3 | 3 | `test_assist.py` | Full |
| Assist (computation) | 2 | 3 | `test_assist.py` | Full |
| Assist (translate) | 1 | 3 | `test_assist.py` | Full |
| Lifecycle | 17 | 16 | `test_lifecycle.py` | Full |
| Dashboards | 12 | 12 | `test_dashboards.py` | Full |
| Discovery campaigns | 6 | 7 | `test_discovery.py` | Full |
| Discovery events | 3 | 3 | `test_discovery.py` | Full |
| Discovery feed | 4 | 1 | `test_discovery.py` | Full (lifecycle test) |
| Reports | 3 | 4 | `test_reports.py` | Full |
| Analytics | 1 | 4 | `test_reports.py` | Full |
| Config (read-only) | 19 | 20 | `test_config_readonly.py` | Full |
| Profiles (Phase 1) | 12 | 5 | `test_profiles.py` | Full |
| Security (read-only) | 4 | 6 | `test_security_readonly.py` | Full |

### Knowledge Resources

All 12 knowledge resources tested for accessibility, content quality, and structure.

## Phase 2 Coverage (mcp-extension branch)

| Module | Tools | Tests | File | Status |
|--------|-------|-------|------|--------|
| Config (admin) | 15 | 8 | `test_config_admin.py` | Full (label, proxy, password policy CRUD) |
| Security (admin) | 25 | 9 | `test_security_admin.py` | Full (role, team, principal CRUD) |
| Triggers | 8 | 5 | `test_triggers.py` | Full |
| Connectors | 10 | 8 | `test_connectors.py` | Read-only (create needs infrastructure) |
| Automation | 12 | 9 | `test_automation.py` | Partial (execution policy CRUD, rest read-only) |
| Local Identities | 8 | 6 | `test_local_identities.py` | Partial (CRUD + password, skip reset) |
| Scheduler | 8 | 8 | `test_scheduler.py` | Read-only (run skipped) |
| System Config | 6 | 10 | `test_system_config.py` | Full read + export (upsert/import skipped) |
| Archives | 8 | 12 | `test_archives.py` | Read-only (CRUD skipped — long-running) |
| WCCE | 7 | 6 | `test_wcce.py` | Read-only (needs AD infrastructure) |
| Profiles (admin) | 13 | 8 | `test_profiles_admin.py` | Partial (delete + conditional v1B) |

## Infrastructure Gaps

These tools cannot be fully tested without external infrastructure:

| Gap | Tools Affected | Reason |
|-----|---------------|--------|
| Active Directory | WCCE create/update/delete, wcce_enroll | Needs AD forest |
| Intune/SCEP | create_intune_profile, update_intune_profile | Needs Microsoft Intune |
| IntunePKCS | create_intunepkcs_profile, update_intunepkcs_profile | Needs Intune PKCS |
| Jamf | create_jamf_profile, update_jamf_profile | Needs Jamf Pro |
| SMTP | Email triggers | No SMTP server in test env |
| PKI Backend | create_pki_connector | Needs ADCS/EJBCA/Vault |
| OIDC Provider | create_identity_provider (openid) | Needs real OIDC IdP |
| Email Infrastructure | initiate/complete_password_reset | Needs email delivery |
| Long-running Jobs | archive CRUD, run_scheduled_task | Side effects, timing |

## LLM Evaluation

| Tier | Tests | Description |
|------|-------|-------------|
| Tier 1 — Tool Selection | 10 | Golden scenarios: does Claude pick the right tools? |
| Tier 2 — MCP Loop | 4 | Full tool execution against live Horizon |
| Tier 3 — Smoke | 2 | Basic Claude Code integration check |

## Running Tests

```bash
# Unit tests only (no external deps)
pytest tests/ -m "not e2e and not llm_evaluation" -q

# Phase 1 E2E (needs Horizon QA instance)
HORIZON_E2E_URL=... HORIZON_E2E_API_ID=... HORIZON_E2E_API_KEY=... \
  pytest -m e2e tests/e2e/ -v

# LLM evaluation (needs Claude Code + Horizon QA)
HORIZON_E2E_URL=... HORIZON_E2E_API_ID=... HORIZON_E2E_API_KEY=... \
  pytest -m llm_evaluation -v
```
