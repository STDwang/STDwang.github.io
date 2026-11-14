/* =============================================================================
 * audio.js — 零素材程序化音频（WebAudio）
 * 原版依赖十几个 mp3 占位文件；这里全部用振荡器 / 噪声实时合成，
 * 既省掉资源请求，也能让打击音随伤害与阶段动态变化。
 * ========================================================================== */
(function (root) {
  'use strict';

  var ctx = null, master = null, ambience = null, muted = false, ready = false;

  function ensure() {
    if (ready) return true;
    var AC = root.AudioContext || root.webkitAudioContext;
    if (!AC) return false;
    try {
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = muted ? 0 : 0.55;
      master.connect(ctx.destination);
      ready = true;
    } catch (e) { return false; }
    return true;
  }

  function resume() {
    if (!ensure()) return;
    if (ctx.state === 'suspended') ctx.resume();
  }

  function env(node, t, attack, dur, peak) {
    var g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    node.connect(g);
    g.connect(master);
    return g;
  }

  function tone(opt) {
    if (!ready || muted) return;
    var t = ctx.currentTime + (opt.delay || 0);
    var o = ctx.createOscillator();
    o.type = opt.type || 'sine';
    o.frequency.setValueAtTime(opt.freq, t);
    if (opt.to) o.frequency.exponentialRampToValueAtTime(Math.max(20, opt.to), t + opt.dur);
    var f = null;
    if (opt.cutoff) {
      f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = opt.cutoff;
      o.connect(f);
      env(f, t, opt.attack || 0.006, opt.dur, opt.gain || 0.2);
    } else {
      env(o, t, opt.attack || 0.006, opt.dur, opt.gain || 0.2);
    }
    o.start(t);
    o.stop(t + opt.dur + 0.02);
  }

  var noiseBuf = null;
  function noise(opt) {
    if (!ready || muted) return;
    if (!noiseBuf) {
      var len = Math.floor(ctx.sampleRate * 1.2);
      noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
      var d = noiseBuf.getChannelData(0);
      for (var i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    }
    var t = ctx.currentTime + (opt.delay || 0);
    var src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    var f = ctx.createBiquadFilter();
    f.type = opt.filter || 'lowpass';
    f.frequency.setValueAtTime(opt.freq || 1400, t);
    if (opt.freqTo) f.frequency.exponentialRampToValueAtTime(opt.freqTo, t + opt.dur);
    f.Q.value = opt.q || 0.8;
    src.connect(f);
    env(f, t, opt.attack || 0.004, opt.dur, opt.gain || 0.2);
    src.start(t);
    src.stop(t + opt.dur + 0.02);
  }

  var SFX = {
    ui: function () { tone({ freq: 520, to: 760, dur: 0.09, gain: 0.10, type: 'triangle' }); },
    start: function () {
      tone({ freq: 220, to: 440, dur: 0.42, gain: 0.16, type: 'triangle' });
      tone({ freq: 330, to: 660, dur: 0.48, gain: 0.10, type: 'sine', delay: 0.06 });
    },
    swing: function () {
      noise({ freq: 2600, freqTo: 500, dur: 0.16, gain: 0.13, filter: 'bandpass', q: 1.1 });
    },
    hit: function () {
      noise({ freq: 2200, freqTo: 300, dur: 0.15, gain: 0.30 });
      tone({ freq: 180, to: 70, dur: 0.16, gain: 0.26, type: 'square', cutoff: 900 });
      tone({ freq: 880, to: 1320, dur: 0.09, gain: 0.09, type: 'triangle' });
    },
    bigHit: function () {
      noise({ freq: 3200, freqTo: 220, dur: 0.26, gain: 0.38 });
      tone({ freq: 140, to: 48, dur: 0.30, gain: 0.34, type: 'sawtooth', cutoff: 700 });
      tone({ freq: 660, to: 990, dur: 0.18, gain: 0.12, type: 'triangle', delay: 0.02 });
    },
    dodge: function () {
      noise({ freq: 900, freqTo: 2600, dur: 0.20, gain: 0.12, filter: 'bandpass', q: 0.7 });
    },
    perfect: function () {
      tone({ freq: 1046, dur: 0.16, gain: 0.16, type: 'sine' });
      tone({ freq: 1568, dur: 0.24, gain: 0.13, type: 'sine', delay: 0.07 });
      tone({ freq: 2093, dur: 0.30, gain: 0.09, type: 'sine', delay: 0.13 });
      noise({ freq: 5200, freqTo: 1800, dur: 0.22, gain: 0.07, filter: 'highpass' });
    },
    hurt: function () {
      noise({ freq: 700, freqTo: 160, dur: 0.24, gain: 0.25 });
      tone({ freq: 130, to: 62, dur: 0.26, gain: 0.22, type: 'sawtooth', cutoff: 600 });
    },
    warn: function () {
      tone({ freq: 320, to: 240, dur: 0.26, gain: 0.11, type: 'triangle' });
      tone({ freq: 160, to: 120, dur: 0.30, gain: 0.09, type: 'sine' });
    },
    cast: function () {
      tone({ freq: 90, to: 190, dur: 0.55, gain: 0.14, type: 'sawtooth', cutoff: 520 });
      noise({ freq: 400, freqTo: 1800, dur: 0.48, gain: 0.07, filter: 'bandpass' });
    },
    slam: function () {
      noise({ freq: 1600, freqTo: 90, dur: 0.42, gain: 0.34 });
      tone({ freq: 100, to: 36, dur: 0.44, gain: 0.30, type: 'square', cutoff: 400 });
    },
    charge: function () {
      noise({ freq: 300, freqTo: 2400, dur: 0.40, gain: 0.17, filter: 'bandpass' });
    },
    drink: function () {
      tone({ freq: 420, to: 700, dur: 0.28, gain: 0.11, type: 'sine' });
      tone({ freq: 630, to: 1050, dur: 0.32, gain: 0.08, type: 'sine', delay: 0.08 });
    },
    break: function () {
      tone({ freq: 740, to: 220, dur: 0.60, gain: 0.20, type: 'triangle' });
      noise({ freq: 3000, freqTo: 300, dur: 0.55, gain: 0.22 });
      tone({ freq: 1320, to: 660, dur: 0.45, gain: 0.10, type: 'sine', delay: 0.10 });
    },
    phase: function () {
      tone({ freq: 110, to: 220, dur: 0.85, gain: 0.18, type: 'sawtooth', cutoff: 620 });
      tone({ freq: 330, to: 494, dur: 0.70, gain: 0.10, type: 'sine', delay: 0.12 });
    },
    win: function () {
      [523, 659, 784, 1046].forEach(function (f, i) {
        tone({ freq: f, dur: 0.55, gain: 0.13, type: 'triangle', delay: i * 0.13 });
        tone({ freq: f * 2, dur: 0.40, gain: 0.05, type: 'sine', delay: i * 0.13 + 0.02 });
      });
    },
    lose: function () {
      [392, 349, 294, 220].forEach(function (f, i) {
        tone({ freq: f, dur: 0.55, gain: 0.13, type: 'triangle', delay: i * 0.16 });
      });
      tone({ freq: 70, to: 42, dur: 1.20, gain: 0.13, type: 'sine' });
    },
    heartbeat: function () {
      tone({ freq: 62, to: 44, dur: 0.16, gain: 0.16, type: 'sine' });
      tone({ freq: 58, to: 40, dur: 0.18, gain: 0.12, type: 'sine', delay: 0.20 });
    },
  };

  /* 氛围低音：随阶段改变和声，避免一成不变的背景噪音 */
  var AMB_CHORDS = [
    [55.0, 82.4, 110.0],   // Am 低沉
    [58.3, 87.3, 116.5],   // Bb 偏暖
    [49.0, 73.4, 98.0],    // G 更暗
  ];
  function startAmbience(phase) {
    if (!ensure() || ambience) return;
    var idx = Math.min(2, phase || 0);
    var chord = AMB_CHORDS[idx];
    var bus = ctx.createGain();
    bus.gain.value = 0.0001;
    bus.connect(master);
    bus.gain.exponentialRampToValueAtTime(0.075, ctx.currentTime + 1.2);
    var oscs = [];
    chord.forEach(function (f, i) {
      var o = ctx.createOscillator();
      o.type = i === 0 ? 'sine' : 'triangle';
      o.frequency.value = f;
      var g = ctx.createGain();
      g.gain.value = i === 0 ? 0.55 : 0.22;
      o.connect(g); g.connect(bus);
      o.start();
      oscs.push(o);
    });
    var lfo = ctx.createOscillator();
    lfo.frequency.value = 0.11;
    var lfoGain = ctx.createGain();
    lfoGain.gain.value = 0.028;
    lfo.connect(lfoGain); lfoGain.connect(bus.gain);
    lfo.start();
    ambience = { bus: bus, oscs: oscs, lfo: lfo };
  }
  function setAmbiencePhase(phase) {
    if (!ambience || !ready) return;
    var chord = AMB_CHORDS[Math.min(2, phase || 0)];
    ambience.oscs.forEach(function (o, i) {
      o.frequency.exponentialRampToValueAtTime(chord[i], ctx.currentTime + 1.4);
    });
  }
  function stopAmbience() {
    if (!ambience || !ready) return;
    var a = ambience;
    ambience = null;
    try {
      a.bus.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.5);
      setTimeout(function () {
        a.oscs.forEach(function (o) { try { o.stop(); } catch (e) {} });
        try { a.lfo.stop(); } catch (e) {}
      }, 700);
    } catch (e) {}
  }

  function setMuted(v) {
    muted = !!v;
    if (ready) master.gain.setTargetAtTime(muted ? 0 : 0.55, ctx.currentTime, 0.03);
  }
  function isMuted() { return muted; }

  function play(name) {
    if (!ensure() || muted) return;
    var fn = SFX[name];
    if (fn) fn();
  }

  root.BFF = root.BFF || {};
  root.BFF.Audio = {
    resume: resume, play: play, setMuted: setMuted, isMuted: isMuted,
    startAmbience: startAmbience, setAmbiencePhase: setAmbiencePhase, stopAmbience: stopAmbience,
  };
})(window);
