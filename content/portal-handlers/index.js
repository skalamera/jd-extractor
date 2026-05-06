// Portal detection router
const PortalHandlers = {
  handlers: [],

  register(handler) {
    this.handlers.push(handler);
  },

  detect() {
    const url = window.location.href;
    for (const handler of this.handlers) {
      if (handler.detect(url)) {
        console.log(`[JobAutoFill] Detected portal: ${handler.name}`);
        return handler;
      }
    }
    console.log('[JobAutoFill] No specific portal detected, using generic handler');
    return null; // will fall back to generic
  }
};
