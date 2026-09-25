import type { AgentProfile, InteractionMode } from "../models/types.ts";

export interface SpecialistPolicy {
  profile: AgentProfile;
  maxAgents: number;
  maxParallelBranches: number;
  focus: "general" | "exploration" | "bugs" | "review" | "implementation";
}

const POLICY_BY_PROFILE: Record<string, Omit<SpecialistPolicy, "profile">> = {
  ask: { maxAgents: 1, maxParallelBranches: 1, focus: "general" },
  coordinator: { maxAgents: 5, maxParallelBranches: 4, focus: "general" },
  explorer: { maxAgents: 3, maxParallelBranches: 3, focus: "exploration" },
  bug: { maxAgents: 3, maxParallelBranches: 2, focus: "bugs" },
  review: { maxAgents: 2, maxParallelBranches: 2, focus: "review" },
  implementer: { maxAgents: 2, maxParallelBranches: 1, focus: "implementation" }
};

export class SpecialistPolicyResolver {
  resolve(profile: AgentProfile, mode: InteractionMode, requestedCount: number): SpecialistPolicy {
    const configured = POLICY_BY_PROFILE[profile] ?? POLICY_BY_PROFILE.coordinator;
    const maxAgents = mode === "ask" ? 1 : configured.maxAgents;
    return {
      profile,
      maxAgents,
      maxParallelBranches: mode === "ask" ? 1 : configured.maxParallelBranches,
      focus: configured.focus
    };
  }

  limitCount(policy: SpecialistPolicy, requestedCount: number): number {
    return Math.max(1, Math.min(Math.max(1, requestedCount), policy.maxAgents));
  }
}