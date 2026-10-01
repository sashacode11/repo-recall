// Keeps the job session in localStorage so an hour of study survives a reload.
export default defineNuxtPlugin(() => {
  const { session } = useJobSession()
  watch(session, (value) => saveJson(SESSION_KEY, value), { deep: true })
})
