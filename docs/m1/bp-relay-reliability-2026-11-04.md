# #118 BP relay reliability verification

Recorded on 2026-11-04 (Asia/Taipei), based on main `b16762a`, Node.js 24.22.2, using the existing npm lockfile.

## Changes

- A read-only notice readiness check distinguishes temporary settings/listrefs work and shared flood cooldown from a dispatch attempt. The relay waits at most eight seconds, repeatedly checks the paired binding and room epoch, then writes once. Cancellation or a changed login/room discards the old intent; a dispatched or consumed command is never replayed.
- BP notice writes advance the existing shared flood timestamp.
- The reported `Disabled all mods, enabled FreeMod` reply can acknowledge `NF Freemod` as a room setting. Only the requested NF may be omitted; other Mods and the FreeMod flag must match. Existing explicit-NF replies remain supported. Individual NF and competition compliance are not established by this acknowledgement.

## Verification

- `npm ci`, `npm run typecheck` and `npm run build` passed.
- Full `npm test`: **228 tests passed**, zero failures/skips. Two additional bounded-deadline and exact reported-reply cases then passed separately; typecheck was repeated after adding them.
- Relevant transport/relay tests passed **46/46** before the two supplemental cases. They cover real loopback IRC query/cooldown readiness, one notice after transient busy state, queued reads, no operation-history mutation from notices, cancellation, room/subject/login changes while waiting, attempted-write failures remaining unknown, deduplication and legacy negotiation.
- The supplemental reply test passes the reported response through the actual relay event listener, rejects another room and non-Bot sender, and observes one confirmed receipt without a second wire write. Negative parser vectors retain missing speed Mods, wrong FreeMod state, unexpected/unknown Mods and non-FreeMod NF mismatches as unconfirmed.
- `git diff --check` passed. UI/preload/window code was not changed; the Electron UI smoke was not run. Tests used synthetic identities and HTTP/IRC, with the organizer-provided generic reply as a parser vector. No real account or room was operated and no app version/tag was published.

Website acknowledgement support is tracked in [OCLR-website #784](https://github.com/OCLR-dev/OCLR-website/issues/784). The independently owned operation-history and room-refresh work remains with [#117](https://github.com/OCLR-dev/OCLR-IRC/issues/117) and [#116](https://github.com/OCLR-dev/OCLR-IRC/issues/116); this patch does not include or replace those changes. CI/platform/live-service evidence must be assessed separately for the pushed commit.
