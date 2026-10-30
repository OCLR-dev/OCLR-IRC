import type { MapPlanState, PlanStepState } from '../shared/map-profile.ts'
interface Driver {
  ready(index: number): 'ready' | 'wait' | 'invalid'
  send(index: number): void
  observe(index: number): 'match' | 'wait' | 'invalid'
  changed(state: MapPlanState): void
  finished(state: MapPlanState): void
}
/** Bounded, non-replaying steps. Observed effects never claim causal exactly-once execution. */
export class OperationPlan {
  private value: MapPlanState
  private driver: Driver
  private index = 0
  private timer: ReturnType<typeof setTimeout> | null = null
  private deadline = 0
  private stepMs: number
  constructor(value: MapPlanState, driver: Driver, stepMs = 15000) { this.value = structuredClone(value); this.driver = driver; this.stepMs = stepMs }
  get state() { return structuredClone(this.value) }
  get active() { return ['queued', 'sending', 'awaiting'].includes(this.value.state) }
  start() { if (this.deadline) throw new Error('Plan already started'); this.deadline = performance.now() + this.stepMs; this.tick() }
  cancel() { if (this.active) this.stop(this.value.steps[this.index].state === 'awaiting' || this.value.steps[this.index].state === 'sending' ? 'unknown' : 'cancelled') }
  private stop(state: PlanStepState) {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    if (this.value.steps[this.index] && this.value.steps[this.index].state !== 'observed') this.value.steps[this.index].state = state
    for (const step of this.value.steps) if (step.state === 'queued') step.state = 'cancelled'
    this.value.state = state; this.driver.changed(this.state); this.driver.finished(this.state)
  }
  private tick() {
    if (!this.active) return
    const step = this.value.steps[this.index]
    if (performance.now() >= this.deadline) { this.stop(step.state === 'awaiting' ? 'unknown' : 'failed'); return }
    try {
      if (step.state === 'queued') {
        const ready = this.driver.ready(this.index)
        if (ready === 'invalid') { this.stop('failed'); return }
        if (ready === 'ready') {
          step.state = this.value.state = 'sending'; this.driver.changed(this.state)
          if (!this.active) return
          // Any throw after dispatch begins is ambiguous and never retried.
          try { this.driver.send(this.index) } catch { this.stop('unknown'); return }
          if (!this.active) return
          step.state = this.value.state = 'awaiting'; this.driver.changed(this.state)
        }
      } else if (step.state === 'awaiting') {
        const observation = this.driver.observe(this.index)
        if (observation === 'invalid') { this.stop('unknown'); return }
        if (observation === 'match') {
          step.state = 'observed'
          if (++this.index === this.value.steps.length) { this.value.state = 'observed'; this.driver.changed(this.state); this.driver.finished(this.state); return }
          this.value.state = 'queued'; this.deadline = performance.now() + this.stepMs; this.driver.changed(this.state)
        }
      }
    } catch { this.stop(step.state === 'awaiting' ? 'unknown' : 'failed'); return }
    this.timer = setTimeout(() => this.tick(), 40); this.timer.unref()
  }
}
