import { contextSchema } from '../src/shared/oclr-context.ts'
import { writeFileSync } from 'node:fs'
import { z } from 'zod'
import { authRequestSchema, fixturePageSchema, panelSchema, tokenSchema } from '../src/shared/oclr-contracts.ts'
// Input schemas document accepted wire JSON; the projection transform is local-only.
const contracts = Object.fromEntries(Object.entries({ authRequestResponse: authRequestSchema, tokenResponse: tokenSchema, fixturesResponse: fixturePageSchema, panelResponse: panelSchema }).map(([name, schema]) => [name, z.toJSONSchema(schema, { io: 'input', reused: 'ref' })]))
writeFileSync(new URL('../docs/contracts/oclr-desktop-read.schema.json', import.meta.url), JSON.stringify({ status: 'candidate-not-deployed', contractVersion: '1.1.0', websiteSource: 'https://github.com/OCLR-dev/OCLR-website/pull/409', websiteCommit: '1abbab1ddd981025249af727d748e70e23b9096b', websiteModelCommit: 'bbf0300555fb80a78a6a16e4ceee9c6a5a329bea', contracts }, null, 2) + '\n')

writeFileSync(new URL('../docs/contracts/oclr-context-candidate.schema.json', import.meta.url), JSON.stringify({status:'candidate-not-deployed',contractVersion:'1.0.0',source:'referee-context-api.md',contract:z.toJSONSchema(contextSchema,{io:'input',reused:'ref'})},null,2)+'\n')
