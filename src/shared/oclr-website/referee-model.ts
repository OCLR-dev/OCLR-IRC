// Vendored from OCLR-website PR #409, commit 1abbab1ddd981025249af727d748e70e23b9096b (MIT).
import { z } from "zod";
import type { ScoringRules } from "./competition-model.ts";
import {
  refereeCommandPolicySchema,
  type RefereeSettings,
} from "./referee-commands.ts";

export const refereeStepSchema = z
  .object({
    kind: z.enum(["ban", "pick", "tb"]),
    actor: z.enum([
      "firstBan",
      "secondBan",
      "firstPick",
      "secondPick",
      "neutral",
    ]),
    categories: z.array(z.string().trim().min(1).max(30)).max(30),
    entryIds: z.array(z.uuid()).max(200),
    avoidRepeatCategory: z.boolean(),
    tiedAt: z.number().int().min(0).max(98).nullable(),
  })
  .strict()
  .refine(
    (s) => (s.kind === "tb" ? s.tiedAt !== null : s.tiedAt === null),
    "Only a tiebreaker has a tied-score condition.",
  );
export const refereePolicySchema = z
  .object({
    steps: z.array(refereeStepSchema).min(1).max(200),
    commands: refereeCommandPolicySchema.nullable(),
    maxReplaysPerMap: z.number().int().min(0).max(20).optional(),
  })
  .strict()
  .superRefine((p, ctx) => {
    p.steps.forEach((s, i) => {
      if (s.kind === "tb" && !s.categories.length && !s.entryIds.length)
        ctx.addIssue({
          code: "custom",
          path: ["steps", i],
          message: "Identify reserved tiebreaker categories or entries.",
        });
      if (s.kind === "tb" && i !== p.steps.length - 1)
        ctx.addIssue({
          code: "custom",
          path: ["steps", i],
          message: "A tiebreaker must be the final step.",
        });
      if (s.kind === "ban" && !["firstBan", "secondBan"].includes(s.actor))
        ctx.addIssue({
          code: "custom",
          path: ["steps", i, "actor"],
          message: "A ban uses the independent ban order.",
        });
      if (s.kind !== "ban" && ["firstBan", "secondBan"].includes(s.actor))
        ctx.addIssue({
          code: "custom",
          path: ["steps", i, "actor"],
          message: "A pick uses the independent pick order.",
        });
      if (s.kind === "pick" && s.actor === "neutral")
        ctx.addIssue({
          code: "custom",
          path: ["steps", i, "actor"],
          message: "Only a tiebreaker can be neutral.",
        });
    });
  });
export type RefereePolicy = z.infer<typeof refereePolicySchema>;
export type RefereeOrders = {
  firstBanTeamId: string | null;
  firstPickTeamId: string | null;
};
export type RefereeMap = {
  id: string;
  beatmapId: number;
  category: string;
  position: number;
};
export type RefereeAttempt = {
  id: string;
  number: number;
  status: "pending" | "playing" | "completed" | "tied" | "aborted";
  winnerTeamId: string | null;
};
export type RefereeSelection = {
  id: string;
  stepIndex: number;
  kind: "ban" | "pick" | "tb";
  teamId: string | null;
  entryId: string;
  beatmapId: number;
  category: string;
  attempts: RefereeAttempt[];
  voided: boolean;
};
export type RefereeEventPayload =
  | { type: "order_set"; firstBanTeamId: string; firstPickTeamId: string }
  | {
      type: "selection_recorded";
      stepIndex: number;
      kind: "ban" | "pick" | "tb";
      teamId: string | null;
      entryId: string;
      beatmapId: number;
      category: string;
    }
  | { type: "attempt_started"; pickId: string; attemptId: string }
  | {
      type: "attempt_resolved";
      pickId: string;
      attemptId: string;
      status: "completed" | "tied" | "aborted";
      winnerTeamId: string | null;
    }
  | { type: "attempt_replayed"; pickId: string }
  | { type: "selection_voided"; selectionId: string }
  | { type: "settings_saved"; settings: RefereeSettings }
  | { type: "dependencies_reconfirmed" }
  | { type: "policy_configured"; policy: RefereePolicy; revision: number };
export type RefereeEvent = {
  id: string;
  ordinal: number;
  actorId: number;
  createdAt: string;
  payload: RefereeEventPayload;
};
export type RefereeModelInput = {
  policy: RefereePolicy | null;
  orders: RefereeOrders;
  events: RefereeEvent[];
  teamIds: string[];
  maps: RefereeMap[];
  series: ScoringRules["series"] | null;
  tiedMapPolicy?: ScoringRules["tiedMapPolicy"];
};
export type RefereeProjection = {
  selections: RefereeSelection[];
  activeSelections: RefereeSelection[];
  score: Record<string, number>;
  nextStep:
    | (RefereePolicy["steps"][number] & {
        index: number;
        teamId: string | null;
      })
    | null;
  complete: boolean;
  issues: string[];
  lastSelectionId: string | null;
};
export function resolveRefereeActor(
  actor: RefereePolicy["steps"][number]["actor"],
  orders: RefereeOrders,
  teamIds: string[],
) {
  if (actor === "neutral") return null;
  const first = actor.endsWith("Ban")
    ? orders.firstBanTeamId
    : orders.firstPickTeamId;
  if (!first || !teamIds.includes(first)) return null;
  return actor.startsWith("first")
    ? first
    : (teamIds.find((id) => id !== first) ?? null);
}
export function refereeOrderConflicts(
  input: RefereeModelInput,
  orders: RefereeOrders,
) {
  return projectReferee(input)
    .activeSelections.filter((s) => {
      const step = input.policy?.steps[s.stepIndex];
      return (
        step &&
        resolveRefereeActor(step.actor, orders, input.teamIds) !== s.teamId
      );
    })
    .map((s) => s.stepIndex + 1);
}
export function projectReferee(input: RefereeModelInput): RefereeProjection {
  const selections: RefereeSelection[] = [];
  for (const event of input.events) {
    const p = event.payload;
    if (p.type === "selection_recorded")
      selections.push({
        id: event.id,
        stepIndex: p.stepIndex,
        kind: p.kind,
        teamId: p.teamId,
        entryId: p.entryId,
        beatmapId: p.beatmapId,
        category: p.category,
        voided: false,
        attempts:
          p.kind === "ban"
            ? []
            : [
                {
                  id: event.id,
                  number: 1,
                  status: "pending",
                  winnerTeamId: null,
                },
              ],
      });
    else if (p.type === "selection_voided") {
      const s = selections.find((s) => s.id === p.selectionId);
      if (s) s.voided = true;
    } else if (p.type === "attempt_replayed") {
      const s = selections.find((s) => s.id === p.pickId);
      if (s)
        s.attempts.push({
          id: event.id,
          number: s.attempts.length + 1,
          status: "pending",
          winnerTeamId: null,
        });
    } else if (p.type === "attempt_started" || p.type === "attempt_resolved") {
      const a = selections
        .find((s) => s.id === p.pickId)
        ?.attempts.find((a) => a.id === p.attemptId);
      if (a) {
        a.status = p.type === "attempt_started" ? "playing" : p.status;
        a.winnerTeamId = p.type === "attempt_resolved" ? p.winnerTeamId : null;
      }
    }
  }
  const activeSelections = selections.filter((s) => !s.voided);
  const score: Record<string, number> = Object.fromEntries(
    input.teamIds.map((id) => [id, 0]),
  );
  let completed = 0;
  for (const s of activeSelections) {
    const a = s.attempts.at(-1);
    if (
      a?.status === "completed" &&
      a.winnerTeamId &&
      input.teamIds.includes(a.winnerTeamId)
    ) {
      score[a.winnerTeamId]++;
      completed++;
    } else if (
      a?.status === "tied" &&
      input.tiedMapPolicy === "count_as_draw"
    ) {
      completed++;
    }
  }
  const series = input.series;
  const complete =
    series?.type === "first_to"
      ? Object.values(score).some((v) => v >= series.wins)
      : series?.type === "fixed_maps"
        ? completed >= series.count
        : false;
  const issues: string[] = [];
  if (input.teamIds.length !== 2 || new Set(input.teamIds).size !== 2)
    issues.push("Both fixture teams must be resolved.");
  if (!input.policy)
    issues.push("The round referee policy has not been configured.");
  if (!input.series)
    issues.push("The round scoring rules have not been configured.");
  if (!input.orders.firstBanTeamId || !input.orders.firstPickTeamId)
    issues.push("Apply both the first-ban and first-pick teams.");
  const step = input.policy?.steps[activeSelections.length];
  const unresolved = activeSelections.some(
    (s) =>
      s.kind !== "ban" &&
      s.attempts.at(-1)?.status !== "completed" &&
      !(
        s.attempts.at(-1)?.status === "tied" &&
        input.tiedMapPolicy === "count_as_draw"
      ),
  );
  if (unresolved)
    issues.push(
      "Resolve the current map or record a replay before continuing.",
    );
  if (
    step?.kind === "tb" &&
    input.teamIds.some((id) => score[id] !== step.tiedAt)
  )
    issues.push("The configured tiebreak score has not been reached.");
  if (
    input.policy &&
    series?.type === "first_to" &&
    input.policy.steps.some(
      (s) => s.kind === "tb" && s.tiedAt !== series.wins - 1,
    )
  )
    issues.push(
      "The tiebreak condition is incompatible with the round series.",
    );
  return {
    selections,
    activeSelections,
    score,
    complete,
    issues,
    nextStep:
      !complete && step
        ? {
            ...step,
            index: activeSelections.length,
            teamId: resolveRefereeActor(
              step.actor,
              input.orders,
              input.teamIds,
            ),
          }
        : null,
    lastSelectionId: activeSelections.at(-1)?.id ?? null,
  };
}
export const refereeActionSchema = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("set_order"),
      firstBanTeamId: z.uuid(),
      firstPickTeamId: z.uuid(),
    })
    .strict(),
  z
    .object({ action: z.literal("record_selection"), entryId: z.uuid() })
    .strict(),
  z.object({ action: z.literal("start_attempt"), pickId: z.uuid() }).strict(),
  z
    .object({
      action: z.literal("resolve_attempt"),
      pickId: z.uuid(),
      status: z.enum(["completed", "tied", "aborted"]),
      winnerTeamId: z.uuid().nullable(),
    })
    .strict(),
  z.object({ action: z.literal("replay_attempt"), pickId: z.uuid() }).strict(),
  z.object({ action: z.literal("void_last") }).strict(),
]);
export type RefereeAction = z.infer<typeof refereeActionSchema>;
export function validateRefereeAction(
  input: RefereeModelInput,
  action: RefereeAction,
): RefereeEventPayload {
  const state = projectReferee(input);
  const fail = (message: string): never => {
    throw new Error(message);
  };
  if (action.action === "set_order") {
    if (
      !input.teamIds.includes(action.firstBanTeamId) ||
      !input.teamIds.includes(action.firstPickTeamId)
    )
      fail("Choose the two teams from this fixture.");
    const conflicts = refereeOrderConflicts(input, action);
    if (conflicts.length)
      fail(
        `Withdraw conflicting steps in reverse order before changing the order: ${conflicts.join(", ")}.`,
      );
    return {
      type: "order_set",
      firstBanTeamId: action.firstBanTeamId,
      firstPickTeamId: action.firstPickTeamId,
    };
  }
  if (action.action === "void_last") {
    if (!state.lastSelectionId) fail("There is no active step to withdraw.");
    return { type: "selection_voided", selectionId: state.lastSelectionId! };
  }
  if (action.action === "record_selection") {
    if (state.issues.length) fail(state.issues[0]);
    if (state.complete) fail("The temporary series is complete.");
    const step = state.nextStep;
    if (!step) fail("There are no further configured steps.");
    const map = input.maps.find((m) => m.id === action.entryId);
    if (!map) fail("Choose an entry from the current round pool.");
    if (state.activeSelections.some((s) => s.entryId === map!.id))
      fail("This map has already been banned or picked.");
    const reserved = input.policy?.steps
      .filter((s) => s.kind === "tb")
      .some(
        (s) =>
          (!s.categories.length || s.categories.includes(map!.category)) &&
          (!s.entryIds.length || s.entryIds.includes(map!.id)),
      );
    if (step!.kind !== "tb" && reserved)
      fail("Tiebreaker maps are reserved for their configured step.");
    if (step!.categories.length && !step!.categories.includes(map!.category))
      fail("This map category is not permitted for the current step.");
    if (step!.entryIds.length && !step!.entryIds.includes(map!.id))
      fail("This map is not permitted for the current step.");
    if (
      step!.avoidRepeatCategory &&
      state.activeSelections.some(
        (s) =>
          s.kind !== "ban" &&
          s.teamId === step!.teamId &&
          s.category === map!.category,
      )
    )
      fail("This team has already picked this category.");
    return {
      type: "selection_recorded",
      stepIndex: step!.index,
      kind: step!.kind,
      teamId: step!.teamId,
      entryId: map!.id,
      beatmapId: map!.beatmapId,
      category: map!.category,
    };
  }
  const selection = state.activeSelections.find((s) => s.id === action.pickId);
  if (!selection || selection.kind === "ban") fail("Choose an active pick.");
  if (selection!.id !== state.lastSelectionId)
    fail("Withdraw later steps before correcting this pick.");
  const attempt = selection!.attempts.at(-1)!;
  if (action.action === "start_attempt") {
    if (attempt.status !== "pending")
      fail("Only a pending attempt can be marked as started.");
    return {
      type: "attempt_started",
      pickId: selection!.id,
      attemptId: attempt.id,
    };
  }
  if (action.action === "replay_attempt") {
    if (
      input.policy?.maxReplaysPerMap !== undefined &&
      selection!.attempts.length - 1 >= input.policy.maxReplaysPerMap
    )
      fail("The replay limit for this map has been reached.");
    if (["pending", "playing"].includes(attempt.status))
      fail("Record the current outcome before creating a replay.");
    return { type: "attempt_replayed", pickId: selection!.id };
  }
  if (
    action.status === "completed" &&
    !input.teamIds.includes(action.winnerTeamId ?? "")
  )
    fail("Choose the winning team for a completed attempt.");
  if (action.status !== "completed" && action.winnerTeamId !== null)
    fail("A tied or aborted attempt has no winner.");
  return {
    type: "attempt_resolved",
    pickId: selection!.id,
    attemptId: attempt.id,
    status: action.status,
    winnerTeamId: action.winnerTeamId,
  };
}
