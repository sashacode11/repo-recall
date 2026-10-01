<template>
  <div class="mx-auto max-w-2xl px-4 pb-24 pt-8">
    <NuxtRouteAnnouncer />
    <header class="mb-10 flex items-baseline justify-between gap-4 text-sm">
      <NuxtLink to="/" class="font-semibold text-neutral-100">Repo Recall</NuxtLink>
      <nav class="flex gap-4 text-neutral-400">
        <NuxtLink to="/" class="hover:text-neutral-100" exact-active-class="text-neutral-100">Job prep</NuxtLink>
        <NuxtLink to="/repo" class="hover:text-neutral-100" active-class="text-neutral-100">Repo</NuxtLink>
      </nav>
    </header>
    <NuxtPage />
  </div>
</template>
