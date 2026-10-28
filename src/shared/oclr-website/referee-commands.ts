// Vendored from OCLR-website PR #409, commit 1abbab1ddd981025249af727d748e70e23b9096b (MIT).
import { z } from "zod";
import type { ScoringRules } from "./competition-model.ts";

// Commands remain plain text. Nothing in this module contacts osu! or records play.
const singleLine = (limit: number) =>
  z
    .string()
    .max(limit)
    .refine((value) => !/[\p{Cc}\p{Cf}\u2028\u2029]/u.test(value), {
      message: "Use a single line without control characters.",
    });
const seconds = z
  .number()
  .int()
  .positive()
  .max(Number.MAX_SAFE_INTEGER)
  .nullable();
export const refereeSettingsSchema = z
  .object({
    roomName: singleLine(200),
    streamerUsername: singleLine(50),
    timerSeconds: seconds,
    startSeconds: seconds,
    roomSize: z.number().int().min(1).max(16).nullable(),
  })
  .strict();
export type RefereeSettings = z.infer<typeof refereeSettingsSchema>;
export const emptyRefereeSettings: RefereeSettings = {
  roomName: "",
  streamerUsername: "",
  timerSeconds: null,
  startSeconds: null,
  roomSize: null,
};
export const commandMods = [
  "EZ",
  "HD",
  "HR",
  "DT",
  "HT",
  "NC",
  "FL",
  "FI",
  "SD",
  "PF",
  "SO",
  "MR",
  "1K",
  "2K",
  "3K",
  "4K",
  "5K",
  "6K",
  "7K",
  "8K",
  "9K",
] as const;
const modPolicySchema = z
  .object({
    mods: z
      .array(z.enum(commandMods))
      .max(commandMods.length)
      .refine((mods) => new Set(mods).size === mods.length),
    freemod: z.boolean(),
  })
  .strict()
  .refine(
    ({ mods }) => {
      const has = (value: (typeof commandMods)[number]) => mods.includes(value);
      return (
        !(has("EZ") && has("HR")) &&
        !(has("HT") && (has("DT") || has("NC"))) &&
        !(has("DT") && has("NC")) &&
        !(has("SD") && has("PF")) &&
        mods.filter((m) => /^\dK$/.test(m)).length <= 1
      );
    },
    { message: "Choose compatible Mods." },
  );
export const refereeCommandPolicySchema = z
  .object({
    roomSize: z.number().int().min(1).max(16),
    noFail: z.boolean(),
    categoryMods: z.record(z.string().min(1).max(50), modPolicySchema),
    banSeconds: seconds,
    pickSeconds: seconds,
    prepareSeconds: seconds,
    startSeconds: seconds,
  })
  .strict()
  .refine(
    (policy) =>
      !policy.noFail ||
      Object.values(policy.categoryMods).every(
        ({ mods }) => !mods.includes("SD") && !mods.includes("PF"),
      ),
    { message: "No Fail cannot be combined with Sudden Death or Perfect." },
  );
export type RefereeCommandPolicy = z.infer<typeof refereeCommandPolicySchema>;
export type RefereeCommandTeam = {
  id: string;
  name: string;
  captainId: number | null;
  captainUsername: string | null;
  members?: readonly { osuId: number; username: string }[];
};
export type RefereeCommandInput = {
  settings: RefereeSettings;
  policy: RefereeCommandPolicy | null;
  rules: ScoringRules | null;
  teams: readonly RefereeCommandTeam[];
  selectedMap: { beatmapId: number; category: string } | null;
};
export type RefereeCommand = {
  id: string;
  kind:
    | "make"
    | "set"
    | "addref"
    | "invite"
    | "timer"
    | "map"
    | "mods"
    | "start"
    | "abort";
  text: string | null;
  reason: string | null;
  teamName?: string;
  playerName?: string;
};
const positiveInteger = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value > 0;
const validLine = (value: unknown, max: number) =>
  typeof value === "string" &&
  singleLine(max).safeParse(value).success &&
  value.trim().length > 0;
/** Both SSR and client rendering use the same validated command text. */
export function refereeCommands(input: RefereeCommandInput): RefereeCommand[] {
  const { settings, teams, selectedMap, rules } = input;
  const parsedPolicy = refereeCommandPolicySchema.safeParse(input.policy);
  const policy = parsedPolicy.success ? parsedPolicy.data : null;
  const command = (
    kind: RefereeCommand["kind"],
    text: string | null,
    reason: string | null,
  ): RefereeCommand => ({ id: kind, kind, text, reason: text ? null : reason });
  const roomName = validLine(settings.roomName, 200)
    ? settings.roomName.trim()
    : null;
  const size = settings.roomSize ?? policy?.roomSize;
  const validSize = Number.isInteger(size) && size! >= 1 && size! <= 16;
  const teamMode =
    rules?.teamType === "team-vs"
      ? 2
      : rules?.teamType === "head-to-head"
        ? 0
        : null;
  const scoreMode =
    rules?.scoringType === "score"
      ? 0
      : rules?.scoringType === "scorev2"
        ? 3
        : null;
  const mode = rules
    ? ({ osu: 0, taiko: 1, fruits: 2, mania: 3 } as const)[rules.mode]
    : undefined;
  const username = validLine(settings.streamerUsername, 50)
    ? settings.streamerUsername.trim().replace(/\s+/gu, "_")
    : null;
  const mapValid = Boolean(
    selectedMap && positiveInteger(selectedMap.beatmapId),
  );
  const mods =
    selectedMap &&
    policy &&
    Object.hasOwn(policy.categoryMods, selectedMap.category)
      ? policy.categoryMods[selectedMap.category]
      : null;
  // None deliberately clears the previous map's Mods. NF is separate from pool category.
  const modWords = mods
    ? [
        ...(policy?.noFail ? ["NF"] : []),
        ...mods.mods,
        ...(mods.freemod ? ["Freemod"] : []),
      ]
    : null;
  const modeCompatible =
    mode !== undefined &&
    Boolean(mods) &&
    mods!.mods.every((mod) => {
      if (["FI", "MR"].includes(mod) || /^\dK$/.test(mod)) return mode === 3;
      if (mod === "SO") return mode === 0;
      return true;
    });
  const startSeconds = settings.startSeconds ?? policy?.startSeconds;
  return [
    command(
      "make",
      roomName ? `!mp make ${roomName}` : null,
      "Enter a valid room name.",
    ),
    command(
      "set",
      policy && teamMode !== null && scoreMode !== null && validSize
        ? `!mp set ${teamMode} ${scoreMode} ${size}`
        : null,
      "Configure the round rules and room size first.",
    ),
    command(
      "addref",
      username ? `!mp addref ${username}` : null,
      "Enter a valid osu! username for the Streamer.",
    ),
    ...teams.flatMap((team) => {
      const players = team.members ?? [
        { osuId: team.captainId, username: team.captainUsername ?? "" },
      ];
      return players.map((player) => ({
        ...command(
          "invite",
          positiveInteger(player.osuId) && validLine(player.username, 50)
            ? `!mp invite ${player.username.trim().replace(/\s+/gu, "_")}`
            : null,
          "This player's saved username is missing or invalid.",
        ),
        id: team.members
          ? `invite:${team.id}:${player.osuId}`
          : `invite:${team.id}`,
        teamName: team.name,
        playerName: player.username,
      }));
    }),
    command(
      "timer",
      positiveInteger(settings.timerSeconds)
        ? `!mp timer ${settings.timerSeconds}`
        : null,
      "Choose a positive timer duration.",
    ),
    command(
      "map",
      mapValid && mode !== undefined
        ? `!mp map ${selectedMap!.beatmapId} ${mode}`
        : null,
      "Select a saved pool map and configure the ruleset first.",
    ),
    command(
      "mods",
      mapValid && modWords && modeCompatible
        ? `!mp mods ${modWords.length ? modWords.join(" ") : "None"}`
        : null,
      mods && !modeCompatible
        ? "Configure Mods compatible with the round ruleset."
        : "Configure this pool category's Mods policy first.",
    ),
    command(
      "start",
      positiveInteger(startSeconds) ? `!mp start ${startSeconds}` : null,
      "Configure the independent start countdown first.",
    ),
    command("abort", "!mp abort", null),
  ];
}

/** A denied/unavailable clipboard is a recoverable manual-copy state, never success. */
export async function copyRefereeCommand(
  text: string,
  clipboard?: Pick<Clipboard, "writeText">,
): Promise<"copied" | "manual"> {
  if (
    !clipboard ||
    !/^!mp [^\r\n]+$/.test(text) ||
    /[\p{Cc}\p{Cf}\u2028\u2029]/u.test(text)
  )
    return "manual";
  try {
    await clipboard.writeText(text);
    return "copied";
  } catch {
    return "manual";
  }
}
