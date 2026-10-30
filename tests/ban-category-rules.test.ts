import test from 'node:test'
import assert from 'node:assert/strict'
import { panelSchema } from '../src/shared/oclr-contracts.ts'
import { validateRefereeAction, type RefereeModelInput } from '../src/shared/oclr-website/referee-model.ts'
import { panel, id } from './fixtures/oclr.ts'

test('panel accepts the optional website Ban rules without losing legacy compatibility', () => {
  assert.equal(panelSchema.safeParse(panel()).success, true)
  const value = panel()
  const rules = { allowRepeats: false, repeatExceptions: ['NM', 'FM'] }
  Object.assign(value.data.workspace.policy, { banCategoryRules: rules })
  assert.deepEqual(panelSchema.parse(value).data.workspace.policy?.banCategoryRules, rules)
  Object.assign(value.data.workspace.policy, { banCategoryRules: { allowRepeats: false, repeatExceptions: ['TB'] } })
  assert.equal(panelSchema.safeParse(value).success, false)
})

test('shared validation rejects same-team repeat Bans and all TB Bans', () => {
  const input: RefereeModelInput = {
    policy: { commands: null, banCategoryRules: { allowRepeats: false, repeatExceptions: ['NM', 'FM'] },
      steps: Array.from({ length: 2 }, () => ({ kind: 'ban', actor: 'firstBan', categories: [], entryIds: [], avoidRepeatCategory: false, tiedAt: null })) },
    teamIds: [id(201), id(202)], orders: { firstBanTeamId: id(201), firstPickTeamId: id(202) },
    maps: [1, 2].map(position => ({ id: id(300 + position), beatmapId: 1000 + position, category: 'HD', position })),
    events: [], series: { type: 'first_to', wins: 1 }
  }
  const payload = validateRefereeAction(input, { action: 'record_selection', entryId: id(301) })
  input.events.push({ id: id(401), ordinal: 1, actorId: 1, createdAt: '2026-10-30T00:00:00Z', payload })
  assert.throws(() => validateRefereeAction(input, { action: 'record_selection', entryId: id(302) }), /already banned/)
  input.policy!.banCategoryRules!.allowRepeats = true
  assert.doesNotThrow(() => validateRefereeAction(input, { action: 'record_selection', entryId: id(302) }))
  input.maps[1].category = 'TB'
  assert.throws(() => validateRefereeAction(input, { action: 'record_selection', entryId: id(302) }), /cannot be banned/)
})
