"""Golden evaluation scenarios — tool selection and resource usage expectations."""

from __future__ import annotations

from dataclasses import dataclass, field


@dataclass
class Scenario:
    question: str
    expected_tools: list[str] = field(default_factory=list)
    expected_resources: list[str] = field(default_factory=list)
    description: str = ""


TOOL_SELECTION_SCENARIOS: list[Scenario] = [
    Scenario(
        question="How do I find all expired certificates?",
        expected_tools=["search_certificates", "validate_hcql"],
        expected_resources=["query-languages"],
        description="Certificate search with HCQL",
    ),
    Scenario(
        question="Show me an example of enrolling a certificate through WebRA",
        expected_tools=["get_request_template", "submit_request"],
        expected_resources=["workflows", "profiles"],
        description="WebRA enrollment workflow",
    ),
    Scenario(
        question="Create a dashboard showing certificate expiry by month",
        expected_tools=["create_dashboard", "add_dashboard_chart"],
        expected_resources=["dashboards"],
        description="Dashboard creation",
    ),
    Scenario(
        question="Set up a discovery campaign to scan my network",
        expected_tools=["create_discovery_campaign"],
        expected_resources=["discovery"],
        description="Discovery campaign creation",
    ),
    Scenario(
        question="Who am I and what permissions do I have?",
        expected_tools=["whoami"],
        expected_resources=["rbac"],
        description="Identity check",
    ),
    Scenario(
        question="Translate 'expiring in 30 days' to HCQL",
        expected_tools=["translate_to_hql"],
        expected_resources=["query-languages"],
        description="HQL translation",
    ),
    Scenario(
        question="How do ACME profiles work in Horizon?",
        expected_tools=[],  # Knowledge question, no tools needed
        expected_resources=["profiles", "integrations"],
        description="Knowledge-only question",
    ),
    Scenario(
        question="What's the difference between HCQL and HRQL?",
        expected_tools=[],  # Knowledge question
        expected_resources=["query-languages"],
        description="Query language comparison",
    ),
    # --- Computation rule scenarios ---
    Scenario(
        question="Write a computation rule that uppercases the CN from the CSR",
        expected_tools=["simulate_computation_rule"],
        expected_resources=["computation-and-data-flow"],
        description="Simple computation rule: uppercase CN",
    ),
    Scenario(
        question=(
            "Build a template string that extracts the domain from an email "
            "address found in the certificate subject"
        ),
        expected_tools=["simulate_computation_rule"],
        expected_resources=["computation-and-data-flow"],
        description="Template string: extract email domain",
    ),
    Scenario(
        question="What dictionary entries are available during WebRA enrollment?",
        expected_tools=[],  # Knowledge question
        expected_resources=["computation-and-data-flow"],
        description="Knowledge: WebRA dictionary entries",
    ),
    Scenario(
        question=(
            "Write a computation rule that ensures the CSR's CN is always present "
            "as a DNS SAN. If the CN is already in the DNS SANs from the CSR, don't "
            "duplicate it. But if the CSR does not contain the CN as a DNS SAN, add it."
        ),
        expected_tools=["simulate_computation_rule"],
        expected_resources=["computation-and-data-flow"],
        description="Complex computation: CN in DNS SANs without duplication",
    ),
    Scenario(
        question=(
            "Write a computation rule that always adds the parent domain as a DNS SAN. "
            "For example, if my FQDN is machine.domain.local, the rule should add an "
            "extra DNS SAN containing 'domain.local' to ensure compatibility for LDAPS "
            "connectivity to domain controllers."
        ),
        expected_tools=["simulate_computation_rule"],
        expected_resources=["computation-and-data-flow"],
        description="Complex computation: add parent domain as DNS SAN for LDAPS",
    ),
]
