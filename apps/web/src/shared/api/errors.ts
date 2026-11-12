import { ApiErrorSchema, type ApiError } from '@aiko/shared';

/**
 * API client 归一化错误（M2.4）：
 * - 服务端返回 ApiError 结构时，code/status/details 来自服务端；
 * - 网络失败或响应体不是 ApiError 时，code 为客户端本地值；
 * - 组件层只 catch 本类型，不接触 fetch/Response。
 */
export class ApiClientError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details: unknown;

  constructor(params: { code: string; message: string; status: number; details?: unknown }) {
    super(params.message);
    this.name = 'ApiClientError';
    this.code = params.code;
    this.status = params.status;
    this.details = params.details;
  }

  /** 从服务端错误响应体解析；解析失败返回 null，由调用方降级。 */
  static fromBody(body: unknown, status: number): ApiClientError | null {
    const parsed = ApiErrorSchema.safeParse(body);
    if (!parsed.success) return null;
    return new ApiClientError({
      code: parsed.data.code,
      message: parsed.data.message,
      status,
      details: parsed.data.details,
    });
  }
}

export function isApiErrorCode(error: unknown, code: ApiError['code']): boolean {
  return error instanceof ApiClientError && error.code === code;
}