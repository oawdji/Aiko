import type { ZodType } from '@aiko/shared';
import { ApiClientError } from './errors';

const API_BASE = '/api';
const REQUEST_TIMEOUT_MS = 15_000;

export type RequestOptions = {
  /** 默认 GET；settings 更新使用 PATCH/POST。 */
  method?: string;
  /** JSON 请求体；提供时自动带 Content-Type。 */
  body?: unknown;
  signal?: AbortSignal;
  /** 默认 15s；长连接类请求（聊天流）不走这层。 */
  timeoutMs?: number;
};

/**
 * 统一 JSON 请求封装（api-contract.md §20）：
 * - 超时 + 外部 signal 合并为一个 AbortSignal；
 * - 非 2xx 一律抛 ApiClientError；
 * - 响应体经 shared schema 校验后才返回，防止契约漂移悄悄流入 UI。
 * 组件禁止直接调用本函数，只能使用同目录领域函数。
 */
export async function requestJson<T>(
  path: string,
  schema: ZodType<T>,
  options: RequestOptions = {},
): Promise<T> {
  const timeoutController = new AbortController();
  const timeout = setTimeout(
    () => timeoutController.abort(),
    options.timeoutMs ?? REQUEST_TIMEOUT_MS,
  );
  const compositeSignal = options.signal
    ? AbortSignal.any([options.signal, timeoutController.signal])
    : timeoutController.signal;

  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      method: options.method ?? 'GET',
      signal: compositeSignal,
      headers: {
        Accept: 'application/json',
        ...(options.body !== undefined
          ? { 'Content-Type': 'application/json' }
          : {}),
      },
      ...(options.body !== undefined
        ? { body: JSON.stringify(options.body) }
        : {}),
    });
  } catch (error) {
    if (options.signal?.aborted) {
      throw new ApiClientError({
        code: 'CLIENT_ABORTED',
        message: 'Request aborted',
        status: 0,
      });
    }
    throw new ApiClientError({
      code: 'NETWORK_ERROR',
      message: error instanceof Error ? error.message : 'Network request failed',
      status: 0,
    });
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    const body: unknown = await safeJson(response);
    throw (
      ApiClientError.fromBody(body, response.status) ??
      new ApiClientError({
        code: 'INTERNAL_ERROR',
        message: `Unexpected error response (HTTP ${response.status})`,
        status: response.status,
        details: body,
      })
    );
  }

  const data: unknown = await safeJson(response);
  const parsed = schema.safeParse(data);
  if (!parsed.success) {
    throw new ApiClientError({
      code: 'RESPONSE_CONTRACT_VIOLATION',
      message: 'Server response does not match the API contract',
      status: response.status,
      details: parsed.error.flatten(),
    });
  }
  return parsed.data;
}

async function safeJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}