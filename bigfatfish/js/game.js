/* =============================================================================
 * game.js — 主循环 / 状态机 / 输入 / 战斗 / UI
 *
 * 重构要点（对照原版 main.lua 109KB 单文件）：
 *  · 拆成 config / audio / storage / art / characters / game 六层，数值全部外置。
 *  · 用「架势→失衡」替代 5 种随机掉落，把输出窗口做成可学习、可预期的正反馈。
 *  · 完美闪避给实质收益，让读招成为最优解而非可选项。
 *  · Boss 三阶段 + 加权招式选择 + 距离过滤，替代固定间隙的随机出题。
 * ========================================================================== */
(function (root) {
  'use strict';
  var C = root.BFF.CONFIG, A = root.BFF.Art, CH = root.BFF.Characters;
  var AU = root.BFF.Audio, ST = root.BFF.Storage;
  var clamp = A.clamp, lerp = A.lerp;

  var canvas, ctx;
  var D = {};                       // DOM 缓存
  var save = ST.load();
  var keys = {};
  var joy = { active: false, id: null, x: 0, y: 0 };
  var lastTs = 0;

  var g = {
    mode: 'title',                 // title | fight | pause | result | help
    helpFrom: 'title',
    clock: 0, time: 0, camX: 0,
    hitstop: 0, shake: 0, flash: 0,
    difficulty: 'normal', diff: null,
    player: null, boss: null,
    particles: [], floaters: [], afterimages: [], dust: [],
    stats: null,
    bannerTimer: 0, tipTimer: 0, tipIndex: 0,
    heartTimer: 0,
    phaseT: 1,
    resultShown: false,
    firstWindupSeen: false,
    resultTimer: 0, tipDelayTimer: 0,
  };

  /* =======================================================================
   * 初始化
   * ==================================================================== */
  function $(id) { return document.getElementById(id); }

  function cacheDom() {
    ['game', 'stage', 'hud', 'screenTitle', 'screenPause', 'screenResult', 'screenHelp',
     'hpFill', 'hpGhost', 'hpText', 'stFill', 'flaskRow', 'phaseBadge', 'phaseName',
     'bossFill', 'bossGhost', 'postureFill', 'bossStatus', 'timer', 'perfectCount',
     'warnCenter', 'warnLabel', 'warnHint', 'warnBar', 'banner', 'skillbar', 'tip',
     'toastStack', 'joystick', 'joyKnob', 'difficulty', 'bestTime', 'winCount', 'achCount',
     'resultEyebrow', 'resultTitle', 'resultDesc', 'resultTime', 'statPerfect', 'statHits',
     'statFlask', 'statBreak', 'resultBadges', 'rotateHint', 'btnMute'
    ].forEach(function (id) { D[id] = $(id); });
    canvas = D.game;
    ctx = canvas.getContext('2d', { alpha: false });
  }

  function resize() {
    var vw = root.innerWidth, vh = root.innerHeight;
    var s = Math.min(vw / C.VIEW.W, vh / C.VIEW.H);
    D.stage.style.transform = 'scale(' + s + ')';
    var portrait = vh > vw * 1.15 && vw < 720;
    D.rotateHint.classList.toggle('hidden', !portrait);
  }

  function isTouch() {
    return ('ontouchstart' in root) || (navigator.maxTouchPoints > 0);
  }

  function buildUI() {
    // 难度
    D.difficulty.innerHTML = '';
    Object.keys(C.DIFFICULTIES).forEach(function (k) {
      var d = C.DIFFICULTIES[k];
      var b = document.createElement('button');
      b.className = 'diff-btn' + (k === g.difficulty ? ' active' : '');
      b.innerHTML = d.label + '<small>' + d.sub + '</small>';
      b.onclick = function () {
        g.difficulty = k;
        ST.set({ difficulty: k });
        AU.play('ui');
        buildUI();
      };
      D.difficulty.appendChild(b);
    });

    // 技能栏（含药瓶）
    D.skillbar.innerHTML = '';
    var flask = document.createElement('button');
    flask.className = 'skill flask-skill';
    flask.dataset.skill = 'flask';
    flask.innerHTML = '<span class="skill-cd"></span><span class="skill-inner">' +
      '<span class="skill-icon" style="color:#ff9aa8">✚</span>' +
      '<span class="skill-label">喝药</span><span class="skill-key">R</span></span>';
    D.skillbar.appendChild(flask);

    C.SKILL_ORDER.forEach(function (key) {
      var s = C.SKILLS[key];
      var b = document.createElement('button');
      b.className = 'skill' + (key === 'spin' ? ' big' : '');
      b.dataset.skill = key;
      b.innerHTML = '<span class="skill-cd"></span><span class="skill-inner">' +
        '<span class="skill-icon" style="color:' + s.color + '">' + s.icon + '</span>' +
        '<span class="skill-label">' + s.label + '</span>' +
        '<span class="skill-key">' + s.key + '</span></span>' +
        '<span class="skill-cd-text"></span>';
      D.skillbar.appendChild(b);
    });

    Array.prototype.forEach.call(D.skillbar.querySelectorAll('.skill'), function (b) {
      b.addEventListener('pointerdown', function (e) {
        e.preventDefault();
        AU.resume();
        if (g.mode !== 'fight') return;
        var k = b.dataset.skill;
        if (k === 'flask') tryFlask(); else trySkill(k);
      });
    });

    // 药瓶图标
    refreshFlasks();

    // 标题页数据
    var s = ST.load();
    D.bestTime.textContent = ST.formatTime(s.bestMs);
    D.winCount.textContent = s.wins + ' 胜 / ' + s.runs + ' 局';
    D.achCount.textContent = Object.keys(s.achievements).length + ' / ' + C.ACHIEVEMENTS.length;
    D.btnMute.textContent = AU.isMuted() ? '♩' : '♪';
  }

  function bindEvents() {
    root.addEventListener('resize', resize);
    root.addEventListener('orientationchange', function () { setTimeout(resize, 150); });

    document.addEventListener('keydown', function (e) {
      var k = e.key.toLowerCase();
      if ([' ', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].indexOf(k) >= 0) e.preventDefault();
      if (e.repeat) return;
      keys[k] = true;
      AU.resume();

      if (k === 'escape') {
        if (g.mode === 'help') closeHelp();
        else if (g.mode === 'fight') pauseGame();
        else if (g.mode === 'pause') resumeGame();
        return;
      }
      if (k === 'h') { if (g.mode === 'help') closeHelp(); else openHelp(); return; }
      if (k === 'm') { toggleMute(); return; }
      if (g.mode !== 'fight') {
        if ((k === 'enter' || k === ' ') && g.mode === 'title') startFight();
        else if ((k === 'enter' || k === ' ') && g.mode === 'result') retry();
        return;
      }
      if (k === 'j') trySkill('punch');
      else if (k === 'k') trySkill('tail');
      else if (k === 'l') trySkill('spin');
      else if (k === ' ') trySkill('dodge');
      else if (k === 'r') tryFlask();
    });
    document.addEventListener('keyup', function (e) { keys[e.key.toLowerCase()] = false; });
    root.addEventListener('blur', function () { keys = {}; });

    $('btnStart').onclick = function () { AU.resume(); startFight(); };
    $('btnTitleHelp').onclick = function () { AU.resume(); openHelp(); };
    $('btnPauseHelp').onclick = function () { openHelp(); };
    $('btnHelpClose').onclick = closeHelp;
    $('btnResume').onclick = resumeGame;
    $('btnQuit').onclick = function () { AU.play('ui'); gotoTitle(); };
    $('btnRetry').onclick = function () { AU.resume(); retry(); };
    $('btnBackTitle').onclick = function () { AU.play('ui'); gotoTitle(); };
    $('btnPause').onclick = pauseGame;
    $('btnHelp').onclick = openHelp;
    $('btnMute').onclick = toggleMute;

    // 虚拟摇杆
    var base = D.joystick.querySelector('.joy-base');
    base.addEventListener('pointerdown', function (e) {
      e.preventDefault(); AU.resume();
      joy.active = true; joy.id = e.pointerId;
      base.setPointerCapture(e.pointerId);
      updateJoy(e);
    });
    base.addEventListener('pointermove', function (e) {
      if (joy.active && e.pointerId === joy.id) { e.preventDefault(); updateJoy(e); }
    });
    function endJoy(e) {
      if (e.pointerId !== joy.id) return;
      joy.active = false; joy.x = 0; joy.y = 0;
      D.joyKnob.style.transform = 'translate(0px, 0px)';
    }
    base.addEventListener('pointerup', endJoy);
    base.addEventListener('pointercancel', endJoy);
  }

  function updateJoy(e) {
    var r = e.currentTarget.getBoundingClientRect();
    var scale = D.stage.getBoundingClientRect().width / C.VIEW.W || 1;
    var cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    var dx = (e.clientX - cx) / scale, dy = (e.clientY - cy) / scale;
    var len = Math.hypot(dx, dy), max = 46;
    if (len > max) { dx = dx / len * max; dy = dy / len * max; }
    joy.x = clamp(dx / max, -1, 1);
    joy.y = clamp(dy / max, -1, 1);
    D.joyKnob.style.transform = 'translate(' + dx + 'px, ' + dy + 'px)';
  }

  /* =======================================================================
   * 场景对象
   * ==================================================================== */
  function makePlayer() {
    return {
      x: -2.6, z: C.WORLD.playerStartZ,
      hp: C.PLAYER.maxHp, stamina: C.PLAYER.staminaMax,
      flasks: C.PLAYER.flasks, flasksUsed: 0,
      state: 'idle', t: 0, dur: 0, skill: null,
      facing: 1, cd: {}, staminaLock: 0,
      invuln: 0, focus: 0, flash: 0, burn: 0, burnDps: 0,
      dodgeX: 0, dodgeZ: 1, hitDone: false,
      moving: false,
    };
  }
  function makeBoss() {
    return {
      x: 0, z: C.WORLD.bossStartZ,
      hp: 0, maxHp: 0, posture: 0, phase: 0,
      state: 'idle', t: 0, dur: 0, skill: null,
      windup: 0, aimX: 0, aimZ: 0, dirX: 0, dirZ: 1,
      gap: 1.4, cds: {}, lastSkill: null, hasHit: false,
      flash: 0, facing: 1, staggeredBy: 0,
    };
  }

  function createEntities() {
    g.player = makePlayer();
    g.boss = makeBoss();
    g.boss.maxHp = C.DIFFICULTIES[g.difficulty].bossHp;
    g.boss.hp = g.boss.maxHp;
    g.stats = { perfect: 0, hitsTaken: 0, flasksUsed: 0, breaks: 0, damage: 0 };
  }

  function initDust() {
    g.dust = [];
    for (var i = 0; i < 44; i++) {
      g.dust.push({
        x: (Math.random() * 2 - 1) * C.WORLD.halfW,
        z: (Math.random() * 2 - 1) * C.WORLD.halfZ,
        y: 0.3 + Math.random() * 3.2,
        vy: 0.10 + Math.random() * 0.22,
        vx: (Math.random() * 2 - 1) * 0.16,
        size: 1 + Math.random() * 2.1,
        alpha: 0.12 + Math.random() * 0.35,
      });
    }
  }

  /* =======================================================================
   * 流程控制
   * ==================================================================== */
  function showScreen(id) {
    ['screenTitle', 'screenPause', 'screenResult', 'screenHelp'].forEach(function (s) {
      D[s].classList.toggle('hidden', s !== id);
    });
    var hideHud = id === 'screenTitle' || g.mode === 'title' ||
      (id === 'screenHelp' && g.helpFrom === 'title');
    D.hud.classList.toggle('hidden', hideHud);
  }

  function gotoTitle() {
    if (g.resultTimer) { clearTimeout(g.resultTimer); g.resultTimer = 0; }
    if (g.tipDelayTimer) { clearTimeout(g.tipDelayTimer); g.tipDelayTimer = 0; }
    g.mode = 'title';
    g.time = 0; g.hitstop = 0; g.shake = 0; g.flash = 0;
    g.particles = []; g.floaters = []; g.afterimages = [];
    AU.stopAmbience();
    createEntities();
    buildUI();
    g.camX = -4.6;                 // 标题页把角色让到画面右侧，别压住标题文字
    showScreen('screenTitle');
  }

  function startFight() {
    if (g.resultTimer) { clearTimeout(g.resultTimer); g.resultTimer = 0; }
    if (g.tipDelayTimer) { clearTimeout(g.tipDelayTimer); g.tipDelayTimer = 0; }
    g.difficulty = ST.load().difficulty || 'normal';
    g.diff = C.DIFFICULTIES[g.difficulty];
    createEntities();
    initDust();
    g.mode = 'fight';
    g.time = 0; g.hitstop = 0; g.shake = 0; g.flash = 0; g.camX = 0;
    g.bannerTimer = 0; g.tipIndex = 0; g.tipTimer = 0; g.phaseT = 1;
    g.firstWindupSeen = false; g.resultShown = false; g.heartTimer = 0;
    g.particles = []; g.floaters = []; g.afterimages = [];
    keys = {};
    AU.resume(); AU.play('start'); AU.startAmbience(0);
    showScreen(null);
    banner('菲比 · PHOEBE', '第一幕 · 试探', 1.35);
    // 教学提示错开开场字幕，避免三层 UI 同时压在画面上
    if (g.tipDelayTimer) clearTimeout(g.tipDelayTimer);
    g.tipDelayTimer = setTimeout(function () {
      g.tipDelayTimer = 0;
      if (g.mode === 'fight' && !g.resultShown) showTip(C.TIPS[0], 5.0);
    }, 1700);
    document.body.classList.remove('lowhp');
    refreshFlasks();
  }

  function retry() { startFight(); }

  function pauseGame() {
    if (g.mode !== 'fight') return;
    g.mode = 'pause'; AU.play('ui'); showScreen('screenPause');
  }
  function resumeGame() {
    if (g.mode !== 'pause') return;
    g.mode = 'fight'; AU.play('ui'); showScreen(null);
  }
  function openHelp() {
    if (g.mode === 'help') return;
    g.helpFrom = g.mode;
    g.mode = 'help'; AU.play('ui'); showScreen('screenHelp');
  }
  function closeHelp() {
    if (g.mode !== 'help') return;
    g.mode = g.helpFrom; AU.play('ui');
    showScreen(g.mode === 'pause' ? 'screenPause' : (g.mode === 'title' ? 'screenTitle' : null));
  }
  function toggleMute() {
    AU.setMuted(!AU.isMuted());
    ST.set({ muted: AU.isMuted() });
    D.btnMute.textContent = AU.isMuted() ? '♩' : '♪';
  }

  /* =======================================================================
   * 玩家操作
   * ==================================================================== */
  function canAct() {
    var p = g.player;
    return p.state === 'idle' || (p.state === 'attack' && p.t > p.dur * 0.62);
  }

  function trySkill(key) {
    var p = g.player, s = C.SKILLS[key];
    if (!s || g.mode !== 'fight' || p.state === 'dead') return;
    if (!canAct()) return;
    if (p.cd[key] > 0) return;
    if (p.stamina < s.stamina) { toast('耐力不足'); return; }

    p.stamina -= s.stamina;
    p.staminaLock = C.PLAYER.staminaDelay;
    p.cd[key] = s.cd;
    p.skill = key;
    p.hitDone = false;

    if (key === 'dodge') {
      var mv = inputVector();
      var len = Math.hypot(mv.x, mv.z);
      if (len > 0.05) { p.dodgeX = mv.x / len; p.dodgeZ = mv.z / len; }
      else {
        var dx = g.boss.x - p.x, dz = g.boss.z - p.z;
        var dl = Math.hypot(dx, dz) || 1;
        p.dodgeX = -dx / dl; p.dodgeZ = -dz / dl;   // 没方向输入就往远离 Boss 滚
      }
      p.state = 'dodge'; p.dur = s.time; p.t = 0;
      p.invuln = s.invuln;
      AU.play('dodge');
      spawnBurst(p.x, p.z, 0.4, 10, '#8fd8ff', 'dust', 0.5);
    } else {
      p.state = 'attack'; p.dur = s.windup + s.active + s.recover; p.t = 0;
      faceBoss();
      AU.play('swing');
      if (key === 'spin') spawnRing(p.x, p.z, '#ffd166');
    }
  }

  function tryFlask() {
    var p = g.player;
    if (g.mode !== 'fight' || p.flasks <= 0 || !canAct() || p.hp >= C.PLAYER.maxHp) return;
    // 优化：药瓶只在「喝完」时消耗。被打断损失的是 1 秒窗口与站位，
    // 不再额外罚没道具，避免低血时越喝越绝望的负反馈叠加。
    p.state = 'drink'; p.dur = C.PLAYER.flaskWindup; p.t = 0;
    AU.play('drink');
    toast('喝药中 · 别被打断');
  }

  function faceBoss() {
    var p = g.player, b = g.boss;
    var dx = b.x - p.x, dz = b.z - p.z;
    var ang = Math.atan2(dz, dx);
    p.facing = Math.cos(ang) >= 0 ? 1 : -1;
    p.aim = ang;
  }

  function inputVector() {
    var x = 0, z = 0;
    if (keys['a'] || keys['arrowleft']) x -= 1;
    if (keys['d'] || keys['arrowright']) x += 1;
    if (keys['w'] || keys['arrowup']) z -= 1;
    if (keys['s'] || keys['arrowdown']) z += 1;
    if (joy.active) { x += joy.x; z += joy.y; }
    var len = Math.hypot(x, z);
    if (len > 1) { x /= len; z /= len; }
    return { x: x, z: z, len: Math.min(1, len) };
  }

  /* =======================================================================
   * 战斗判定
   * ==================================================================== */
  function dist2(ax, az, bx, bz) { return Math.hypot(ax - bx, az - bz); }

  function doPlayerHit(key) {
    var p = g.player, b = g.boss, s = C.SKILLS[key];
    var d = dist2(p.x, p.z, b.x, b.z);
    var reach = s.range + C.BOSS.radius * 0.55;
    if (d > reach) {                     // 挥空：保留收招后摇，不能乱按
      spawnBurst(p.x + Math.cos(p.aim || 0) * 1.6, p.z + Math.sin(p.aim || 0) * 1.6, 0.8, 5, '#9fb8d0', 'dust', 0.35);
      return;
    }
    var ang = Math.atan2(b.z - p.z, b.x - p.x);
    var diff = Math.abs(Math.atan2(Math.sin(ang - (p.aim || 0)), Math.cos(ang - (p.aim || 0))));
    if (s.arc < 360 && diff > (s.arc * Math.PI / 180) / 2) return;

    var focusUsed = p.focus > 0;
    var mul = 1;
    if (focusUsed) { mul *= C.FOCUS.dmgMul; p.focus = 0; }
    if (b.state === 'broken') mul *= C.POSTURE.breakDmgMul;
    var dmg = Math.round(s.dmg * mul);
    b.hp = Math.max(0, b.hp - dmg);
    g.stats.damage += dmg;

    addPosture(s.posture + (focusUsed ? C.FOCUS.postureBonus : 0));
    b.flash = 1;
    spawnBurst(b.x, b.z, 1.8, key === 'spin' ? 26 : 14, focusUsed ? '#8fe8ff' : '#ffd166', 'spark', 0.5);
    spawnRing(b.x, b.z, focusUsed ? '#8fe8ff' : '#ffcf7a');
    floater(b.x, b.z, String(dmg), focusUsed ? '#a8f0ff' : '#ffe6a8', focusUsed ? 42 : 32);
    if (focusUsed) { toast('鱼跃时机 · 伤害 ×2'); AU.play('bigHit'); }
    else AU.play(key === 'punch' ? 'hit' : (key === 'spin' ? 'bigHit' : 'hit'));
    hitstop(s.hitstop); shakeIt(s.shake);

    if (s.stagger || focusUsed) {
      if (b.state !== 'broken' && b.hp > 0) {
        b.state = 'stagger'; b.t = 0; b.dur = C.BOSS.staggerTime;
        b.skill = null;
      }
    }
    if (key === 'punch') {
      p.stamina = Math.min(C.PLAYER.staminaMax, p.stamina + s.staminaGain);
      p.staminaLock = 0;
    }
    checkPhase();
    if (b.hp <= 0 && !g.resultShown) endFight(true);
  }

  function addPosture(v) {
    var b = g.boss;
    if (b.state === 'broken') return;
    b.posture = Math.min(C.POSTURE.max, b.posture + v);
    if (b.posture >= C.POSTURE.max) breakBoss();
  }

  function breakBoss() {
    var b = g.boss;
    if (b.state === 'broken') return;
    b.state = 'broken'; b.t = 0; b.dur = C.POSTURE.breakTime;
    b.skill = null; b.hasHit = false;
    b.posture = C.POSTURE.max;
    g.stats.breaks += 1;
    AU.play('break');
    banner('失衡 · 跪地', '架势条打满 · 自由输出窗口', 1.7, true);
    spawnBurst(b.x, b.z, 2.2, 34, '#ffe08a', 'spark', 0.8);
    spawnRing(b.x, b.z, '#ffe08a');
    hitstop(0.12); shakeIt(20);
  }

  function checkPhase() {
    var b = g.boss;
    var ratio = b.hp / b.maxHp;
    var target = 0;
    for (var i = C.PHASES.length - 1; i >= 0; i--) {
      if (ratio <= C.PHASES[i].from) { target = i; break; }
    }
    if (target > b.phase) {
      b.phase = target;
      var ph = C.PHASES[target];
      g.phaseT = 0;
      b.state = 'stagger'; b.t = 0; b.dur = 0.75; b.skill = null;
      AU.play('phase');
      AU.setAmbiencePhase(target);
      banner(ph.name, ph.line, 2.2, true);
      spawnBurst(b.x, b.z, 2.4, 40, ph.glow, 'spark', 1.0);
      spawnRing(b.x, b.z, ph.glow);
      shakeIt(24);
      D.phaseBadge.textContent = ph.short;
      D.phaseName.textContent = ph.name;
    }
  }

  function damagePlayer(base, source) {
    var p = g.player, b = g.boss;
    if (p.state === 'dead' || g.resultShown) return;

    if (p.invuln > 0) {              // 完美闪避：贴着攻击滚过去
      perfectDodge();
      return;
    }

    var mul = g.diff.dmgMul * C.PHASES[b.phase].atkMul;
    var dmg = Math.round(base * mul);
    p.hp = Math.max(0, p.hp - dmg);
    g.stats.hitsTaken += 1;
    p.flash = 1;
    p.staminaLock = 0.6;

    if (p.state === 'drink') {
      p.state = 'hurt'; p.t = 0; p.dur = C.PLAYER.hurtStun;
      toast('喝药被打断 · 药还在，重新找空档');
    } else {
      p.state = 'hurt'; p.t = 0; p.dur = C.PLAYER.hurtStun;
    }
    AU.play('hurt');
    hitstop(C.FEEL.hitstopTaken); shakeIt(C.FEEL.shakeTaken);
    spawnBurst(p.x, p.z, 1.2, 16, '#ff8a95', 'spark', 0.5);
    floater(p.x, p.z, '-' + dmg, '#ff9aa8', 30);
    g.flash = 0.55;

    if (source === 'burn') { p.burn = 5.0; p.burnDps = C.BOSS_SKILLS.burn.burnDps; }
    if (p.hp <= 0 && !g.resultShown) endFight(false);
  }

  function perfectDodge() {
    var p = g.player;
    g.stats.perfect += 1;
    p.focus = C.FOCUS.time;
    p.stamina = Math.min(C.PLAYER.staminaMax, p.stamina + C.FOCUS.staminaBack);
    addPosture(C.POSTURE.perfectGain);
    AU.play('perfect');
    hitstop(C.FEEL.hitstopPerfect);
    floater(p.x, p.z, '完美闪避', '#a8f0ff', 28);
    spawnBurst(p.x, p.z, 1.2, 18, '#a8f0ff', 'spark', 0.6);
    spawnRing(p.x, p.z, '#a8f0ff');
    toast('鱼跃时机！下次攻击 ×2 且必定硬直');
    if (!g.firstWindupSeen) { g.firstWindupSeen = true; showTip(C.TIPS[2], 4.2); }
  }

  /* =======================================================================
   * Boss AI
   * ==================================================================== */
  function pickBossSkill(d) {
    var b = g.boss, phase = b.phase, pool = [];
    Object.keys(C.BOSS_SKILLS).forEach(function (k) {
      var s = C.BOSS_SKILLS[k];
      if (s.phase > phase + 1) return;              // phase 是 0-based
      if ((b.cds[k] || 0) > 0) return;
      if (k === 'swipe' && d > C.BOSS_SKILLS.swipe.range + 2.2) return;
      if (k === 'charge' && d < 3.4) return;
      var w = s.weight * (k === b.lastSkill ? 0.35 : 1);
      pool.push({ k: k, w: w });
    });
    if (!pool.length) return null;
    var total = 0; pool.forEach(function (o) { total += o.w; });
    var r = Math.random() * total;
    for (var i = 0; i < pool.length; i++) {
      r -= pool[i].w;
      if (r <= 0) return pool[i].k;
    }
    return pool[pool.length - 1].k;
  }

  function startBossSkill(key) {
    var b = g.boss, p = g.player, s = C.BOSS_SKILLS[key];
    var ph = C.PHASES[b.phase];
    b.skill = key;
    b.state = 'windup'; b.t = 0;
    b.windup = s.windup * g.diff.windupMul * ph.windupMul;
    b.dur = b.windup;
    b.hasHit = false;
    b.lastSkill = key;
    b.aimX = p.x; b.aimZ = p.z;
    var d = dist2(b.x, b.z, p.x, p.z) || 1;
    b.dirX = (p.x - b.x) / d; b.dirZ = (p.z - b.z) / d;
    AU.play(key === 'charge' ? 'charge' : (key === 'slam' ? 'warn' : 'cast'));
    if (!g.firstWindupSeen) {
      g.firstWindupSeen = true;
      showTip(C.TIPS[1], 4.5);
    }
  }

  function bossStrike() {
    var b = g.boss, s = C.BOSS_SKILLS[b.skill];
    b.state = 'strike'; b.t = 0; b.dur = s.strike;
    if (b.skill === 'slam' || b.skill === 'charge') AU.play('slam');
    else AU.play('swing');
    shakeIt(b.skill === 'slam' ? 22 : 10);
    spawnRing(b.x, b.z, s.color);
    applyBossHit();
  }

  function applyBossHit() {
    var b = g.boss, p = g.player, s = C.BOSS_SKILLS[b.skill];
    if (b.hasHit || !s) return;
    var hit = false;

    if (b.skill === 'swipe') {
      var d = dist2(b.x, b.z, p.x, p.z);
      var ang = Math.atan2(p.z - b.z, p.x - b.x);
      var aim = Math.atan2(b.dirZ, b.dirX);
      var diff = Math.abs(Math.atan2(Math.sin(ang - aim), Math.cos(ang - aim)));
      hit = d <= s.range && diff <= (s.arc * Math.PI / 180) / 2;
    } else if (b.skill === 'charge') {
      hit = dist2(b.x, b.z, p.x, p.z) <= s.radius + C.PLAYER.radius;
    } else if (b.skill === 'slam' || b.skill === 'fury') {
      var cx = (b.skill === 'slam') ? b.aimX : b.x;
      var cz = (b.skill === 'slam') ? b.aimZ : b.z;
      hit = dist2(cx, cz, p.x, p.z) <= s.radius + C.PLAYER.radius * 0.5;
    } else if (b.skill === 'burn') {
      var dd = dist2(b.x, b.z, p.x, p.z);
      hit = dd <= s.radius && dd >= s.inner - 0.4;
    }

    if (hit) {
      b.hasHit = true;
      damagePlayer(s.dmg, b.skill === 'burn' ? 'burn' : 'normal');
    }
  }

  function updateBoss(dt) {
    var b = g.boss, p = g.player, ph = C.PHASES[b.phase];
    b.flash = Math.max(0, b.flash - dt * 4);
    for (var k in b.cds) if (b.cds[k] > 0) b.cds[k] -= dt;
    b.facing = p.x >= b.x ? 1 : -1;

    var d = dist2(b.x, b.z, p.x, p.z);

    if (b.state === 'idle') {
      // Boss 常驻上半场，只在纵深上微调：玩家太远就压上、贴脸就后撤。
      // 这样两个角色在屏幕上始终上下分离，读招看得清，也形成「进场输出 / 退场喘气」的空间博弈。
      var targetZ = C.BOSS.homeZ;
      if (d > 7.0) targetZ = C.BOSS.pressZ;
      else if (d < 3.2) targetZ = C.BOSS.farZ;
      var targetX = clamp(p.x * 0.5, -3.4, 3.4);
      var k = 1 - Math.pow(0.12, dt * ph.speedMul);
      b.x += (targetX - b.x) * k;
      b.z += (targetZ - b.z) * k;
      b.gap -= dt;
      if (b.gap <= 0) {
        var key = pickBossSkill(d);
        if (key) startBossSkill(key);
        else b.gap = 0.4;
      }
    } else if (b.state === 'windup') {
      b.t += dt;
      if (b.t >= b.windup) bossStrike();
    } else if (b.state === 'strike') {
      b.t += dt;
      if (b.skill === 'charge') {
        var s = C.BOSS_SKILLS.charge;
        b.x += b.dirX * s.dashSpeed * dt;
        b.z += b.dirZ * s.dashSpeed * dt;
        b.x = clamp(b.x, -C.WORLD.halfW + 1, C.WORLD.halfW - 1);
        b.z = clamp(b.z, -C.WORLD.halfZ + 1, C.WORLD.halfZ - 1);
        if (Math.random() < 0.5) spawnBurst(b.x, b.z, 0.3, 2, s.color, 'dust', 0.3);
        if (!b.hasHit) applyBossHit();
      }
      if (b.t >= b.dur) { b.state = 'recover'; b.t = 0; b.dur = C.BOSS_SKILLS[b.skill].recover; }
    } else if (b.state === 'recover') {
      b.t += dt;
      // 冲撞之后退回上半场，避免 Boss 停在画面下半部挡住玩家
      b.z += (C.BOSS.homeZ - b.z) * (1 - Math.pow(0.02, dt));
      if (b.t >= b.dur) {
        b.state = 'idle'; b.t = 0;
        b.cds[b.skill] = C.BOSS_SKILLS[b.skill].cd;
        b.skill = null;
        var gap = lerp(C.BOSS.gapMin, C.BOSS.gapMax, Math.random()) * ph.gapMul;
        b.gap = gap;
      }
    } else if (b.state === 'stagger') {
      b.t += dt;
      if (b.t >= b.dur) { b.state = 'idle'; b.t = 0; b.gap = 0.55; b.skill = null; }
    } else if (b.state === 'broken') {
      b.t += dt;
      if (b.t >= b.dur) {
        b.state = 'idle'; b.t = 0; b.posture = 0; b.gap = 0.8; b.skill = null;
        toast('菲比站起来了');
      }
    }

    b.x = clamp(b.x, -C.WORLD.halfW + 1.6, C.WORLD.halfW - 1.6);
    b.z = clamp(b.z, -C.WORLD.halfZ + 1.2, C.WORLD.halfZ - 1.2);
  }

  /* =======================================================================
   * 玩家更新
   * ==================================================================== */
  function updatePlayer(dt) {
    var p = g.player, b = g.boss;
    p.flash = Math.max(0, p.flash - dt * 4);
    p.invuln = Math.max(0, p.invuln - dt);
    p.focus = Math.max(0, p.focus - dt);
    for (var k in p.cd) if (p.cd[k] > 0) p.cd[k] -= dt;
    if (p.staminaLock > 0) p.staminaLock -= dt;
    else p.stamina = Math.min(C.PLAYER.staminaMax, p.stamina + C.PLAYER.staminaRegen * dt);

    if (p.burn > 0) {
      p.burn -= dt;
      p.hp = Math.max(0, p.hp - p.burnDps * dt);
      if (Math.random() < 0.16) spawnBurst(p.x, p.z, 1.0, 1, '#ff9a5c', 'dust', 0.4);
      if (p.hp <= 0 && !g.resultShown) endFight(false);
    }

    var mv = inputVector();
    p.moving = mv.len > 0.08;
    var speed = C.PLAYER.speed;

    if (p.state === 'dodge') {
      var s = C.SKILLS.dodge;
      var v = s.dist / s.time;
      p.x += p.dodgeX * v * dt;
      p.z += p.dodgeZ * v * dt;
      if (Math.random() < 0.65) {
        g.afterimages.push({
          who: 'player', x: p.x, z: p.z, h: C.PLAYER.drawHeight,
          life: 0.28, maxLife: 0.28, pose: makePlayerPose(true)
        });
      }
    } else if (p.state === 'attack') {
      p.x += mv.x * speed * 0.22 * dt;
      p.z += mv.z * speed * 0.22 * dt;
    } else if (p.state === 'drink' || p.state === 'hurt' || p.state === 'dead') {
      // 站定
    } else {
      p.x += mv.x * speed * dt;
      p.z += mv.z * speed * dt;
      if (p.moving) faceBoss();
    }

    p.x = clamp(p.x, -C.WORLD.halfW + 0.8, C.WORLD.halfW - 0.8);
    p.z = clamp(p.z, -C.WORLD.halfZ + 0.8, C.WORLD.halfZ - 0.8);

    // 状态推进
    p.t += dt;
    if (p.state === 'attack') {
      var sk = C.SKILLS[p.skill];
      if (!p.hitDone && p.t >= sk.windup) { p.hitDone = true; doPlayerHit(p.skill); }
      if (p.t >= p.dur) { p.state = 'idle'; p.t = 0; p.skill = null; }
    } else if (p.state === 'dodge') {
      if (p.t >= p.dur) { p.state = 'idle'; p.t = 0; p.skill = null; }
    } else if (p.state === 'drink') {
      if (p.t >= p.dur) {
        p.flasks -= 1; p.flasksUsed += 1; g.stats.flasksUsed += 1;
        refreshFlasks();
        p.hp = Math.min(C.PLAYER.maxHp, p.hp + C.PLAYER.flaskHeal);
        floater(p.x, p.z, '+' + C.PLAYER.flaskHeal, '#9ff0b8', 30);
        spawnBurst(p.x, p.z, 1.2, 12, '#9ff0b8', 'dust', 0.6);
        p.state = 'idle'; p.t = 0;
      }
    } else if (p.state === 'hurt') {
      if (p.t >= p.dur) { p.state = 'idle'; p.t = 0; }
    }

    // 低血心跳
    if (p.hp > 0 && p.hp <= 28) {
      g.heartTimer -= dt;
      if (g.heartTimer <= 0) { AU.play('heartbeat'); g.heartTimer = 1.25; }
    }
    document.body.classList.toggle('lowhp', p.hp > 0 && p.hp <= 28);
  }

  /* =======================================================================
   * 特效 / 提示
   * ==================================================================== */
  function spawnBurst(x, z, y, n, color, kind, life) {
    for (var i = 0; i < n; i++) {
      var a = Math.random() * Math.PI * 2;
      var sp = 30 + Math.random() * 150;
      var lf = life * (0.6 + Math.random() * 0.7);
      g.particles.push({
        x: x, z: z, y: y + Math.random() * 0.7,
        vx: Math.cos(a) * sp, vy: 20 + Math.random() * 90, vz: Math.sin(a) * sp,
        life: lf, maxLife: lf, color: color, size: 2 + Math.random() * 3.5,
        kind: kind || 'dot', glow: true,
      });
    }
  }
  function spawnRing(x, z, color) {
    g.particles.push({ x: x, z: z, y: 0.05, vx: 0, vy: 0, vz: 0,
      life: 0.42, maxLife: 0.42, color: color, size: 90, kind: 'ring', glow: true });
  }
  function floater(x, z, text, color, size) {
    g.floaters.push({ x: x, z: z, y: 2.2 + Math.random() * 0.5, text: text,
      color: color, size: size || 30, life: C.FEEL.dmgTextTime, maxLife: C.FEEL.dmgTextTime,
      vx: (Math.random() * 2 - 1) * 0.6 });
  }
  function hitstop(t) { g.hitstop = Math.max(g.hitstop, t); }
  function shakeIt(v) { g.shake = Math.min(42, g.shake + v); }

  function banner(main, sub, dur, violet) {
    D.tip.classList.remove('show'); g.tipTimer = 0;   // 字幕出现时先收起教学条
    D.banner.innerHTML = main + (sub ? '<small>' + sub + '</small>' : '');
    D.banner.classList.toggle('violet', !!violet);
    D.banner.classList.add('show');
    g.bannerTimer = dur;
  }
  function showTip(text, dur) {
    D.tip.textContent = text;
    D.tip.classList.add('show');
    g.tipTimer = dur;
  }
  function toast(text) {
    var el = document.createElement('div');
    el.className = 'toast'; el.textContent = text;
    D.toastStack.appendChild(el);
    setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 3100);
  }

  function refreshFlasks() {
    var p = g.player;
    if (!p) return;
    var html = '';
    for (var i = 0; i < C.PLAYER.flasks; i++) {
      html += '<span class="flask' + (i < p.flasks ? '' : ' empty') + '"></span>';
    }
    html += '<span class="flask-label">R · 喝药</span>';
    D.flaskRow.innerHTML = html;
  }

  /* =======================================================================
   * 结算
   * ==================================================================== */
  function endFight(win) {
    g.resultShown = true;
    g.mode = 'fight';                  // 一帧后切到 result
    var p = g.player, b = g.boss;
    p.state = win ? 'idle' : 'dead';
    if (!win) b.state = 'idle';
    AU.stopAmbience();
    AU.play(win ? 'win' : 'lose');
    g.flash = 0.8;
    spawnBurst(win ? b.x : p.x, win ? b.z : p.z, 1.6, 44, win ? '#ffe0a2' : '#ff7a8a', 'spark', 1.2);

    var ms = Math.round(g.time * 1000);
    var res = {
      win: win, ms: ms, perfect: g.stats.perfect, hitsTaken: g.stats.hitsTaken,
      flasksUsed: g.stats.flasksUsed, difficulty: g.difficulty,
    };
    var saved = ST.finishRun(res);

    if (g.resultTimer) clearTimeout(g.resultTimer);
    g.resultTimer = setTimeout(function () {
      g.resultTimer = 0;
      g.mode = 'result';
      D.resultEyebrow.textContent = win ? 'VICTORY' : 'DEFEAT';
      D.resultTitle.textContent = win ? '菲比被磨倒了' : '被菲比拍扁了';
      D.resultDesc.textContent = win
        ? '这条胖鱼赢了，而且赢得很没有尊严。'
        : '鱼生还长，下次记得贴着攻击翻滚，别背对着抬手。';
      D.resultTime.textContent = ST.formatTime(ms);
      D.statPerfect.textContent = g.stats.perfect;
      D.statHits.textContent = g.stats.hitsTaken;
      D.statFlask.textContent = g.stats.flasksUsed;
      D.statBreak.textContent = g.stats.breaks;
      var badges = '';
      if (win && saved.isBest) badges += '<span class="result-badge">★ 新纪录</span>';
      saved.unlocked.forEach(function (id) {
        var a = C.ACHIEVEMENTS.filter(function (x) { return x.id === id; })[0];
        if (a) badges += '<span class="result-badge">解锁 · ' + a.name + '</span>';
      });
      if (!badges) badges = '<span class="result-badge" style="opacity:.55;border-color:rgba(255,255,255,.2)">继续挑战更快击杀</span>';
      D.resultBadges.innerHTML = badges;
      showScreen('screenResult');
      buildUI();
    }, 1100);
  }

  /* =======================================================================
   * 更新 / 渲染
   * ==================================================================== */
  function update(dt) {
    g.time += dt;
    g.phaseT = Math.min(1, g.phaseT + dt * 0.9);
    updatePlayer(dt);
    if (!g.resultShown) updateBoss(dt);
    g.camX = lerp(g.camX, g.player.x * 0.16, 1 - Math.pow(0.001, dt));

    // 提示 / 横幅计时
    if (g.bannerTimer > 0) {
      g.bannerTimer -= dt;
      if (g.bannerTimer <= 0) D.banner.classList.remove('show');
    }
    if (g.tipTimer > 0) {
      g.tipTimer -= dt;
      if (g.tipTimer <= 0) D.tip.classList.remove('show');
    }

    // Boss 架势自然衰减
    var b = g.boss;
    if (b.state !== 'broken' && b.posture > 0 && !g.resultShown) {
      b.posture = Math.max(0, b.posture - C.POSTURE.decay * dt);
    }
  }

  function updateParticles(dt) {
    var i, q;
    for (i = g.particles.length - 1; i >= 0; i--) {
      q = g.particles[i];
      q.life -= dt;
      if (q.life <= 0) { g.particles.splice(i, 1); continue; }
      q.x += (q.vx || 0) * dt / C.VIEW.UNIT_X;
      q.z += (q.vz || 0) * dt / C.VIEW.UNIT_Z;
      q.y += (q.vy || 0) * dt / C.VIEW.UNIT_Y;
      if (q.kind !== 'ring') q.vy = (q.vy || 0) - 170 * dt;
      if (q.y < 0) { q.y = 0; q.vy = -(q.vy || 0) * 0.35; }
    }
    for (i = g.floaters.length - 1; i >= 0; i--) {
      q = g.floaters[i]; q.life -= dt;
      if (q.life <= 0) { g.floaters.splice(i, 1); continue; }
      q.x += (q.vx || 0) * dt;
      q.y += 0.4 * dt;
    }
    for (i = g.afterimages.length - 1; i >= 0; i--) {
      q = g.afterimages[i]; q.life -= dt;
      if (q.life <= 0) g.afterimages.splice(i, 1);
    }
    for (i = 0; i < g.dust.length; i++) {
      var d = g.dust[i];
      d.y += d.vy * dt; d.x += d.vx * dt;
      if (d.y > 4.2) { d.y = 0.2; d.x = (Math.random() * 2 - 1) * C.WORLD.halfW; }
    }
  }

  function makePlayerPose(afterimage) {
    var p = g.player;
    return {
      t: g.clock, state: p.state, actionT: p.t, actionDur: p.dur || 1,
      skill: p.skill, facing: p.facing, focus: 0, invuln: afterimage ? 0.3 : p.invuln,
      flash: 0, moving: p.moving,
    };
  }
  function makeBossPose() {
    var b = g.boss;
    return {
      t: g.clock, state: b.state, actionT: b.t, actionDur: b.dur || 1,
      skill: b.skill, phase: b.phase, flash: b.flash,
      windupProg: b.state === 'windup' ? clamp(b.t / b.windup, 0, 1) : 0,
    };
  }

  function render() {
    var phase = g.boss ? g.boss.phase : 0;
    ctx.save();
    if (g.shake > 0.2) {
      ctx.translate((Math.random() * 2 - 1) * g.shake, (Math.random() * 2 - 1) * g.shake * 0.6);
      g.shake *= 0.86;
    } else g.shake = 0;

    A.drawSky(ctx, phase, g.clock);
    A.drawRuins(ctx, phase, g.clock, g.camX);
    A.drawGround(ctx, phase, g.clock, g.camX);

    // 环境尘埃
    var dustParticles = g.dust.map(function (d) {
      return { x: d.x, z: d.z, y: d.y, kind: 'dust', color: 'rgba(180,215,245,0.75)',
        size: d.size, alpha: d.alpha, life: 1, maxLife: 1 };
    });
    A.drawParticles(ctx, dustParticles, g.camX);

    // 地面预警（在角色之下）
    if (g.mode === 'fight' && !g.resultShown) A.drawMarker(ctx, g);

    // Boss 脚下光环
    var b = g.boss, p = g.player;
    A.drawGroundGlow(ctx, b.x, b.z, 2.4, C.PHASES[phase].glow, 0.42, g.camX, 1 + Math.sin(g.clock * 1.6) * 0.03);
    A.drawShadow(ctx, b.x, b.z, 2.5, 0.46, g.camX);
    if (p.focus > 0) A.drawGroundGlow(ctx, p.x, p.z, 1.15, '#79d8ff', 0.55, g.camX, 1 + Math.sin(g.clock * 7) * 0.08);
    A.drawShadow(ctx, p.x, p.z, 0.95, 0.44, g.camX);

    // 角色按深度排序（远的先画）
    var ents = [
      { who: 'boss', z: b.z }, { who: 'player', z: p.z },
    ].sort(function (a, c) { return a.z - c.z; });

    ents.forEach(function (e) {
      var o = e.who === 'boss' ? b : p;
      var q = A.project(o.x, o.z, 0, g.camX);
      ctx.save();
      ctx.translate(q.x, q.y);
      var h = e.who === 'boss' ? C.BOSS.drawHeight : C.PLAYER.drawHeight;
      var s = (h / 120) * q.s;
      ctx.scale(s * (e.who === 'boss' ? b.facing : p.facing), s);
      if (e.who === 'boss') CH.phoebe(ctx, makeBossPose());
      else CH.fish(ctx, makePlayerPose(false));
      ctx.restore();
    });

    A.drawAfterimages(ctx, g.afterimages, g.camX);
    A.drawParticles(ctx, g.particles, g.camX);
    A.drawFloaters(ctx, g.floaters, g.camX);
    A.drawVignette(ctx, phase, p.hp <= 28 && g.mode === 'fight' ? 0.7 : 0);

    // 阶段切换的色温过渡
    if (g.phaseT < 1) {
      ctx.fillStyle = A.hexA(C.PHASES[phase].glow, (1 - g.phaseT) * 0.16);
      ctx.fillRect(0, 0, C.VIEW.W, C.VIEW.H);
    }
    if (g.flash > 0.01) {
      ctx.fillStyle = 'rgba(255,240,225,' + (g.flash * 0.30) + ')';
      ctx.fillRect(0, 0, C.VIEW.W, C.VIEW.H);
      g.flash *= 0.82;
    }
    ctx.restore();
  }

  /* =======================================================================
   * HUD 更新
   * ==================================================================== */
  function setScale(el, ratio) { el.style.transform = 'scaleX(' + clamp(ratio, 0, 1) + ')'; }

  function updateHUD() {
    var p = g.player, b = g.boss;
    if (!p || !b) return;
    setScale(D.hpFill, p.hp / C.PLAYER.maxHp);
    setScale(D.hpGhost, p.hp / C.PLAYER.maxHp);
    D.hpText.textContent = Math.ceil(p.hp) + ' / ' + C.PLAYER.maxHp;
    setScale(D.stFill, p.stamina / C.PLAYER.staminaMax);
    setScale(D.bossFill, b.hp / b.maxHp);
    setScale(D.bossGhost, b.hp / b.maxHp);
    setScale(D.postureFill, b.posture / C.POSTURE.max);
    D.postureFill.parentNode.classList.toggle('full', b.posture >= C.POSTURE.max * 0.92);
    D.timer.textContent = g.time.toFixed(2);
    D.perfectCount.textContent = g.stats.perfect;

    // 技能冷却 / 耐力
    Array.prototype.forEach.call(D.skillbar.querySelectorAll('.skill'), function (el) {
      var k = el.dataset.skill;
      if (k === 'flask') {
        var fcd = p.flasks <= 0 ? 1 : (p.state === 'drink' ? clamp(p.t / p.dur, 0, 1) : 0);
        el.querySelector('.skill-cd').style.setProperty('--cdp', fcd);
        el.classList.toggle('disabled', p.flasks <= 0 || p.hp >= C.PLAYER.maxHp);
        return;
      }
      var s = C.SKILLS[k];
      var cd = p.cd[k] || 0;
      var ratio = s.cd > 0 ? cd / s.cd : 0;
      el.querySelector('.skill-cd').style.setProperty('--cdp', ratio);
      var txt = el.querySelector('.skill-cd-text');
      if (txt) txt.textContent = cd > 0.1 && s.cd >= 2 ? Math.ceil(cd) + '' : '';
      el.classList.toggle('disabled', cd > 0 || p.stamina < s.stamina);
      el.classList.toggle('ready', cd <= 0 && p.stamina >= s.stamina && p.focus > 0);
    });

    // 招名预警
    var showWarn = g.mode === 'fight' && b.state === 'windup' && b.skill && !g.resultShown;
    D.warnCenter.classList.toggle('show', !!showWarn);
    if (showWarn) {
      var s = C.BOSS_SKILLS[b.skill];
      var prog = clamp(b.t / b.windup, 0, 1);
      D.warnLabel.textContent = g.diff.hint ? s.label : '！！';
      D.warnHint.textContent = g.diff.hint ? s.hint : '';
      D.warnLabel.style.color = s.color;
      setScale(D.warnBar, prog);
    }

    // Boss 状态
    var pills = '';
    if (b.state === 'broken') pills += '<span class="pill buff">失衡 · 受伤 ×1.6</span>';
    if (p.focus > 0) pills += '<span class="pill buff">鱼跃时机 ×2</span>';
    if (p.burn > 0) pills += '<span class="pill danger">灼烧 ' + p.burn.toFixed(1) + 's</span>';
    if (b.phase > 0) pills += '<span class="pill">第 ' + (b.phase + 1) + ' 幕</span>';
    D.bossStatus.innerHTML = pills;
  }

  /* =======================================================================
   * 主循环
   * ==================================================================== */
  function loop(ts) {
    var dt = Math.min(0.033, (ts - lastTs) / 1000 || 0.016);
    lastTs = ts;
    g.clock += dt;
    if (g.mode === 'fight') {
      if (g.hitstop > 0) g.hitstop -= dt;
      else {
        if (!g.resultShown) update(dt);
        updateParticles(dt);
      }
    } else {
      updateParticles(dt * 0.35);
    }
    render();
    if (g.mode === 'fight' || g.mode === 'result') updateHUD();
    requestAnimationFrame(loop);
  }

  /* 只读诊断接口：供自动化试玩 / 平衡性采样使用，不修改任何游戏状态 */
  root.BFF.debug = function () {
    var p = g.player, b = g.boss;
    return {
      mode: g.mode, time: +g.time.toFixed(2),
      player: { x: +p.x.toFixed(2), z: +p.z.toFixed(2), hp: +p.hp.toFixed(1),
        stamina: +p.stamina.toFixed(1), state: p.state, skill: p.skill,
        aim: p.aim === undefined ? null : +p.aim.toFixed(2), cd: p.cd },
      boss: { x: +b.x.toFixed(2), z: +b.z.toFixed(2), hp: b.hp, maxHp: b.maxHp,
        state: b.state, skill: b.skill, phase: b.phase, posture: +b.posture.toFixed(1), gap: +b.gap.toFixed(2),
        t: +b.t.toFixed(2), windup: +(b.windup || 0).toFixed(2) },
      dist: +dist2(p.x, p.z, b.x, b.z).toFixed(2),
      stats: g.stats,
    };
  };

  function boot() {
    cacheDom();
    g.difficulty = save.difficulty || 'normal';
    AU.setMuted(!!save.muted);
    if (isTouch()) document.body.classList.add('touch');
    createEntities();
    initDust();
    buildUI();
    bindEvents();
    resize();
    g.camX = -4.6;
    showScreen('screenTitle');
    requestAnimationFrame(loop);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})(window);
