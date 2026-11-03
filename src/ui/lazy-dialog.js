// Cache one optional dialog instance; failed imports remain retryable.
export function lazyDialog(create) {
  let pending;
  return (...args) => {
    pending ||= Promise.resolve().then(create).catch(error => {
      pending = null;
      throw error;
    });
    return pending.then(dialog => dialog.open(...args));
  };
}
