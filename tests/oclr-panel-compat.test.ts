import { test } from 'node:test'
import assert from 'node:assert/strict'
import { panelSchema } from '../src/shared/oclr-contracts.ts'
import { panel, id } from './fixtures/oclr.ts'

import { exhibitionPanel } from './fixtures/exhibition-panel.ts'

test('existing normal and open exhibition panels retain their order and identity checks',()=>{
  assert.equal(panelSchema.safeParse(panel()).success,true)
  const parsed=panelSchema.parse(exhibitionPanel())
  assert.equal(parsed.data.workspace.projection.nextStep?.kind,'ban')
  assert.equal(parsed.data.workspace.teams[0].captainId,null)
})
test('exhibition skip-ban order accepts a null first-ban team and projects the original pick index',()=>{
  const parsed=panelSchema.parse(exhibitionPanel(true))
  assert.equal(parsed.data.workspace.projection.nextStep?.kind,'pick')
  assert.equal(parsed.data.workspace.projection.nextStep?.index,1)
  assert.equal(parsed.data.workspace.projection.nextStep?.teamId,id(202))
})
test('saved EX declarations are parsed and retained by the local projection',()=>{
  const parsed=panelSchema.parse(exhibitionPanel(false,true))
  assert.equal((parsed.data.workspace.projection.activeSelections[0] as {exMode?:boolean}).exMode,true)
})
test('unknown events, invalid nullable orders and inconsistent event revisions still fail closed',()=>{
  const unknown=exhibitionPanel(true,true)
  unknown.data.workspace.events[2].payload.type='future_event'
  assert.equal(panelSchema.safeParse(unknown).success,false)
  const order=exhibitionPanel(true)
  delete (order.data.workspace.events[0].payload as {skipBans?:boolean}).skipBans
  assert.equal(panelSchema.safeParse(order).success,false)
  const revision=exhibitionPanel(true)
  revision.data.workspace.session.revision++
  assert.equal(panelSchema.safeParse(revision).success,false)
})
