export type Step = { id: string; goal_id: string; label: string; done: number; position: number }
export type Goal = {
  id: string; title: string; detail: string; category: string
  target_date: string | null; status: string; created_at: string; completed_at: string | null
  steps: Step[]
}
export type Domain = { id: string; name: string; weight: number; tasks: string[] }
export type Cert = {
  code: string; name: string; short: string; passingScore: number; scaledRange: [number, number]
  questions: number; minutes: number; costUSD: number; validYears: number; domains: Domain[]
  confidence: Record<string, number>; doneTasks: string[]
  readiness: number; predictedScore: number
  exam: { cert_code: string; scheduled_for: string | null; passed_at: string | null; badge_url: string | null; expires_at: string | null } | null
}
export type Assignment = {
  id: string; source: string; course_name: string | null; title: string
  due_at: string | null; points: number | null; html_url: string | null
  submitted: number; graded_score: number | null; done_manual: number; state: string | null
}
export type Course = {
  id: string; provider: string; slug: string; name: string; url: string
  description: string; workload: string; total_modules: number; done_modules: number; status: string
}
export type CalEvent = { id: string; source: string; title: string; start_at: string; end_at: string | null; all_day: number; location: string | null }
export type Session = { id: string; day: string; minutes: number; subject: string; kind: string; note: string; score: number | null }
export type Stats = {
  xp: number; level: number; intoLevel: number; needed: number; pct: number
  streak: { current: number; best: number; loggedToday: boolean }
  heatmap: Record<string, number>
}
export type State = {
  goals: Goal[]; certs: Cert[]; assignments: Assignment[]
  courses: Course[]; events: CalEvent[]; sessions: Session[]; stats: Stats
}
export type Config = {
  canvas: { mode: 'token' | 'ics' | 'off'; baseUrl: string | null }
  credly: { handle: string | null }
  assistant: {
    providers: { id: 'claude' | 'gemini'; model: string; configured: boolean }[]
    active: 'claude' | 'gemini' | null
  }
  appleCalendar: { mode: 'eventkit' | 'ics' | 'off'; configured: boolean }
  lastSync: { canvas: string | null; credly: string | null; calendar: string | null }
}

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  })
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? `Request failed (${res.status})`)
  return res.json()
}

export const api = {
  state: () => req<State>('/state'),
  config: () => req<Config>('/config'),

  addGoal: (b: any) => req('/goals', { method: 'POST', body: JSON.stringify(b) }),
  updateGoal: (id: string, b: any) => req(`/goals/${id}`, { method: 'PATCH', body: JSON.stringify(b) }),
  deleteGoal: (id: string) => req(`/goals/${id}`, { method: 'DELETE' }),
  addStep: (id: string, label: string) => req(`/goals/${id}/steps`, { method: 'POST', body: JSON.stringify({ label }) }),
  toggleStep: (id: string, done: boolean) => req(`/steps/${id}`, { method: 'PATCH', body: JSON.stringify({ done }) }),
  deleteStep: (id: string) => req(`/steps/${id}`, { method: 'DELETE' }),

  setConfidence: (code: string, domainId: string, confidence: number) =>
    req(`/certs/${code}/confidence`, { method: 'PUT', body: JSON.stringify({ domainId, confidence }) }),
  toggleTask: (code: string, taskKey: string, done: boolean) =>
    req(`/certs/${code}/task`, { method: 'PUT', body: JSON.stringify({ taskKey, done }) }),
  setExamDate: (code: string, scheduledFor: string | null) =>
    req(`/certs/${code}/exam`, { method: 'PUT', body: JSON.stringify({ scheduledFor }) }),

  logSession: (b: any) => req('/sessions', { method: 'POST', body: JSON.stringify(b) }),
  toggleAssignment: (id: string, done: boolean) => req(`/assignments/${id}`, { method: 'PATCH', body: JSON.stringify({ done }) }),

  addCourse: (input: string, totalModules: number) => req('/courses', { method: 'POST', body: JSON.stringify({ input, totalModules }) }),
  updateCourse: (id: string, b: any) => req(`/courses/${id}`, { method: 'PATCH', body: JSON.stringify(b) }),
  deleteCourse: (id: string) => req(`/courses/${id}`, { method: 'DELETE' }),

  syncCanvas: () => req<any>('/sync/canvas', { method: 'POST' }),
  syncCredly: (handle?: string) => req<any>('/sync/credly', { method: 'POST', body: JSON.stringify({ handle }) }),
  syncCalendar: () => req<any>('/sync/calendar', { method: 'POST' }),
}
