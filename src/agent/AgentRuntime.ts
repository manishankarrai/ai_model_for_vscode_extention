import { ContextManager, type ContextManagerOptions, type ContextManagerResult } from "../intelligence/ContextManager.ts";
import { InvestigationState, type InvestigationLimits } from "../intelligence/InvestigationState.ts";
import type { AIContext, TaskMemory } from "../models/types.ts";
import { ToolScheduler } from "./ToolScheduler.ts";
import { VerificationManager, type VerificationOutcome, type VerificationResult } from "./VerificationManager.ts";
import { Planner } from "./Planner.ts";
import { ChangeImpactAnalyzer, type ChangeImpactReport } from "./ChangeImpactAnalyzer.ts";
import type { Intent } from "../models/types.ts";
import type { Relationship } from "../project/RepositoryRetrieval.ts";
import { InvestigationBranchPlanner } from "./InvestigationBranchPlanner.ts";
import { SpecialistPolicyResolver, type SpecialistPolicy } from "./SpecialistPolicy.ts";
import type { RetrievalPlan } from "../intelligence/progressiveRetrieval.ts";
import type { RetrievalBranch } from "../models/types.ts";
import { RuntimeMetrics, type RuntimeMetricSnapshot } from "../utils/RuntimeMetrics.ts";

export class AgentRuntime {
  private readonly contextManager: ContextManager;
  private readonly toolScheduler: ToolScheduler;
  private readonly verificationManager: VerificationManager;
  private readonly planner: Planner;
  private readonly changeImpactAnalyzer: ChangeImpactAnalyzer;
  private readonly branchPlanner: InvestigationBranchPlanner;
  private readonly specialistPolicyResolver: SpecialistPolicyResolver;
  private readonly metrics: RuntimeMetrics;

  constructor(
    contextManager = new ContextManager(),
    toolScheduler = new ToolScheduler(),
    verificationManager = new VerificationManager(),
    planner = new Planner(),
    changeImpactAnalyzer = new ChangeImpactAnalyzer(),
    branchPlanner = new InvestigationBranchPlanner(),
    specialistPolicyResolver = new SpecialistPolicyResolver(),
    metrics = new RuntimeMetrics()
  ) {
    this.contextManager = contextManager;
    this.toolScheduler = toolScheduler;
    this.verificationManager = verificationManager;
    this.planner = planner;
    this.changeImpactAnalyzer = changeImpactAnalyzer;
    this.branchPlanner = branchPlanner;
    this.specialistPolicyResolver = specialistPolicyResolver;
    this.metrics = metrics;
  }

  createInvestigationState(limits: InvestigationLimits): InvestigationState {
    return new InvestigationState(limits);
  }

  prepareContext(input: AIContext, options: ContextManagerOptions): ContextManagerResult {
    return this.contextManager.manage(input, options);
  }

  invalidatePath(filePath: string): void {
    this.contextManager.invalidatePath(filePath);
  }

  clearContextCache(): void {
    this.contextManager.clear();
  }

  createPlan(requested: Intent, question: string, targetPath?: string) {
    return this.planner.create(requested, question, targetPath);
  }

  formatPlan(plan: ReturnType<Planner["create"]>): string {
    return this.planner.format(plan);
  }

  createBranches(plan: RetrievalPlan): RetrievalBranch[] {
    return this.branchPlanner.create(plan);
  }

  resolveSpecialistPolicy(profile: string, mode: "ask" | "agent", requestedCount: number): SpecialistPolicy {
    const policy = this.specialistPolicyResolver.resolve(profile, mode, requestedCount);
    return {
      ...policy,
      maxAgents: this.specialistPolicyResolver.limitCount(policy, requestedCount)
    };
  }

  analyzeChangeImpact(changedPaths: string[], relationships: Relationship[]): ChangeImpactReport {
    return this.changeImpactAnalyzer.analyze(changedPaths, relationships);
  }

  runToolBatch<T>(
    parallel: Array<() => Promise<T>>,
    ordered: Array<() => Promise<T>>,
    concurrency: number,
    signal?: AbortSignal
  ): Promise<T[]> {
    return this.toolScheduler.run(parallel, ordered, concurrency, signal);
  }

  updateVerificationMemory(
    memory: TaskMemory | undefined,
    outcomes: VerificationOutcome[]
  ): TaskMemory | undefined {
    return this.verificationManager.updateMemory(memory, outcomes);
  }

  evaluateVerification(outcomes: VerificationOutcome[]): VerificationResult {
    return this.verificationManager.evaluate(outcomes);
  }

  async runInvestigationBranches<T>(
    branches: RetrievalBranch[],
    execute: (branch: RetrievalBranch) => Promise<T>,
    concurrency: number,
    signal?: AbortSignal
  ): Promise<T[]> {
    const indexed = branches.map((branch, index) => ({ branch, index }));
    const parallel = indexed.filter(({ branch }) => branch.parallelizable).map(({ branch, index }) => async () => ({
      index,
      value: await execute(branch)
    }));
    const ordered = indexed.filter(({ branch }) => !branch.parallelizable).map(({ branch, index }) => async () => ({
      index,
      value: await execute(branch)
    }));
    const startedAt = Date.now();
    const results = await this.toolScheduler.run(parallel, ordered, concurrency, signal);
    this.metrics.increment("investigation_branches.completed", results.length);
    this.metrics.observe("investigation_branches.duration_ms", Date.now() - startedAt);
    return results.sort((left, right) => left.index - right.index).map((item) => item.value);
  }

  recordMetric(name: string, durationMs?: number): void {
    if (durationMs === undefined) {
      this.metrics.increment(name);
      return;
    }
    this.metrics.observe(name, durationMs);
  }

  setGauge(name: string, value: number): void {
    this.metrics.setGauge(name, value);
  }

  metricsSnapshot(): RuntimeMetricSnapshot {
    return this.metrics.snapshot();
  }
}
