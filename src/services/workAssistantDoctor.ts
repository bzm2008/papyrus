import { invoke } from '@tauri-apps/api/core'

export type DoctorStatus = 'ok' | 'warning' | 'error'

export type DoctorCheck = {
  id: string
  label: string
  status: DoctorStatus
  message: string
}

export type WorkAssistantDoctorReport = {
  platform: string
  architecture: string
  checks: DoctorCheck[]
  generatedAt: number
}

export type WorkAssistantDoctorInvoker = () => Promise<WorkAssistantDoctorReport>

let invokeDoctor: WorkAssistantDoctorInvoker = () =>
  invoke<WorkAssistantDoctorReport>('work_assistant_doctor')

export function getWorkAssistantDoctor() {
  return invokeDoctor()
}

export function setWorkAssistantDoctorInvokerForTests(next: WorkAssistantDoctorInvoker) {
  invokeDoctor = next
}

export function resetWorkAssistantDoctorInvokerForTests() {
  invokeDoctor = () => invoke<WorkAssistantDoctorReport>('work_assistant_doctor')
}
