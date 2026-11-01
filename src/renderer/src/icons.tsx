export function Icon({ name }: { name: 'connect' | 'room' | 'trophy' | 'document' | 'history' | 'arrow' | 'logout' | 'key' | 'eye' | 'menu' | 'settings' | 'refresh' }) {
  const paths = {
    connect: <><path d="M8 7V3m8 4V3M6 7h12v4a6 6 0 0 1-12 0V7Zm6 10v4" /></>,
    room: <><path d="M4 5h16v12H9l-5 4V5Z" /><path d="M8 9h8M8 13h5" /></>,
    trophy: <><path d="M7 3h10v5a5 5 0 0 1-10 0V3ZM7 5H3v2a4 4 0 0 0 4 4m10-6h4v2a4 4 0 0 1-4 4" /><path d="M12 13v5m-4 3h8m-7-3h6v3H9v-3Z" /></>,
    document: <><path d="M14 3H5v18h14V8l-5-5ZM14 3v5h5" /><path d="M8 12h8M8 16h6" /></>,
    history: <><path d="M3 11a9 9 0 1 1 2.4 6.1M3 4v7h7" /><path d="M12 7v5l3 2" /></>,
    settings: <><path d="m9 3-.5 3-2 1L4 6 2 10l2.5 2v2L2 16l2 4 2.5-1 2 1 .5 3h6l.5-3 2-1 2.5 1 2-4-2.5-2v-2L22 10l-2-4-2.5 1-2-1-.5-3H9Z" transform="translate(0 -1) scale(1 .96)" /><circle cx="12" cy="11.5" r="3" /></>,
    arrow: <path d="M5 12h14m-6-6 6 6-6 6" />,
    refresh: <><path d="M3 12a9 9 0 0 1 15.4-6.4L21 8M21 3v5h-5M21 12a9 9 0 0 1-15.4 6.4L3 16M8 16H3v5" /></>,
    menu: <path d="M4 6h16M4 12h16M4 18h16" />,
    logout: <><path d="M9 4H4v16h5m5-13 5 5-5 5m-5-5h14" /></>,
    key: <><circle cx="8" cy="8" r="4" /><path d="m11 11 9 9m-3-3 3-3m-6 0 3-3" /></>,
    eye: <><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Z" /><circle cx="12" cy="12" r="3" /></>
  }
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>
}
