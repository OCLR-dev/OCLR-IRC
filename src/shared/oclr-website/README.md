# Pinned website modules

Source: [OCLR-website PR #409](https://github.com/OCLR-dev/OCLR-website/pull/409), commit `1abbab1ddd981025249af727d748e70e23b9096b`, MIT, Copyright (c) 2026 Emik.

- `referee-commands.ts`: exact command builder/settings/policy module, with explicit `.ts` import extension for Node's stripped-TypeScript tests.
- `referee-model.ts`: refreshed from website commit `ed9e83c0dcfd84b96e90d7bb3981c99ffe5449a6` for saved EX declarations, nullable first-ban orders and exhibition skip-ban projections, retaining per-team repeated Mod Ban rules and the unconditional TB Ban prohibition; same import-extension adjustment. No DB, Next.js, cookie or mock IRC component is imported.
- `competition-model.ts`: scoring rules schema/type refreshed against website main `34a0398f` for optional `exPlayersPerTeam` (1–16/null), keeping unknown fields strict; only the excerpt before `standingsRulesSchema`; no standings/group services copied.
- `LICENSE`: upstream notice. A distribution notice also lives at the application root so packaging retains it when raw source is excluded.

These are a pinned snapshot, not a published upstream SDK. Update source commit, attribution and command/projection tests together when the PR changes. Desktop response validation, memory lifecycle and IPC remain separate. Referee records are read-only here; shared write validators do not expose a mutation endpoint.

The desktop adapter at `../referee-commands.ts` replaces roster invitation targets with validated, unique osu! UIDs (`!mp invite #<UID>`) under the 2026-11-03 user request. This does not change the pinned builder above or claim upstream behavior changed. Other generated commands and the Main permission gates remain in place.
