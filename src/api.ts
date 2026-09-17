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
export type GradeGroup = { name: string; weight: number; earned: number; possible: number; graded: number; total: number }
export type CourseGrade = {
  course_id: string; course_name: string
  current_score: number | null; current_grade: string | null; final_score: number | null
  html_url: string | null; synced_at: string | null
  groups: GradeGroup[]
}
export type StatusDef = { id: string; label: string; group: 'saved' | 'applied' | 'active' | 'offer' | 'closed' }
export type JobListing = {
  id: string; company: string; title: string; url: string; company_url: string | null
  locations: string[]; regions: ('DFW' | 'Austin' | 'Remote')[]; category: string | null; degrees: string[]
  posted_at: string | null; updated_at: string | null; application_id: string | null
}
export type Application = {
  id: string; feed_id: string | null; company: string; role: string; location: string; url: string
  status: string; applied_on: string | null; next_step: string; next_step_on: string | null
  referral: string; notes: string; posting_closed: number
  created_at: string; updated_at: string; status_changed_at: string
}
export type JobsPayload = {
  term: string; statuses: StatusDef[]; lastSync: string | null; stale: boolean
  feed: JobListing[]; applications: Application[]
}
export type State = {
  goals: Goal[]; certs: Cert[]; assignments: Assignment[]
  courses: Course[]; events: CalEvent[]; sessions: Session[]; stats: Stats
  grades: CourseGrade[]
}
export type Config = {
  canvas: { mode: 'token' | 'ics' | 'off'; baseUrl: string | null }
  credly: { handle: string | null }
  assistant: {
    providers: { id: 'claude' | 'gemini'; model: string; configured: boolean }[]
    active: 'claude' | 'gemini' | null
  }
  appleCalendar: { mode: 'eventkit' | 'ics' | 'off'; configured: boolean }
  email: {
    graph: { configured: boolean; connected: boolean }
    gmail: { configured: boolean; connected: boolean }
    lastSync: { graph: string | null; gmail: string | null }
  }
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

  jobs: () => req<JobsPayload>('/jobs'),
  syncJobs: () => req<{ unchanged: boolean; kept: number; scanned?: number; removed?: number }>('/jobs/sync', { method: 'POST' }),
  addApplication: (b: { feed_id?: string; company?: string; role?: string; location?: string; url?: string; status?: string }) =>
    req<Application>('/applications', { method: 'POST', body: JSON.stringify(b) }),
  updateApplication: (id: string, b: Partial<Application>) =>
    req<Application>(`/applications/${id}`, { method: 'PATCH', body: JSON.stringify(b) }),
  deleteApplication: (id: string) => req<{ ok: true }>(`/applications/${id}`, { method: 'DELETE' }),

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
