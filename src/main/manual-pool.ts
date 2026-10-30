import { randomUUID } from 'node:crypto'
import { mapProfile } from '../shared/map-profile.ts'
import type { ManualPoolState, ManualPoolEntry } from '../shared/manual-pool.ts'
export class ManualPool {
  private value: ManualPoolState = {revision:randomUUID(),entries:[]}
  get state(){return structuredClone(this.value)}
  clear(){this.value={revision:randomUUID(),entries:[]}}
  replace(input:unknown){
    if(!input||typeof input!=='object')throw new Error('圖池資料無效。')
    const value=input as Record<string,unknown>
    if(value.revision!==this.value.revision||!Array.isArray(value.entries)||value.entries.length>200)throw new Error('圖池版本已變更或超過 200 個槽位。')
    const ids=new Set<string>(),labels=new Set<string>(),entries:ManualPoolEntry[]=[]
    for(const item of value.entries){
      if(!item||typeof item.id!=='string'||!/^[A-Za-z0-9_-]{1,64}$/.test(item.id)||ids.has(item.id)||typeof item.label!=='string'||!item.label.trim()||[...item.label].length>32||/[\p{Cc}\p{Cf}\u2028\u2029]/u.test(item.label)||labels.has(item.label.trim().toLowerCase()))throw new Error('圖池槽位名稱或識別值有缺漏或重複。')
      ids.add(item.id);labels.add(item.label.trim().toLowerCase())
      let profile=null,error=null
      try{profile=mapProfile(item.profile)}catch{error='此槽位的地圖、Mods 或個人規則無效，請重新設定。'}
      entries.push({id:item.id,label:item.label.trim(),profile,error})
    }
    this.value={revision:randomUUID(),entries}
  }
  profile(input:unknown){
    if(!input||typeof input!=='object')throw new Error('無效的圖池選擇。')
    const value=input as Record<string,unknown>,entry=this.value.entries.find(item=>item.id===value.entryId)
    if(value.revision!==this.value.revision||!entry?.profile)throw new Error('圖池版本已變更或此槽位不可用。')
    return structuredClone(entry.profile)
  }
}
