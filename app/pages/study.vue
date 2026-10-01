<script setup lang="ts">
const { session, stats, studyAvg } = useJobSession()
if (!session.value) await navigateTo('/', { replace: true })

const openId = ref<string | null>(null)
const allQuestions = computed(() => session.value?.plan.studyPlan.flatMap((t) => t.questions) ?? [])
const answered = computed(() => Object.keys(session.value?.study ?? {}).length)

// Open the first unanswered question on arrival.
onMounted(() => {
  openId.value = allQuestions.value.find((q) => !session.value?.study[q.id])?.id ?? null
})

function statFor(topicId: string) {
  return stats.value.find((s) => s.topicId === topicId)
}
</script>

<template>
  <div v-if="session" class="space-y-10">
    <section class="space-y-2">
      <p class="label">Study · {{ session.plan.seniority !== 'unspecified' ? session.plan.seniority : 'role' }}</p>
      <h1 class="text-2xl font-semibold text-neutral-100">{{ session.plan.roleTitle }}</h1>
      <p class="muted">
        Look things up. Read docs, check your notes, try it in a REPL. This stage is for learning, and every answer gets
        feedback and a model answer. Scoring is as strict as the interview so the two are comparable.
      </p>
      <p class="text-sm text-neutral-400">
        {{ answered }} of {{ allQuestions.length }} answered · study score
        <span class="tabular-nums" :class="scoreColor(studyAvg)">{{ fmtScore(studyAvg) }}</span>
      </p>
    </section>

    <section v-for="topic in session.plan.studyPlan" :key="topic.id" class="space-y-4">
      <div class="space-y-3">
        <h2 class="text-lg font-semibold text-neutral-100">
          {{ topic.topic }}
          <span v-if="statFor(topic.id)?.study != null" class="ml-2 text-sm font-normal tabular-nums" :class="scoreColor(statFor(topic.id)?.study)">
            {{ fmtScore(statFor(topic.id)?.study) }}
          </span>
        </h2>
        <blockquote v-if="topic.fromPosting" class="border-l-2 border-neutral-700 pl-3 text-sm italic text-neutral-500">
          “{{ topic.fromPosting }}”
        </blockquote>
        <p>{{ topic.whyItMatters }}</p>
        <div>
          <p class="label mb-1">What they'll probe</p>
          <ul class="list-disc space-y-1 pl-5 text-neutral-300">
            <li v-for="p in topic.whatTheyProbe" :key="p">{{ p }}</li>
          </ul>
        </div>
      </div>
      <ol class="space-y-4">
        <StudyQuestion
          v-for="(q, i) in topic.questions"
          :key="q.id"
          :question="q"
          :topic="topic"
          :index="i"
          :open="openId === q.id"
          @open="openId = q.id"
        />
      </ol>
    </section>

    <section class="space-y-3 border-t border-neutral-800 pt-6">
      <p class="muted">
        Ready? The mock interview asks 10 new questions on these topics, one at a time, with a timer and no feedback until
        the end.
      </p>
      <NuxtLink to="/mock" class="btn-primary">Start mock interview</NuxtLink>
    </section>
  </div>
</template>
