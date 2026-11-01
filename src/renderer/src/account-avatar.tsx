import { Avatar } from '@heroui/react'
import { useEffect, useState } from 'react'
import type { AvatarState } from '../../shared/avatar'

export function AccountAvatar({ username }: { username: string }) {
  const [avatar, setAvatar] = useState<AvatarState | null>(null)
  useEffect(() => {
    const api = window.oclr?.avatar
    if (!api) return
    let arrived = false
    const off = api.onState(value => { arrived = true; setAvatar(value) })
    void api.snapshot().then(value => { if (!arrived) setAvatar(value) }).catch(() => {})
    return off
  }, [])
  return <Avatar key={username} className="account-avatar" aria-hidden="true"><Avatar.Image src={avatar?.username === username ? avatar.dataUrl ?? undefined : undefined} alt="" /><Avatar.Fallback>{username.slice(0, 1)}</Avatar.Fallback></Avatar>
}
