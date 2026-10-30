# Pinned website modules

Source: [OCLR-website PR #409](https://github.com/OCLR-dev/OCLR-website/pull/409), commit `1abbab1ddd981025249af727d748e70e23b9096b`, MIT, Copyright (c) 2026 Emik.

- `referee-commands.ts`: exact command builder/settings/policy module, with explicit `.ts` import extension for Node's stripped-TypeScript tests.
- `referee-model.ts`: refreshed from website commit `bbf0300555fb80a78a6a16e4ceee9c6a5a329bea` for optional per-team repeated Mod Ban rules and the unconditional TB Ban prohibition; same import-extension adjustment. No DB, Next.js, cookie or mock IRC component is imported.
- `competition-model.ts`: only the scoring rules schema/type excerpt before `standingsRulesSchema`; no standings/group services copied.
- `LICENSE`: upstream notice. A distribution notice also lives at the application root so packaging retains it when raw source is excluded.

These are a pinned snapshot, not a published upstream SDK. Update source commit, attribution and command/projection tests together when the PR changes. Desktop response validation, memory lifecycle and IPC remain separate. Referee records are read-only here; shared write validators do not expose a mutation endpoint.
