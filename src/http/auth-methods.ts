/** Authentication methods accepted from streamable-HTTP callers. */
export enum HttpAuthMethod {
  ApiKey = 0b001,
  Mtls = 0b010,
  Service = 0b100,
}

export type HttpAuthMethodMask = number;

export const ALL_HTTP_AUTH_METHODS: HttpAuthMethodMask =
  HttpAuthMethod.ApiKey | HttpAuthMethod.Mtls | HttpAuthMethod.Service;

const METHOD_BY_NAME = {
  'api-key': HttpAuthMethod.ApiKey,
  mtls: HttpAuthMethod.Mtls,
  service: HttpAuthMethod.Service,
} as const;

const NAME_BY_METHOD: ReadonlyArray<readonly [HttpAuthMethod, string]> = [
  [HttpAuthMethod.ApiKey, 'api-key'],
  [HttpAuthMethod.Mtls, 'mtls'],
  [HttpAuthMethod.Service, 'service'],
];

export function hasAuthMethod(
  mask: HttpAuthMethodMask,
  method: HttpAuthMethod,
): boolean {
  return (mask & method) !== 0;
}

export function assertValidAuthMethodMask(
  mask: HttpAuthMethodMask,
): HttpAuthMethodMask {
  if (
    !Number.isInteger(mask) ||
    mask === 0 ||
    (mask & ~ALL_HTTP_AUTH_METHODS) !== 0
  ) {
    throw new Error(`invalid HTTP authentication method mask: ${mask}`);
  }
  return mask;
}

/** Parse a comma- or pipe-separated method whitelist into a validated mask. */
export function parseHttpAuthMethods(value: string): HttpAuthMethodMask {
  const rawNames = value.split(/[|,]/).map((part) => part.trim().toLowerCase());
  if (rawNames.length === 0 || rawNames.some((name) => name.length === 0)) {
    throw new Error('HTTP authentication method list must not be empty');
  }

  const seen = new Set<string>();
  let mask = 0;
  for (const name of rawNames) {
    const method = METHOD_BY_NAME[name as keyof typeof METHOD_BY_NAME];
    if (method === undefined) {
      throw new Error(
        `unknown HTTP authentication method "${name}"; expected api-key, mtls, or service`,
      );
    }
    if (seen.has(name)) {
      throw new Error(`duplicate HTTP authentication method "${name}"`);
    }
    seen.add(name);
    mask |= method;
  }
  return assertValidAuthMethodMask(mask);
}

export function formatHttpAuthMethods(mask: HttpAuthMethodMask): string {
  assertValidAuthMethodMask(mask);
  return NAME_BY_METHOD.filter(([method]) => hasAuthMethod(mask, method))
    .map(([, name]) => name)
    .join(',');
}
