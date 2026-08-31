export interface ProviderPolicy {
  /** When false (default), models whose id contains "contributor" are refused. */
  allowTrainingTiers: boolean;
  /** If set, only these provider ids may be constructed (company allowlist). */
  allowedProviders?: string[] | null;
}

const DEFAULT_POLICY: ProviderPolicy = { allowTrainingTiers: false, allowedProviders: null };

let policy: ProviderPolicy = { ...DEFAULT_POLICY };

export function getPolicy(): ProviderPolicy {
  return policy;
}

export function setPolicy(next: Partial<ProviderPolicy>): void {
  policy = {
    allowTrainingTiers: next.allowTrainingTiers ?? policy.allowTrainingTiers,
    allowedProviders: next.allowedProviders === undefined ? policy.allowedProviders : next.allowedProviders,
  };
}

export function resetPolicy(): void {
  policy = { ...DEFAULT_POLICY };
}

export function isTrainingTier(model: string): boolean {
  return /contributor/i.test(model);
}

/** Throw if this provider/model is banned by the current policy. */
export function assertAllowedModel(provider: string, model: string): void {
  const allow = policy.allowedProviders;
  if (allow && allow.length > 0 && !allow.includes(provider)) {
    throw new Error(
      `provider "${provider}" is not on the company allowlist (${allow.join(", ")})`,
    );
  }
  if (isTrainingTier(model) && !policy.allowTrainingTiers) {
    throw new Error(
      `refused model '${model}': contributor / training-tier models send prompts for training. ` +
        `Set allowTrainingTiers: true (and type TRAIN in the TUI) to opt in.`,
    );
  }
}
