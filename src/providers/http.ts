import { ProviderError } from './provider';

export interface HttpOptions {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  signal?: AbortSignal;
  timeoutMs?: number;
  /** Optional per-line transform for NDJSON/SSE streams. */
  parseLine?: (line: string) => unknown;
}

const DEFAULT_TIMEOUT = 120_000;

/**
 * Thin fetch wrapper with a timeout and normalized error mapping.
 * Uses the Node global `fetch` (available in the extension host on modern Node).
 *
 * @returns parsed JSON or the raw text when the response is not JSON.
 */
export async function request<T = unknown>(
  url: string,
  opts: HttpOptions = {},
  parseJson = true
): Promise<T> {
  const { method = 'GET', headers = {}, body, signal, timeoutMs = DEFAULT_TIMEOUT } = opts;

  const controller = new AbortController();
  const onOuterAbort = () => controller.abort(signal?.reason);
  if (signal) {
    if (signal.aborted) {
      controller.abort(signal.reason);
    } else {
      signal.addEventListener('abort', onOuterAbort, { once: true });
    }
  }
  const timer = setTimeout(() => controller.abort(new Error('timeout')), timeoutMs);

  try {
    let res: Response;
    try {
      res = await fetch(url, { method, headers: { 'Content-Type': 'application/json', ...headers }, body, signal: controller.signal });
    } catch (err) {
      const e = err as { name?: string; message?: string; cause?: unknown };
      if (e?.name === 'AbortError' && controller.signal.aborted && e.message === 'timeout') {
        throw new ProviderError(`Request timed out after ${timeoutMs}ms`, 'timeout', true, err);
      }
      if (e?.name === 'AbortError') {
        throw new ProviderError('Request aborted', 'aborted', false, err);
      }
      // ECONNREFUSED etc.
      throw new ProviderError(`Could not reach ${new URL(url).host}: ${e?.message ?? 'connection error'}`, 'connection', true, err);
    }

    if (!res.ok) {
      const text = await safeText(res);
      const code = res.status === 401 || res.status === 403 ? 'auth' : res.status >= 500 ? 'server' : 'http_error';
      throw new ProviderError(`HTTP ${res.status} from provider: ${truncate(text, 300)}`, code, res.status >= 500, { status: res.status });
    }

    const raw = await res.text();
    if (!parseJson || raw.length === 0) {
      return raw as unknown as T;
    }
    try {
      return JSON.parse(raw) as T;
    } catch {
      return raw as unknown as T;
    }
  } finally {
    clearTimeout(timer);
    if (signal) {
      signal.removeEventListener('abort', onOuterAbort);
    }
  }
}

export async function* streamNdjson(
  url: string,
  opts: HttpOptions = {}
): AsyncGenerator<unknown, void, unknown> {
  const parseLine = opts.parseLine ?? ((line: string) => line);
  const controller = new AbortController();
  const onOuterAbort = () => controller.abort(opts.signal?.reason);
  if (opts.signal) {
    if (opts.signal.aborted) {
      controller.abort(opts.signal.reason);
    } else {
      opts.signal.addEventListener('abort', onOuterAbort, { once: true });
    }
  }

  let res: Response;
  try {
    res = await fetch(url, {
      method: opts.method ?? 'POST',
      headers: { 'Content-Type': 'application/json', ...opts.headers },
      body: opts.body,
      signal: controller.signal,
    });
  } catch (err) {
    const e = err as { name?: string; message?: string };
    if (e?.name === 'AbortError') {
      throw new ProviderError('Stream aborted', 'aborted', false, err);
    }
    throw new ProviderError(`Could not reach provider: ${e?.message ?? 'connection error'}`, 'connection', true, err);
  } finally {
    if (opts.signal) {
      opts.signal.removeEventListener('abort', onOuterAbort);
    }
  }

  if (!res.ok || !res.body) {
    const text = await safeText(res);
    throw new ProviderError(`HTTP ${res.status} while streaming: ${truncate(text, 300)}`, 'http_error', res.status >= 500);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      buffer += decoder.decode(value, { stream: true });
      let idx: number;
      while ((idx = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, idx).trim();
        buffer = buffer.slice(idx + 1);
        if (line.length > 0) {
          if (line === '[DONE]') {
            return;
          }
          try {
            yield parseLine(line);
          } catch (err) {
            throw new ProviderError(`Malformed stream frame: ${line.slice(0, 120)}`, 'parse', false, err);
          }
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

async function safeText(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    return '';
  }
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n) + '…' : s;
}
