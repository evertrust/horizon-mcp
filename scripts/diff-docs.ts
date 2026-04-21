#!/usr/bin/env bun
import { diffDocsArtifacts } from './lib/docs.ts';

const diffs = await diffDocsArtifacts();

if (diffs.length > 0) {
  console.error('Documentation artifacts are out of date:');
  for (const diff of diffs) {
    console.error(`- ${diff}`);
  }
  process.exit(1);
}

console.log('Documentation artifacts are up to date.');
