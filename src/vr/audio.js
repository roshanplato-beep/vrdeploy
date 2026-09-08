export function createAudio() {
  let context, master, ambience;
  let enabled = false;
  const enable = () => {
    if (!context) {
      context = new (window.AudioContext || window.webkitAudioContext)();
      master = context.createGain();
      master.gain.value = 0.045;
      master.connect(context.destination);
      ambience = context.createGain();
      ambience.gain.value = 0;
      ambience.connect(master);
      for (const freq of [110, 164.81, 220]) {
        const o = context.createOscillator();
        o.frequency.value = freq;
        o.connect(ambience);
        o.start();
      }
    }
    context.resume().catch(() => {});
    enabled = true;
    master.gain.value = 0.045;
    ambience.gain.setTargetAtTime(0.06, context.currentTime, 0.5);
  };
  return {
    enable,
    toggle() {
      if (!enabled) {
        enable();
        return true;
      }
      enabled = false;
      master.gain.setValueAtTime(0, context.currentTime);
      return false;
    },
    ping() {
      if (!enabled || !context) return;
      master.gain.value = 0.045;
      const o = context.createOscillator(),
        g = context.createGain();
      o.connect(g);
      g.connect(master);
      o.frequency.setValueAtTime(680, context.currentTime);
      o.frequency.exponentialRampToValueAtTime(320, context.currentTime + 0.16);
      g.gain.setValueAtTime(0.6, context.currentTime);
      g.gain.exponentialRampToValueAtTime(0.001, context.currentTime + 0.2);
      o.start();
      o.stop(context.currentTime + 0.21);
    },
    dispose() {
      context?.close();
    },
  };
}
