/* =============================================================================
 * storage.js — 本地成绩 / 成就 / 设置（localStorage，无后端依赖）
 * 网页版没有 TapTap 云排行榜，改为「本地最佳 + 成就陈列」，
 * 保证单机可玩、离线可玩，也不引入任何隐私或网络请求。
 * ========================================================================== */
(function (root) {
  'use strict';
  var KEY = 'bff_v2_save';

  var DEFAULT = {
    bestMs: 0,
    runs: 0,
    wins: 0,
    perfectTotal: 0,
    achievements: {},
    difficulty: 'normal',
    muted: false,
    seenTips: false,
  };

  var data = null;

  function load() {
    if (data) return data;
    data = {};
    for (var k in DEFAULT) data[k] = DEFAULT[k];
    try {
      var raw = root.localStorage.getItem(KEY);
      if (raw) {
        var parsed = JSON.parse(raw);
        for (var p in DEFAULT) if (parsed[p] !== undefined) data[p] = parsed[p];
      }
    } catch (e) {}
    return data;
  }

  function save() {
    try { root.localStorage.setItem(KEY, JSON.stringify(load())); } catch (e) {}
  }

  function set(patch) {
    var d = load();
    for (var k in patch) d[k] = patch[k];
    save();
    return d;
  }

  /* 结算：返回本局新解锁的成就 id 列表 */
  function finishRun(result) {
    var d = load();
    d.runs += 1;
    d.perfectTotal += result.perfect || 0;
    var unlocked = [];
    function unlock(id) {
      if (!d.achievements[id]) { d.achievements[id] = true; unlocked.push(id); }
    }
    if (result.win) {
      d.wins += 1;
      unlock('first');
      if (d.bestMs === 0 || result.ms < d.bestMs) d.bestMs = result.ms;
      if (result.hitsTaken === 0) unlock('nohit');
      if (result.ms <= 90000) unlock('speed');
      if (result.flasksUsed === 0) unlock('noflask');
      if ((result.perfect || 0) >= 10) unlock('perfect');
      if (result.difficulty === 'hard') unlock('hard');
    }
    save();
    return { unlocked: unlocked, isBest: result.win && d.bestMs === result.ms };
  }

  function formatTime(ms) {
    if (!ms) return '—';
    var total = Math.floor(ms / 1000);
    var m = Math.floor(total / 60);
    var s = total % 60;
    var cs = Math.floor((ms % 1000) / 10);
    return (m > 0 ? m + ':' + String(s).padStart(2, '0') : String(s)) + '.' + String(cs).padStart(2, '0') + (m > 0 ? '' : 's');
  }

  root.BFF = root.BFF || {};
  root.BFF.Storage = {
    load: load, set: set, finishRun: finishRun, formatTime: formatTime,
  };
})(window);
