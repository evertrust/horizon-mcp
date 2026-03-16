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
        question="What CAs are available in my Horizon instance?",
        expected_tools=["list_cas"],
        description="Simple CA listing",
    ),
    Scenario(
        question="Set up a discovery campaign to scan my network",
        expected_tools=["create_discovery_campaign"],
        expected_resources=["discovery"],
        description="Discovery campaign creation",
    ),
    Scenario(
        question="Who am I and what permissions do I have?",
        expected_tools=["whoami", "list_roles"],
        expected_resources=["rbac"],
        description="Identity and permissions",
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
        question="Create a monitored profile to track external certs",
        expected_tools=["create_monitored_profile"],
        expected_resources=["profiles"],
        description="Monitored profile creation",
    ),
    Scenario(
        question="What's the difference between HCQL and HRQL?",
        expected_tools=[],  # Knowledge question
        expected_resources=["query-languages"],
        description="Query language comparison",
    ),
]
