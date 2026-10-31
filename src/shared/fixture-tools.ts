import { relayCommand } from './relay-command.ts'
import type { OclrSnapshot } from './oclr-contracts.ts'
import type { LobbyPreview } from './lobby-command.ts'
export interface FixtureInvitePreview extends LobbyPreview { fixtureLabel: string; teamName: string; osuId: number }
/** A selected panel is a roster source, not an eligibility or lineup decision. */
export function fixtureInviteSource(state: OclrSnapshot, teamId: string, osuId: number, includeFingerprint = true) {
  const panel = state.panel, workspace = panel?.workspace
  if (!state.subject || state.status !== 'connected' || state.panelState !== 'fresh' || !workspace || workspace.fixture.id !== state.selectedFixtureId || panel.viewer.osuId !== state.subject.osuId) throw new Error('場次資料已失效，請重新同步。')
  const fixture = state.fixtures.find(fixture => fixture.fixtureId === workspace.fixture.id)
  if (!fixture?.operational || fixture.resultReviewState === 'approved' || fixture.status === 'cancelled') throw new Error('此場次不能準備邀請。')
  const team = workspace.teams.find(team => team.id === teamId), player = team?.members.find(player => player.osuId === osuId)
  const members = workspace.teams.flatMap(team => team.members)
  const nick = (name: string) => name.trim().replace(/\s+/gu, '_').toLowerCase()
  if (!team || !player || members.filter(member => member.osuId === osuId).length !== 1 || members.filter(member => nick(member.username) === nick(player.username)).length !== 1) throw new Error('隊員資料有缺漏或重複，請在網站核對。')
  const command = state.commands.find(command => command.id === `invite:${teamId}:${osuId}`)
  const expected = relayCommand(`!mp invite ${player.username.trim().replace(/\s+/gu, '_')}`)
  if (!command?.text || command.kind !== 'invite' || command.text !== expected) throw new Error(command?.reason || '此場次不能準備邀請。')
  return { player, team, command: expected, fingerprint: includeFingerprint ? JSON.stringify([state.subject, workspace]) : '' }
}
