/**
 * HEQL (Horizon Event Query Language) condition extractor.
 */
import { extractDateConditions, extractFieldValues } from './shared.js';
import { type Condition, condition } from './types.js';

export function extractHeql(text: string): Condition[] {
  const conditions: Condition[] = [];
  const lower = text.toLowerCase();

  // --- Module filter (protocol / subsystem) ---
  const moduleMap: [string, string, string][] = [
    ['\\bacme\\b', 'ACME', 'ACME'],
    ['\\bscep\\b', 'SCEP', 'SCEP'],
    ['\\best\\b', 'EST', 'EST'],
    ['\\bwcce\\b', 'WCCE', 'WCCE'],
    ['\\bcrmp\\b', 'CRMP', 'CRMP'],
    ['\\bwebra\\b', 'WEBRA', 'WebRA'],
    ['\\bintune\\b', 'INTUNE', 'Intune'],
    ['\\bjamf\\b', 'JAMF', 'Jamf'],
  ];

  let moduleFound = false;
  for (const [pat, moduleVal, label] of moduleMap) {
    if (new RegExp(pat).test(lower)) {
      conditions.push(
        condition(`module equals "${moduleVal}"`, `${label} events`),
      );
      moduleFound = true;
      break;
    }
  }

  // --- Event code filter (only when no module detected) ---
  if (!moduleFound) {
    const codeMap: [string, string, string][] = [
      // --- Lifecycle events ---
      ['\\benroll', 'LIFECYCLE-ENROLL', 'enrollment'],
      ['\\brevok|revocation', 'LIFECYCLE-REVOKE', 'revocation'],
      ['\\brenew', 'LIFECYCLE-RENEW', 'renewal'],
      ['\\bupdat', 'LIFECYCLE-UPDATE', 'update'],
      ['\\brecover', 'LIFECYCLE-RECOVER', 'recovery'],
      ['\\bmigrat', 'LIFECYCLE-MIGRATE', 'migration'],
      ['\\bimport', 'LIFECYCLE-IMPORT', 'import'],
      ['\\bescrow', 'LIFECYCLE-ESCROW', 'key escrow'],
      // --- Request events ---
      [
        '\\brequest.*submit|submit.*request',
        'REQUEST-SUBMIT',
        'request submission',
      ],
      [
        '\\brequest.*approv|approv.*request',
        'REQUEST-APPROVE',
        'request approval',
      ],
      [
        '\\brequest.*deny|deny.*request|denied',
        'REQUEST-DENY',
        'request denial',
      ],
      [
        '\\brequest.*cancel|cancel.*request',
        'REQUEST-CANCEL',
        'request cancellation',
      ],
      // --- Security events ---
      ['\\bauthenticat', 'SEC-AUTHENTICATION', 'authentication'],
      ['\\brole', 'SEC-ROLE', 'role management'],
      ['\\bteam', 'SEC-TEAM', 'team management'],
      // --- Trigger events ---
      ['\\btrigger.*email|email.*trigger', 'TRIGGER-EMAIL', 'email trigger'],
      ['\\btrigger.*push|push.*trigger', 'TRIGGER-PUSH', 'certificate push'],
      ['\\btrigger', 'TRIGGER', 'trigger'],
      // --- Config events ---
      ['\\bconfig.*add|config.*creat', 'CONF-ADD', 'configuration addition'],
      [
        '\\bconfig.*delet|config.*remov',
        'CONF-DELETE',
        'configuration deletion',
      ],
      ['\\bconfig.*updat|config.*modif', 'CONF-UPDATE', 'configuration update'],
      // --- Infrastructure events ---
      ['\\bservice.*start|start.*service', 'SERVICE-START', 'service start'],
      ['\\bservice.*stop|stop.*service', 'SERVICE-STOP', 'service stop'],
      ['\\blicen', 'LICENSE', 'license'],
      ['\\bgrad', 'GRADING', 'grading'],
      ['\\barchiv', 'ARCHIVE', 'archive'],
      ['\\bsync', 'SYNC', 'synchronization'],
      ['\\bdiscovery', 'DISCOVERY', 'discovery'],
      ['\\bbootstrap', 'BOOTSTRAP', 'bootstrap'],
    ];

    for (const [pat, code, label] of codeMap) {
      if (new RegExp(pat).test(lower)) {
        if (code.includes('-')) {
          conditions.push(
            condition(`code equals "${code}"`, `${label} events`),
          );
        } else {
          conditions.push(
            condition(`code contains "${code}"`, `${label} events`),
          );
        }
        break;
      }
    }
  }

  // --- HEQL detail.* fields ---
  // Certificate references -> detail.certificateDn
  // Use a single bounded character class instead of `[\w][\w.*-]*(?:\.[\w.*-]+)*`
  // to avoid the nested-quantifier shape that allows catastrophic backtracking
  // when adjacent dots overlap the outer and inner groups. Combined with the
  // MAX_TRANSLATE_INPUT_BYTES cap this bounds worst-case regex work.
  const certPattern =
    /(?:certificate|cert)\s+(?:named?\s+|called\s+|for\s+)?["']?([\w][\w.*-]{0,127})["']?/;
  let m = lower.match(certPattern);
  if (m) {
    // Preserve original case from the input text
    const origM = text.match(new RegExp(certPattern.source, 'i'));
    const val = origM ? origM[1]! : m[1]!;
    conditions.push(
      condition(
        `detail.certificateDn contains "${val}"`,
        `certificate matching '${val}'`,
      ),
    );
  }

  // Actor/user references -> detail.actorId
  m = text.match(
    new RegExp('(?:actor|user|by)\\s+(?:is\\s+)?["\']?([\\w@._-]+)["\']?', 'i'),
  );
  if (m) {
    const val = m[1]!.replace(/^['"]|['"]$/g, '');
    if (!['is', 'the', 'a', 'an', 'all'].includes(val)) {
      conditions.push(
        condition(`detail.actorId equals "${val}"`, `actor '${val}'`),
      );
    }
  }

  extractDateConditions(lower, conditions, 'heql');
  extractFieldValues(text, conditions, 'heql');
  return conditions;
}
