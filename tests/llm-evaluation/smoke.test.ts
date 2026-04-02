/**
 * Tier 3 - Claude Code smoke tests.
 *
 * Quick sanity checks that Claude Code can discover and use Horizon MCP tools.
 * Skipped when ANTHROPIC_API_KEY or HORIZON_E2E_* env vars are not set.
 */

import { afterAll, describe, expect, it } from "vitest";
import {
  askClaude,
  cleanupMcpConfig,
  LLM_EVAL_READY,
  skipReason,
} from "./setup.js";

describe.skipIf(!LLM_EVAL_READY)(`Smoke tests (${skipReason() || "enabled"})`, () => {
  afterAll(() => cleanupMcpConfig());

  it("lists available certificate tools", async () => {
    const result = await askClaude(
      "What tools are available for certificate management?",
      { timeout: 60_000 },
    );

    expect(result.exitCode).toBe(0);
    expect(result.text).toContain("certificate");
  }, 90_000);

  it("understands HCQL when asked about expired certs", async () => {
    const result = await askClaude(
      "How do I query for expired certificates using HCQL?",
      { timeout: 60_000 },
    );

    expect(result.exitCode).toBe(0);
    const mentionsHcqlConcepts = ["status", "expired", "valid.until", "hcql"].some(
      (kw) => result.text.includes(kw),
    );
    expect(mentionsHcqlConcepts).toBe(true);
  }, 90_000);
});
