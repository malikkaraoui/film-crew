export type ApiSuccess<T> = {
  data: T
  meta?: { cost_eur?: number; duration_ms?: number }
}

export type ApiError = {
  error: { code: string; message: string; details?: unknown }
}

export type ApiResponse<T> = ApiSuccess<T> | ApiError
