export default defineEventHandler((event) => {
  const origin = getHeader(event, 'origin') || ''
  if (origin !== 'https://mcyzw.top') return

  if (handleCors(event, {
    origin: ['https://mcyzw.top'],
    methods: ['GET', 'HEAD', 'OPTIONS'],
    allowHeaders: ['Accept', 'Content-Type'],
    exposeHeaders: ['Content-Length', 'Content-Type', 'ETag'],
    maxAge: '86400',
  })) return
})
