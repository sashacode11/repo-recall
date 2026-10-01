// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  compatibilityDate: '2025-07-15',
  devtools: { enabled: true },
  // Client-only app: all session state lives in the browser (memory + localStorage).
  ssr: false,
  modules: ['@nuxtjs/tailwindcss'],
  css: ['~/assets/css/main.css'],
  app: {
    head: {
      title: 'Repo Recall',
      htmlAttrs: { lang: 'en', class: 'dark' },
    },
  },
})
