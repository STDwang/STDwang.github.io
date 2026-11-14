/* =============================================================================
 * 大肥鱼大战菲比 · Web 重构版
 * config.js — 全部可调数值 / 招式表 / 阶段表
 *
 * 设计原则（相对原版的核心修正）：
 *  1. Boss 血量从 3200 降到 1600，玩家单次输出提高，一局约 15-20 次交锋 / 2-3 分钟。
 *  2. 删除「每 30 秒随机掉落 5 种 buff」——随机性稀释读招博弈，改用「架势/失衡」闭环。
 *  3. 完美闪避给实质收益（focus 增伤 + 硬直 + 回耐），让「躲对」成为最优解。
 *  4. 三阶段递进解锁招式，代替全程同质的 AI。
 * ========================================================================== */
(function (root) {
  'use strict';

  var C = {};

  C.VERSION = '2.0.0';
  C.TITLE = '大肥鱼大战菲比';
  C.SUBTITLE = 'BIG FAT FISH TAKES ON PHOEBE';

  /* ---------------- 画布 / 伪 3D 投影 ---------------- */
  C.VIEW = {
    W: 1280,
    H: 720,
    CX: 640,
    GROUND_Y: 452,
    UNIT_X: 41,      // 世界 x（米）→ 屏幕 px
    UNIT_Z: 25.5,    // 世界 z（米）→ 屏幕 px（越远越靠上）
    UNIT_Y: 44,      // 世界 y（高度）→ 屏幕 px
    FAR_Y: 236,      // 地平线附近的地面起点
  };

  /* 场地：一米见方的世界坐标，玩家与 Boss 都在其中 */
  // Boss 固定在上半场、玩家在下半场：屏幕上下分离，避免两个大模型糊在一起
  C.WORLD = { halfW: 10.2, halfZ: 7.6, bossStartZ: -4.0, playerStartZ: 4.2 };

  /* ---------------- 玩家 ---------------- */
  C.PLAYER = {
    maxHp: 100,
    speed: 5.0,             // 米/秒
    radius: 0.62,
    staminaMax: 100,
    staminaRegen: 28,       // 每秒
    staminaDelay: 0.32,     // 消耗后多久开始回复
    flasks: 3,
    flaskHeal: 45,
    flaskWindup: 1.0,       // 喝药前摇，可被打断
    hurtStun: 0.34,
    drawHeight: 122,        // 屏幕上的基准高度（px）
  };

  /* 玩家技能：windup / active / recover 三段动作，命中判定发生在 active 起点 */
  C.SKILLS = {
    punch: {
      key: 'J', label: '出拳', icon: '✦', color: '#8fd8ff',
      cd: 0.55, stamina: 0, staminaGain: 4,
      dmg: 14, range: 2.9, arc: 84, posture: 6,
      windup: 0.10, active: 0.10, recover: 0.18,
      hitstop: 0.055, shake: 7,
    },
    tail: {
      key: 'K', label: '甩尾', icon: '≋', color: '#7ee6c0',
      cd: 1.05, stamina: 16,
      dmg: 32, range: 3.8, arc: 130, posture: 13,
      windup: 0.16, active: 0.12, recover: 0.22,
      hitstop: 0.075, shake: 13,
    },
    spin: {
      key: 'L', label: '回旋击', icon: '◎', color: '#ffd166',
      cd: 7.0, stamina: 32,
      dmg: 74, range: 4.6, arc: 360, posture: 22, stagger: true,
      windup: 0.22, active: 0.16, recover: 0.30,
      hitstop: 0.11, shake: 21,
    },
    dodge: {
      key: '空格', label: '翻滚', icon: '➰', color: '#c4a8ff',
      cd: 0.72, stamina: 20,
      time: 0.52, invuln: 0.36, dist: 4.4,
      hitstop: 0.04, shake: 0,
    },
  };
  C.SKILL_ORDER = ['punch', 'tail', 'spin', 'dodge'];

  /* ---------------- 完美闪避 / 架势 ---------------- */
  C.FOCUS = { time: 1.25, dmgMul: 2.0, staminaBack: 15, postureBonus: 6 };
  C.POSTURE = {
    max: 110,
    decay: 5.0,          // 每秒自然衰减：逼玩家持续压制，不能攒一会儿打一下
    breakTime: 2.4,      // 失衡持续
    breakDmgMul: 1.6,    // 失衡期间受伤倍率
    perfectGain: 20,     // 完美闪避额外架势
  };

  /* ---------------- Boss ---------------- */
  C.BOSS = {
    maxHp: 2600,
    radius: 1.9,
    speed: 2.15,
    homeZ: -3.9,         // Boss 常驻的上半场纵深
    farZ: -4.6,          // 玩家贴脸时后撤
    pressZ: -2.4,        // 玩家站太远时压上
    hurtStun: 0.22,
    staggerTime: 0.55,
    drawHeight: 238,
    gapMin: 0.62,
    gapMax: 1.05,
  };

  /* Boss 招式：marker 决定地面预警形状；phase 决定最早出现的阶段 */
  C.BOSS_SKILLS = {
    swipe: {
      label: '横扫抓', marker: 'arc', phase: 1, cd: 3.2, weight: 3,
      windup: 0.72, strike: 0.16, recover: 0.62,
      range: 4.0, arc: 130, dmg: 12, color: '#ff7a8a',
      hint: '近身扇形 · 反向翻滚',
    },
    charge: {
      label: '冲撞', marker: 'line', phase: 1, cd: 6.5, weight: 2,
      windup: 1.00, strike: 0.46, recover: 0.78,
      dashSpeed: 12.0, radius: 2.15, dmg: 17, color: '#ffb36b',
      hint: '直线突进 · 横向闪开',
    },
    slam: {
      label: '跳砸', marker: 'circle', phase: 2, cd: 8.0, weight: 2,
      windup: 1.10, strike: 0.24, recover: 0.80,
      radius: 3.6, dmg: 20, color: '#c58cff',
      hint: '落点圆圈 · 离开红圈',
    },
    burn: {
      label: '灼烧', marker: 'ring', phase: 2, cd: 11.0, weight: 1,
      windup: 1.25, strike: 0.28, recover: 0.82,
      radius: 5.4, inner: 2.2, dmg: 13, burnDps: 3, burnTime: 5.0,
      color: '#ff8a4c', hint: '火环 · 贴近或翻出',
    },
    fury: {
      label: '狂怒', marker: 'circle', phase: 3, cd: 9.0, weight: 2,
      windup: 0.90, strike: 0.30, recover: 0.66,
      radius: 4.6, dmg: 11, color: '#ff5f9e',
      hint: '全场震荡 · 拉开距离',
    },
  };

  /* 三阶段：血量阈值、节奏、伤害、环境色 */
  C.PHASES = [
    {
      from: 1.00, name: '第一幕 · 试探', short: 'I',
      atkMul: 1.00, gapMul: 1.00, speedMul: 1.00, windupMul: 1.00,
      sky: '#101d31', glow: '#5aa6d8', fog: 'rgba(120,170,215,0.10)',
      line: '菲比抬起了手……',
    },
    {
      from: 0.65, name: '第二幕 · 焚风', short: 'II',
      atkMul: 1.08, gapMul: 0.82, speedMul: 1.10, windupMul: 0.94,
      sky: '#241627', glow: '#ff9b5c', fog: 'rgba(235,140,95,0.12)',
      line: '空气烧起来了',
    },
    {
      from: 0.30, name: '终幕 · 溺光', short: 'III',
      atkMul: 1.16, gapMul: 0.68, speedMul: 1.22, windupMul: 0.88,
      sky: '#191226', glow: '#c46bff', fog: 'rgba(180,110,240,0.15)',
      line: '帽子底下，紫光溢出来了',
    },
  ];

  /* ---------------- 难度 ---------------- */
  C.DIFFICULTIES = {
    casual: { label: '休闲', sub: '看清每一招', bossHp: 2200, dmgMul: 0.70, windupMul: 1.20, hint: true },
    normal: { label: '标准', sub: '推荐第一次玩', bossHp: 2600, dmgMul: 1.00, windupMul: 1.00, hint: true },
    hard:   { label: '硬核', sub: '没有招名提示', bossHp: 3000, dmgMul: 1.35, windupMul: 0.86, hint: false },
  };

  /* ---------------- 打击感 ---------------- */
  C.FEEL = {
    hitstopTaken: 0.10,
    hitstopPerfect: 0.09,
    shakeTaken: 26,
    dmgTextTime: 0.85,
    flashTime: 0.16,
    warnPulse: 5.2,
  };

  /* ---------------- 成就 ---------------- */
  C.ACHIEVEMENTS = [
    { id: 'first',   name: '初见菲比',   desc: '第一次把菲比磨倒' },
    { id: 'nohit',   name: '一片鳞没掉', desc: '全程零受击通关' },
    { id: 'speed',   name: '快鱼',       desc: '90 秒内击杀' },
    { id: 'noflask', name: '不喝也行',   desc: '一滴药不喝通关' },
    { id: 'perfect', name: '读招大师',   desc: '单局 10 次完美闪避' },
    { id: 'hard',    name: '深海之魂',   desc: '硬核难度通关' },
  ];

  /* ---------------- 教学提示 ---------------- */
  C.TIPS = [
    '菲比抬手时地面会亮起预警，那就是你的翻滚信号。',
    '翻滚前半段无敌。贴着攻击躲过去，会触发「鱼跃时机」。',
    '鱼跃时机内下一次攻击伤害翻倍，还能打断菲比。',
    '打满菲比头顶的架势条，它会失衡跪地，那是自由输出窗口。',
  ];

  root.BFF = root.BFF || {};
  root.BFF.CONFIG = C;
})(window);
