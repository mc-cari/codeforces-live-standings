type Clock = () => number;
type Sleep = (milliseconds: number) => Promise<void>;
type DebugContext = Record<string, unknown>;
type DebugLogger = (message: string, context: DebugContext) => void;

export class RequestQueueCapacityError extends Error {
  constructor() {
    super('Codeforces request queue is full');
    this.name = 'RequestQueueCapacityError';
  }
}

export default class RequestCoordinator {
  private readonly inFlight = new Map<string, Promise<unknown>>();

  private startQueue: Promise<void> = Promise.resolve();

  private nextRequestAt = 0;

  private activeRequests = 0;

  private queuedRequests = 0;

  private nextRequestId = 1;

  private readonly minimumIntervalMilliseconds: number;

  private readonly now: Clock;

  private readonly sleep: Sleep;

  private readonly debugEnabled: boolean;

  private readonly debugLogger: DebugLogger;

  private readonly productionLoggingEnabled: boolean;

  private readonly warningLogger: DebugLogger;

  private readonly errorLogger: DebugLogger;

  private readonly slowRequestThresholdMilliseconds: number;

  private readonly maximumPendingRequests: number;

  constructor(
    minimumIntervalMilliseconds = 2_000,
    now: Clock = Date.now,
    sleep: Sleep = (milliseconds) => new Promise((resolve) => {
      setTimeout(resolve, milliseconds);
    }),
    debugEnabled = process.env.NODE_ENV === 'development',
    debugLogger: DebugLogger = console.debug,
    productionLoggingEnabled = process.env.NODE_ENV === 'production',
    warningLogger: DebugLogger = console.warn,
    errorLogger: DebugLogger = console.error,
    slowRequestThresholdMilliseconds = 30_000,
    maximumPendingRequests = 10,
  ) {
    this.minimumIntervalMilliseconds = minimumIntervalMilliseconds;
    this.now = now;
    this.sleep = sleep;
    this.debugEnabled = debugEnabled;
    this.debugLogger = debugLogger;
    this.productionLoggingEnabled = productionLoggingEnabled;
    this.warningLogger = warningLogger;
    this.errorLogger = errorLogger;
    this.slowRequestThresholdMilliseconds = slowRequestThresholdMilliseconds;
    this.maximumPendingRequests = maximumPendingRequests;
  }

  private debug(message: string, context: DebugContext) {
    if (this.debugEnabled) this.debugLogger(message, context);
  }

  run<Value>(key: string, request: () => Promise<Value>): Promise<Value> {
    const method = key.split('?')[0];
    const existing = this.inFlight.get(key) as Promise<Value> | undefined;
    if (existing) {
      this.debug('Codeforces request deduplicated.', {
        method,
        activeRequests: this.activeRequests,
        queuedRequests: this.queuedRequests,
      });
      return existing;
    }

    if (this.inFlight.size >= this.maximumPendingRequests) {
      this.debug('Codeforces request queue capacity reached.', {
        method,
        activeRequests: this.activeRequests,
        queuedRequests: this.queuedRequests,
      });
      return Promise.reject(new RequestQueueCapacityError());
    }

    const requestId = this.nextRequestId;
    this.nextRequestId += 1;
    const enqueuedAt = this.now();
    this.queuedRequests += 1;

    let resolveRequest: (value: Value | PromiseLike<Value>) => void;
    let rejectRequest: (reason?: unknown) => void;
    const scheduled = new Promise<Value>((resolve, reject) => {
      resolveRequest = resolve;
      rejectRequest = reject;
    });
    this.inFlight.set(key, scheduled);

    const start = this.startQueue.then(async () => {
      const wait = Math.max(0, this.nextRequestAt - this.now());
      if (wait > 0) await this.sleep(wait);
      this.nextRequestAt = this.now() + this.minimumIntervalMilliseconds;
      this.activeRequests += 1;
      this.queuedRequests -= 1;
      const startedAt = this.now();
      this.debug('Codeforces request started.', {
        requestId,
        method,
        queueWaitMilliseconds: startedAt - enqueuedAt,
        rateLimitWaitMilliseconds: wait,
        activeRequests: this.activeRequests,
        queuedRequests: this.queuedRequests,
      });

      Promise.resolve()
        .then(request)
        .then((value) => {
          const durationMilliseconds = this.now() - startedAt;
          this.debug('Codeforces request completed.', {
            requestId,
            method,
            durationMilliseconds,
            activeRequests: this.activeRequests,
            queuedRequests: this.queuedRequests,
          });
          if (this.productionLoggingEnabled
            && durationMilliseconds >= this.slowRequestThresholdMilliseconds) {
            this.warningLogger('Codeforces request completed slowly.', {
              requestId,
              method,
              durationMilliseconds,
              activeRequests: this.activeRequests,
              queuedRequests: this.queuedRequests,
            });
          }
          resolveRequest(value);
        }, (error) => {
          const durationMilliseconds = this.now() - startedAt;
          const context = {
            requestId,
            method,
            durationMilliseconds,
            activeRequests: this.activeRequests,
            queuedRequests: this.queuedRequests,
            error,
          };
          this.debug('Codeforces request failed.', context);
          if (this.productionLoggingEnabled) this.errorLogger('Codeforces request failed.', context);
          rejectRequest(error);
        })
        .finally(() => {
          this.activeRequests -= 1;
          this.inFlight.delete(key);
        });
    });

    this.startQueue = start.catch((error) => {
      this.queuedRequests -= 1;
      const context = {
        requestId,
        method,
        queueWaitMilliseconds: this.now() - enqueuedAt,
        activeRequests: this.activeRequests,
        queuedRequests: this.queuedRequests,
        error,
      };
      this.debug('Codeforces request failed before start.', context);
      if (this.productionLoggingEnabled) this.errorLogger('Codeforces request failed before start.', context);
      rejectRequest(error);
      this.inFlight.delete(key);
    });
    return scheduled;
  }
}
