export default defineNuxtConfig({
  compatibilityDate: '2025-07-15',
  devtools: { enabled: true },
  devServer: {
    host: '127.0.0.1',
    port: 3000
  },
  css: ['~/assets/css/main.css'],
  nitro: {
    errorHandler: '~~/server/error-handler'
  },
  vue: {
    compilerOptions: {
      isCustomElement: (tag: string) => tag.startsWith('md-')
    }
  },
  app: {
    pageTransition: { name: 'page', mode: 'out-in' },
    head: {
      title: 'Yzw Api',
      titleTemplate: '%s - Yzw Api',
      meta: [
        { name: 'robots', content: 'noindex, nofollow, noarchive, nosnippet' }
      ],
      link: [
        {
          rel: 'stylesheet',
          href: 'https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@20..48,100..700,0..1,-50..200'
        }
      ]
    }
  }
})
