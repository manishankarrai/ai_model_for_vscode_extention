export interface RuntimeMetricSnapshot {
  counters: Record<string, number>;
  durations: Record<string, number>;
  gauges?: Record<string, number>;
}

export class RuntimeMetrics {
  private readonly counters = new Map<string, number>();
  private readonly durations = new Map<string, number>();
  private readonly gauges = new Map<string, number>();

  increment(name: string, amount = 1): void {
    this.counters.set(name, (this.counters.get(name) ?? 0) + amount);
  }

  observe(name: string, durationMs: number): void {
    this.durations.set(name, (this.durations.get(name) ?? 0) + Math.max(0, durationMs));
  }

  setGauge(name: string, value: number): void {
    this.gauges.set(name, value);
  }

  snapshot(): RuntimeMetricSnapshot {
    return {
      counters: Object.fromEntries(this.counters),
      durations: Object.fromEntries(this.durations),
      gauges: Object.fromEntries(this.gauges)
    };
  }
}