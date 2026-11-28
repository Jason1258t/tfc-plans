/** Локальный control API через Unix socket; ожидание держит один запрос, не опрашивает журнал. */
import http from 'node:http';
export function workerRequest(
  socketPath,
  { method = 'GET', path = '/health', body = null, timeoutSeconds = 30, signal } = {},
) {
  if (!Number.isFinite(timeoutSeconds) || timeoutSeconds < 0 || timeoutSeconds > 3700)
    throw new Error('Некорректный timeout запроса worker');
  return new Promise((resolve, reject) => {
    const data = body === null ? null : Buffer.from(JSON.stringify(body));
    const request = http.request(
      {
        signal,
        socketPath,
        path,
        method,
        headers: data ? { 'Content-Type': 'application/json', 'Content-Length': data.length } : {},
      },
      (response) => {
        response.setEncoding('utf8');
        let received = '',
          bytes = 0;
        response.on('data', (chunk) => {
          bytes += Buffer.byteLength(chunk);
          if (bytes > 16 * 1024 * 1024) {
            request.destroy(new Error('Ответ worker слишком большой'));
            return;
          }
          received += chunk.toString('utf8');
        });
        response.on('error', reject);
        response.on('end', () => {
          try {
            const result = JSON.parse(received);
            if (response.statusCode !== 200) reject(new Error(result.error ?? `Worker: HTTP ${response.statusCode}`));
            else resolve(result);
          } catch (error) {
            reject(error);
          }
        });
      },
    );
    request.on('error', reject);
    const timer = setTimeout(
      () => request.destroy(new Error('Истекло время ожидания ответа worker')),
      (timeoutSeconds + 10) * 1000,
    );
    request.on('close', () => clearTimeout(timer));
    request.end(data);
  });
}
