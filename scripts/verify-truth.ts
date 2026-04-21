import { relative, resolve } from 'node:path';

import {
  collectHorizonOperations,
  collectMcpPathReferences,
  collectOpenApiOperations,
  resolveTruthInputs,
  verifyMcpRouteTruth,
  writeTruthArtifacts,
} from './lib/truth.js';

function formatReferenceIssue(issue: {
  path: string;
  details: string;
  file?: string;
  line?: number;
  method?: string;
}): string {
  const location =
    issue.file && issue.line ? ` (${issue.file}:${issue.line})` : '';
  const method = issue.method ? `${issue.method} ` : '';
  return `- ${method}${issue.path}${location}: ${issue.details}`;
}

function hasFlag(flag: string): boolean {
  return process.argv.slice(2).includes(flag);
}

async function main(): Promise<void> {
  const projectRoot = resolve(import.meta.dirname, '..');
  const inputs = resolveTruthInputs(projectRoot);
  const writeArtifacts = hasFlag('--write');

  const horizonOperations = collectHorizonOperations(
    inputs.horizonRoot,
    projectRoot,
  );
  const openApiOperations = collectOpenApiOperations(
    inputs.openApiPath,
    projectRoot,
  );
  const references = collectMcpPathReferences(projectRoot);
  const verification = verifyMcpRouteTruth({
    horizonOperations,
    openApiOperations,
    references,
  });

  if (writeArtifacts) {
    writeTruthArtifacts({
      outputDir: inputs.outputDir,
      horizonRoot: relative(projectRoot, inputs.horizonRoot),
      openApiPath: relative(projectRoot, inputs.openApiPath),
      references,
      horizonOperations,
      openApiOperations,
    });
  }

  console.log(
    `Truth inputs: horizon=${relative(projectRoot, inputs.horizonRoot)} openapi=${relative(projectRoot, inputs.openApiPath)}`,
  );
  console.log(
    `Verified MCP API references: ${verification.verifiedCount}/${verification.referencedCount}`,
  );
  console.log(
    `Source-only allowlisted references: ${verification.sourceOnlyCount}`,
  );
  console.log(`Issues: ${verification.issues.length}`);

  if (verification.issues.length > 0) {
    console.error('\nRoute truth verification failed:\n');
    for (const issue of verification.issues) {
      console.error(formatReferenceIssue(issue));
    }
    process.exitCode = 1;
    return;
  }

  console.log('Route truth verification passed.');
}

await main();
