#!/usr/bin/env bun
import { writeDocsArtifacts } from './lib/docs.ts';

await writeDocsArtifacts();
console.log('Documentation artifacts refreshed.');
