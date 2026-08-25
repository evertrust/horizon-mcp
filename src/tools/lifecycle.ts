/**
 * Lifecycle tools: certificates, requests, events, aggregation (barrel module).
 *
 * 18 MCP tools covering the full Horizon certificate lifecycle:
 *   - Certificate search (2): search_certificates, export_certificates_csv
 *   - Certificate operations (3): get_certificate, download_certificate,
 *     set_certificate_auto_renew
 *   - Request management (8): get_request_template, submit_request,
 *     approve_request, deny_request, cancel_request, search_requests,
 *     get_request, export_requests_csv
 *   - Event audit (3): search_events, get_event, export_events_csv
 *   - Aggregation (2): aggregate_certificates, aggregate_requests
 *
 * Implementation is split per concern under ./lifecycle/.
 */
import type { McpServer } from '@modelcontextprotocol/server';

import type { HorizonClient } from '../client/http.js';
import { registerCertificateTools } from './lifecycle/certificates.js';
import { registerEventTools } from './lifecycle/events.js';
import { registerRequestTools } from './lifecycle/requests.js';

export function registerLifecycleTools(
  server: McpServer,
  client: HorizonClient,
): void {
  registerCertificateTools(server, client);
  registerRequestTools(server, client);
  registerEventTools(server, client);
}
