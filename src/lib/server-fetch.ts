export const boundedServerFetch: typeof fetch = (input, init) => {
  const signals = [AbortSignal.timeout(3000)];
  if (init?.signal) signals.push(init.signal);
  if (input instanceof Request) signals.push(input.signal);
  return fetch(input, { ...init, signal: AbortSignal.any(signals) });
};
