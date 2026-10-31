// Vendored from OCLR-website PR #409, commit 1abbab1ddd981025249af727d748e70e23b9096b (MIT).
import { z } from "zod";
export const scoringRulesSchema = z
  .object({
    version: z.string().trim().min(1).max(80),
    mode: z.enum(["osu", "taiko", "fruits", "mania"]),
    teamType: z.enum(["team-vs", "head-to-head"]),
    scoringType: z.enum(["score", "scorev2"]),
    aggregation: z.enum(["sum", "average"]),
    playersPerTeam: z.number().int().min(1).max(16),
    exPlayersPerTeam: z.number().int().min(1).max(16).nullable().optional(),
    series: z.discriminatedUnion("type", [
      z
        .object({
          type: z.literal("first_to"),
          wins: z.number().int().min(1).max(99),
        })
        .strict(),
      z
        .object({
          type: z.literal("fixed_maps"),
          count: z.number().int().min(1).max(99),
          allowDraw: z.boolean(),
        })
        .strict(),
    ]),
    allowSubstitutions: z.boolean(),
    allowShortHanded: z.boolean(),
    failedScorePolicy: z.enum(["include", "zero"]),
    tiedMapPolicy: z.enum(["require_replay", "count_as_draw"]),
  })
  .strict();
export type ScoringRules = z.infer<typeof scoringRulesSchema>;
