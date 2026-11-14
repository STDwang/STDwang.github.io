/* =============================================================================
 * art.js — 场景 / 伪 3D 投影 / 地面预警 / 特效
 *
 * 美术方向：把原版「灰雾废墟 + 平铺色 3D」改成
 * 「月下海墟 · 立体绘本」：深青蓝夜空 + 暖金边光 + 洋红/青技能对比色，
 * 所有角色与场景都是程序化矢量绘制，无贴图、无外部资源。
 * ========================================================================== */
(function (root) {
  'use strict';
  var C = root.BFF.CONFIG;

  /* ---------------- 通用绘制助手 ---------------- */
  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function lerp(a, b, t) { return a + (b - a) * t; }

  function ell(g, x, y, rx, ry, fill, stroke, lw, rot) {
    g.beginPath();
    g.ellipse(x, y, Math.max(0.1, rx), Math.max(0.1, ry), rot || 0, 0, Math.PI * 2);
    if (fill) { g.fillStyle = fill; g.fill(); }
    if (stroke) { g.strokeStyle = stroke; g.lineWidth = lw || 2; g.stroke(); }
  }

  function lin(g, x0, y0, x1, y1, stops) {
    var gr = g.createLinearGradient(x0, y0, x1, y1);
    for (var i = 0; i < stops.length; i++) gr.addColorStop(stops[i][0], stops[i][1]);
    return gr;
  }
  function rad(g, x, y, r0, r1, stops) {
    var gr = g.createRadialGradient(x, y, r0, x, y, r1);
    for (var i = 0; i < stops.length; i++) gr.addColorStop(stops[i][0], stops[i][1]);
    return gr;
  }

  /* 平滑闭合路径：点列 → Catmull-Rom 近似（用二次贝塞尔中点法） */
  function blob(g, pts) {
    g.beginPath();
    var n = pts.length;
    var mx = (pts[n - 1][0] + pts[0][0]) / 2;
    var my = (pts[n - 1][1] + pts[0][1]) / 2;
    g.moveTo(mx, my);
    for (var i = 0; i < n; i++) {
      var p = pts[i], q = pts[(i + 1) % n];
      g.quadraticCurveTo(p[0], p[1], (p[0] + q[0]) / 2, (p[1] + q[1]) / 2);
    }
    g.closePath();
  }

  function roundRect(g, x, y, w, h, r) {
    var rr = Math.min(r, w / 2, h / 2);
    g.beginPath();
    g.moveTo(x + rr, y);
    g.arcTo(x + w, y, x + w, y + h, rr);
    g.arcTo(x + w, y + h, x, y + h, rr);
    g.arcTo(x, y + h, x, y, rr);
    g.arcTo(x, y, x + w, y, rr);
    g.closePath();
  }

  function star(g, x, y, r, points, inner, fill) {
    g.beginPath();
    for (var i = 0; i < points * 2; i++) {
      var a = -Math.PI / 2 + i * Math.PI / points;
      var rr = i % 2 ? r * inner : r;
      var px = x + Math.cos(a) * rr, py = y + Math.sin(a) * rr;
      if (i === 0) g.moveTo(px, py); else g.lineTo(px, py);
    }
    g.closePath();
    if (fill) { g.fillStyle = fill; g.fill(); }
  }

  /* ---------------- 伪 3D 投影 ----------------
   * 世界 (x, z, y) → 屏幕 (px, py, scale)
   * z 越大（越靠近镜头）横向与纵向都放大，形成梯形地面；
   * 战斗判定始终用世界坐标，投影只负责表现。 */
  function depthOf(z) { return clamp((z + C.WORLD.halfZ) / (2 * C.WORLD.halfZ), 0, 1); }
  function persp(z) { return 0.80 + depthOf(z) * 0.42; }
  function project(x, z, y, camX) {
    var d = depthOf(z), p = 0.80 + d * 0.42;
    var px = C.VIEW.CX + (x - (camX || 0)) * C.VIEW.UNIT_X * p;
    var py = C.VIEW.GROUND_Y + z * C.VIEW.UNIT_Z * (0.72 + d * 0.42) - (y || 0) * C.VIEW.UNIT_Y * p;
    return { x: px, y: py, s: p };
  }

  /* ---------------- 远景：夜空 / 月 / 拱墙 / 光柱 ---------------- */
  function drawSky(g, phase, t) {
    var p = C.PHASES[phase];
    var sky = lin(g, 0, 0, 0, 470, [
      [0, '#070d19'], [0.42, p.sky], [0.80, '#1b2b3d'], [1, '#243447'],
    ]);
    g.fillStyle = sky;
    g.fillRect(0, 0, C.VIEW.W, 300);

    // 月轮与光晕
    var moonX = 1010, moonY = 116;
    g.fillStyle = rad(g, moonX, moonY, 8, 210, [
      [0, 'rgba(220,238,255,0.30)'], [0.35, 'rgba(150,190,235,0.10)'], [1, 'rgba(120,160,220,0)'],
    ]);
    g.beginPath(); g.arc(moonX, moonY, 210, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#e8f2ff';
    g.beginPath(); g.arc(moonX, moonY, 41, 0, Math.PI * 2); g.fill();
    g.fillStyle = 'rgba(160,190,225,0.30)';
    g.beginPath(); g.arc(moonX - 13, moonY - 8, 9, 0, Math.PI * 2); g.fill();
    g.beginPath(); g.arc(moonX + 12, moonY + 12, 6, 0, Math.PI * 2); g.fill();

    // 稀疏星点（固定伪随机，避免闪烁）
    for (var i = 0; i < 46; i++) {
      var sx = (i * 173.7) % C.VIEW.W;
      var sy = (i * 71.3) % 210 + 12;
      var a = 0.20 + 0.35 * Math.abs(Math.sin(i * 2.7 + t * 0.5));
      g.fillStyle = 'rgba(210,230,255,' + a.toFixed(3) + ')';
      g.fillRect(sx, sy, i % 5 === 0 ? 2 : 1.3, i % 5 === 0 ? 2 : 1.3);
    }

    // 斜射光柱
    g.save();
    g.globalCompositeOperation = 'lighter';
    for (var k = 0; k < 3; k++) {
      var bx = 180 + k * 330;
      var beam = lin(g, bx, 0, bx + 190, 420, [
        [0, 'rgba(160,205,255,0.085)'], [1, 'rgba(160,205,255,0)'],
      ]);
      g.fillStyle = beam;
      g.beginPath();
      g.moveTo(bx, 0); g.lineTo(bx + 46, 0);
      g.lineTo(bx + 240, 420); g.lineTo(bx + 110, 420);
      g.closePath(); g.fill();
    }
    g.restore();
  }

  function drawRuins(g, phase, t, camX) {
    var p = C.PHASES[phase];
    var par = -(camX || 0) * 7;
    g.save();
    g.translate(par, 0);

    // 后方城墙剪影
    g.fillStyle = '#101b2a';
    g.fillRect(-160, 128, C.VIEW.W + 320, 156);
    g.fillStyle = '#16243a';
    g.fillRect(-160, 128, C.VIEW.W + 320, 12);

    // 城垛
    for (var i = -2; i < 22; i++) {
      var x = i * 72;
      g.fillStyle = '#101b2a';
      g.fillRect(x, 108, 44, 24);
      g.fillStyle = 'rgba(120,165,210,0.07)';
      g.fillRect(x, 108, 44, 3);
    }

    // 拱门（远景层次）
    for (var a = -1; a < 12; a++) {
      var ax = a * 138 + 40;
      var aw = 92, ah = 118, ay = 166;
      g.fillStyle = '#0a1220';
      g.beginPath();
      g.moveTo(ax, 284);
      g.lineTo(ax, ay + 44);
      g.arc(ax + aw / 2, ay + 44, aw / 2, Math.PI, 0);
      g.lineTo(ax + aw, 284);
      g.closePath(); g.fill();
      g.strokeStyle = 'rgba(130,175,220,0.10)';
      g.lineWidth = 4; g.stroke();
      // 门内微光
      g.fillStyle = rad(g, ax + aw / 2, ay + 70, 2, 62, [
        [0, hexA(p.glow, 0.10)], [1, 'rgba(0,0,0,0)'],
      ]);
      g.fillRect(ax, ay, aw, 120);
    }

    // 两侧断柱
    [24, C.VIEW.W - 96].forEach(function (px, idx) {
      g.fillStyle = '#132033';
      g.fillRect(px, 172, 72, 130);
      g.fillStyle = 'rgba(140,180,225,0.08)';
      g.fillRect(px, 172, 72, 6);
      g.fillStyle = '#0d1828';
      for (var j = 0; j < 4; j++) g.fillRect(px + 6, 196 + j * 27, 60, 3);
    });
    g.restore();
  }

  /* ---------------- 地面 ---------------- */
  function drawGround(g, phase, t, camX) {
    var p = C.PHASES[phase];
    var HW = C.WORLD.halfW, HZ = C.WORLD.halfZ;

    // 地面底色（梯形）
    var fl = project(-HW, -HZ, 0, camX), fr = project(HW, -HZ, 0, camX);
    var nl = project(-HW, HZ, 0, camX), nr = project(HW, HZ, 0, camX);
    g.beginPath();
    g.moveTo(fl.x, fl.y); g.lineTo(fr.x, fr.y);
    g.lineTo(nr.x, nr.y); g.lineTo(nl.x, nl.y);
    g.closePath();
    g.fillStyle = lin(g, 0, fl.y, 0, nr.y, [
      [0, '#1a2c3c'], [0.42, '#22384a'], [1, '#2b4050'],
    ]);
    g.fill();

    g.save();
    g.beginPath();
    g.moveTo(fl.x, fl.y); g.lineTo(fr.x, fr.y);
    g.lineTo(nr.x, nr.y); g.lineTo(nl.x, nl.y);
    g.closePath();
    g.clip();

    // 石砖：横向行 + 纵向缝，越远越细
    g.lineWidth = 1.1;
    for (var z = -HZ; z <= HZ + 0.01; z += 1.35) {
      var l = project(-HW, z, 0, camX), r = project(HW, z, 0, camX);
      g.strokeStyle = 'rgba(150,190,220,0.075)';
      g.beginPath(); g.moveTo(l.x, l.y); g.lineTo(r.x, r.y); g.stroke();
    }
    for (var x = -HW; x <= HW + 0.01; x += 1.45) {
      var f = project(x, -HZ, 0, camX), n = project(x, HZ, 0, camX);
      g.strokeStyle = 'rgba(150,190,220,0.055)';
      g.beginPath(); g.moveTo(f.x, f.y); g.lineTo(n.x, n.y); g.stroke();
    }

    // 固定伪随机石板色差 / 裂纹 / 水渍
    for (var i = 0; i < 58; i++) {
      var zz = -HZ + ((i * 7.13) % (2 * HZ));
      var xx = -HW + ((i * 11.37) % (2 * HW));
      var q = project(xx, zz, 0, camX);
      var w = 22 * q.s, h = 8 * q.s;
      g.fillStyle = i % 3 === 0 ? 'rgba(90,140,165,0.10)' : 'rgba(10,20,32,0.11)';
      g.fillRect(q.x - w / 2, q.y - h / 2, w, h);
    }

    // 中央法阵（战斗焦点的视觉锚点）
    var cc = project(0, -0.4, 0, camX);
    g.save();
    g.translate(cc.x, cc.y);
    g.scale(1, 0.42);
    g.strokeStyle = 'rgba(150,200,235,0.13)';
    g.lineWidth = 2.4;
    [168, 138, 96].forEach(function (r) {
      g.beginPath(); g.arc(0, 0, r, 0, Math.PI * 2); g.stroke();
    });
    for (var s = 0; s < 12; s++) {
      var ang = s * Math.PI / 6 + t * 0.05;
      g.beginPath();
      g.moveTo(Math.cos(ang) * 96, Math.sin(ang) * 96);
      g.lineTo(Math.cos(ang) * 168, Math.sin(ang) * 168);
      g.stroke();
    }
    g.restore();

    // 阶段环境光池
    var bc = project(0, -3.4, 0, camX);
    g.save();
    g.translate(bc.x, bc.y);
    g.scale(1, 0.4);
    g.fillStyle = rad(g, 0, 0, 10, 330, [
      [0, hexA(p.glow, 0.13)], [0.6, hexA(p.glow, 0.045)], [1, 'rgba(0,0,0,0)'],
    ]);
    g.beginPath(); g.arc(0, 0, 330, 0, Math.PI * 2); g.fill();
    g.restore();

    g.restore(); // clip

    // 远端墙根与近端雾
    g.fillStyle = lin(g, 0, fl.y - 16, 0, fl.y + 42, [
      [0, 'rgba(8,16,28,0.85)'], [1, 'rgba(8,16,28,0)'],
    ]);
    g.fillRect(0, fl.y - 16, C.VIEW.W, 58);
    g.fillStyle = lin(g, 0, nr.y - 60, 0, nr.y + 30, [
      [0, 'rgba(10,20,32,0)'], [1, 'rgba(8,16,26,0.55)'],
    ]);
    g.fillRect(0, nr.y - 60, C.VIEW.W, 90);
  }

  function hexA(hex, a) {
    var h = hex.replace('#', '');
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    var n = parseInt(h, 16);
    return 'rgba(' + ((n >> 16) & 255) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + a + ')';
  }

  /* ---------------- 阴影 / 光环 ---------------- */
  function drawShadow(g, x, z, radius, alpha, camX) {
    var q = project(x, z, 0, camX);
    g.save();
    g.translate(q.x, q.y);
    g.scale(1, 0.40);
    g.fillStyle = rad(g, 0, 0, 2, radius * C.VIEW.UNIT_X * q.s, [
      [0, 'rgba(4,10,18,' + (alpha || 0.42) + ')'], [1, 'rgba(4,10,18,0)'],
    ]);
    g.beginPath(); g.arc(0, 0, radius * C.VIEW.UNIT_X * q.s, 0, Math.PI * 2); g.fill();
    g.restore();
  }

  function drawGroundGlow(g, x, z, radius, color, alpha, camX, pulse) {
    var q = project(x, z, 0, camX);
    g.save();
    g.translate(q.x, q.y);
    g.scale(1, 0.40);
    var r = radius * C.VIEW.UNIT_X * q.s * (pulse || 1);
    g.fillStyle = rad(g, 0, 0, 2, r, [
      [0, hexA(color, alpha * 0.55)], [0.55, hexA(color, alpha * 0.22)], [1, hexA(color, 0)],
    ]);
    g.beginPath(); g.arc(0, 0, r, 0, Math.PI * 2); g.fill();
    g.strokeStyle = hexA(color, alpha * 0.8);
    g.lineWidth = 2.2;
    g.beginPath(); g.arc(0, 0, r * 0.86, 0, Math.PI * 2); g.stroke();
    g.restore();
  }

  /* ---------------- Boss 地面预警 ---------------- */
  function markerPolygon(g, skill, boss, player, camX) {
    var pts = [], i, a;
    var def = C.BOSS_SKILLS[skill];
    // 预警方向必须用「起手时锁定」的朝向，否则会跟着玩家转，读招失去意义
    var ang = (boss.dirX || boss.dirZ)
      ? Math.atan2(boss.dirZ, boss.dirX)
      : Math.atan2(player.z - boss.z, player.x - boss.x);
    var cx = (skill === 'slam') ? (boss.aimX !== undefined ? boss.aimX : player.x) : boss.x;
    var cz = (skill === 'slam') ? (boss.aimZ !== undefined ? boss.aimZ : player.z) : boss.z;
    switch (def.marker) {
      case 'arc':
        pts.push([boss.x, boss.z]);
        var half = (def.arc * Math.PI / 180) / 2;
        for (i = 0; i <= 20; i++) {
          a = ang - half + (half * 2) * (i / 20);
          pts.push([boss.x + Math.cos(a) * def.range, boss.z + Math.sin(a) * def.range]);
        }
        break;
      case 'line':
        var dx = Math.cos(ang), dz = Math.sin(ang);
        var len = 13, w = def.radius;
        pts.push([boss.x - dz * w, boss.z + dx * w]);
        pts.push([boss.x + dx * len - dz * w, boss.z + dz * len + dx * w]);
        pts.push([boss.x + dx * len + dz * w, boss.z + dz * len - dx * w]);
        pts.push([boss.x + dz * w, boss.z - dx * w]);
        break;
      case 'circle':
        for (i = 0; i <= 32; i++) {
          a = i / 32 * Math.PI * 2;
          pts.push([cx + Math.cos(a) * def.radius, cz + Math.sin(a) * def.radius]);
        }
        break;
      case 'ring':
        // 用两段路径表示外环，调用方单独处理内圈
        for (i = 0; i <= 40; i++) {
          a = i / 40 * Math.PI * 2;
          pts.push([boss.x + Math.cos(a) * def.radius, boss.z + Math.sin(a) * def.radius]);
        }
        break;
      default:
        for (i = 0; i <= 32; i++) {
          a = i / 32 * Math.PI * 2;
          pts.push([boss.x + Math.cos(a) * def.radius, boss.z + Math.sin(a) * def.radius]);
        }
    }
    return pts;
  }

  function worldPoly(g, pts, camX) {
    g.beginPath();
    for (var i = 0; i < pts.length; i++) {
      var q = project(pts[i][0], pts[i][1], 0, camX);
      if (i === 0) g.moveTo(q.x, q.y); else g.lineTo(q.x, q.y);
    }
    g.closePath();
  }

  function drawMarker(g, game) {
    var b = game.boss, p = game.player;
    if (b.state !== 'windup' || !b.skill) return;
    var def = C.BOSS_SKILLS[b.skill];
    var prog = clamp(b.t / b.windup, 0, 1);
    var pulse = 0.72 + Math.sin(game.time * C.FEEL.warnPulse) * 0.28;
    var pts = markerPolygon(g, b.skill, b, p, game.camX);

    g.save();
    // 预警只能画在场地内：否则直线/圆形会溢出梯形地面，在画面下缘留下一条突兀的色带
    var HW = C.WORLD.halfW, HZ = C.WORLD.halfZ, cam = game.camX;
    var fL = project(-HW, -HZ, 0, cam), fR = project(HW, -HZ, 0, cam);
    var nL = project(-HW, HZ, 0, cam), nR = project(HW, HZ, 0, cam);
    g.beginPath();
    g.moveTo(fL.x, fL.y); g.lineTo(fR.x, fR.y);
    g.lineTo(nR.x, nR.y); g.lineTo(nL.x, nL.y);
    g.closePath();
    g.clip();
    g.globalCompositeOperation = 'lighter';
    worldPoly(g, pts, game.camX);
    g.fillStyle = hexA(def.color, 0.14 + prog * 0.18);
    g.fill();
    g.strokeStyle = hexA(def.color, 0.55 + pulse * 0.35);
    g.lineWidth = 2 + prog * 3.5;
    g.stroke();

    // 填充进度：从边缘向内收的「即将落下」感
    g.globalCompositeOperation = 'source-over';
    g.save();
    worldPoly(g, pts, game.camX);
    g.clip();
    if (def.marker === 'circle' || def.marker === 'ring' || def.marker === 'arc') {
      var mcx = (def.marker === 'circle' && b.skill === 'slam') ? (b.aimX !== undefined ? b.aimX : p.x) : b.x;
      var mcz = (def.marker === 'circle' && b.skill === 'slam') ? (b.aimZ !== undefined ? b.aimZ : p.z) : b.z;
      var c = project(mcx, mcz, 0, game.camX);
      g.save();
      g.translate(c.x, c.y);
      g.scale(1, 0.4);
      g.strokeStyle = hexA(def.color, 0.7);
      g.lineWidth = 4;
      g.beginPath();
      g.arc(0, 0, Math.max(2, def.radius ? def.radius * 40 * (1 - prog) : def.range * 40 * (1 - prog)), 0, Math.PI * 2);
      g.stroke();
      g.restore();
    }
    g.restore();

    // ring 内圈安全区
    if (def.marker === 'ring') {
      var inner = [], a;
      for (var i = 0; i <= 32; i++) {
        a = i / 32 * Math.PI * 2;
        inner.push([b.x + Math.cos(a) * def.inner, b.z + Math.sin(a) * def.inner]);
      }
      worldPoly(g, inner, game.camX);
      g.fillStyle = 'rgba(90,220,190,0.10)';
      g.fill();
      g.strokeStyle = 'rgba(120,240,205,0.55)';
      g.lineWidth = 2; g.setLineDash([8, 6]); g.stroke(); g.setLineDash([]);
    }

    // 起手瞬间的扩散环
    if (prog < 0.25) {
      var bp = project(b.x, b.z, 0, game.camX);
      g.save(); g.translate(bp.x, bp.y); g.scale(1, 0.4);
      g.strokeStyle = hexA(def.color, (0.25 - prog) * 2.4);
      g.lineWidth = 3;
      g.beginPath(); g.arc(0, 0, 30 + prog * 420, 0, Math.PI * 2); g.stroke();
      g.restore();
    }
    g.restore();
  }

  /* ---------------- 粒子 / 飘字 / 残影 ---------------- */
  function drawParticles(g, list, camX) {
    for (var i = 0; i < list.length; i++) {
      var q = list[i];
      var pr = project(q.x, q.z, q.y || 0, camX);
      var life = clamp(q.life / q.maxLife, 0, 1);
      g.save();
      g.globalAlpha = life * (q.alpha || 1);
      g.globalCompositeOperation = q.glow ? 'lighter' : 'source-over';
      if (q.kind === 'spark') {
        g.strokeStyle = q.color;
        g.lineWidth = Math.max(1, q.size * life);
        g.lineCap = 'round';
        g.beginPath();
        g.moveTo(pr.x, pr.y);
        g.lineTo(pr.x - q.vx * 0.045, pr.y - q.vy * 0.045);
        g.stroke();
      } else if (q.kind === 'ring') {
        g.translate(pr.x, pr.y); g.scale(1, 0.45);
        g.strokeStyle = q.color; g.lineWidth = 3 * life;
        g.beginPath(); g.arc(0, 0, q.size * (1.6 - life), 0, Math.PI * 2); g.stroke();
      } else if (q.kind === 'dust') {
        g.fillStyle = q.color;
        g.beginPath(); g.arc(pr.x, pr.y, q.size * life, 0, Math.PI * 2); g.fill();
      } else {
        g.fillStyle = q.color;
        g.beginPath(); g.arc(pr.x, pr.y, q.size * life * pr.s, 0, Math.PI * 2); g.fill();
      }
      g.restore();
    }
  }

  function drawFloaters(g, list, camX) {
    for (var i = 0; i < list.length; i++) {
      var f = list[i];
      var pr = project(f.x, f.z, f.y || 1.6, camX);
      var life = clamp(f.life / f.maxLife, 0, 1);
      var pop = 1 + (1 - life) * 0.0 + Math.max(0, 0.28 - (1 - life)) * 0.9;
      g.save();
      g.globalAlpha = clamp(life * 1.6, 0, 1);
      g.translate(pr.x, pr.y - (1 - life) * 42);
      g.scale(pop, pop);
      g.font = '900 ' + (f.size || 30) + 'px "Segoe UI", "Microsoft YaHei", sans-serif';
      g.textAlign = 'center'; g.textBaseline = 'middle';
      g.lineWidth = 5; g.strokeStyle = 'rgba(6,12,22,0.85)';
      g.strokeText(f.text, 0, 0);
      g.fillStyle = f.color || '#fff';
      g.fillText(f.text, 0, 0);
      g.restore();
    }
  }

  function drawAfterimages(g, list, camX) {
    for (var i = 0; i < list.length; i++) {
      var a = list[i];
      var pr = project(a.x, a.z, 0, camX);
      g.save();
      g.globalAlpha = clamp(a.life / a.maxLife, 0, 1) * 0.30;
      g.translate(pr.x, pr.y);
      var s = (a.h / 120) * pr.s * (a.scale || 1);
      g.scale(s, s);
      if (a.who === 'boss') chars.phoebe(g, a.pose);
      else chars.fish(g, a.pose);
      g.restore();
    }
  }

  function drawVignette(g, phase, danger) {
    var p = C.PHASES[phase];
    g.fillStyle = rad(g, C.VIEW.CX, 350, 240, 780, [
      [0, 'rgba(0,0,0,0)'], [0.72, 'rgba(4,9,18,0.10)'], [1, 'rgba(3,7,15,0.62)'],
    ]);
    g.fillRect(0, 0, C.VIEW.W, C.VIEW.H);
    if (danger > 0) {
      g.fillStyle = rad(g, C.VIEW.CX, 350, 200, 760, [
        [0, 'rgba(0,0,0,0)'], [1, 'rgba(190,30,55,' + (0.10 + danger * 0.30).toFixed(3) + ')'],
      ]);
      g.fillRect(0, 0, C.VIEW.W, C.VIEW.H);
    }
  }

  var chars = null;
  function setCharacters(mod) { chars = mod; }

  root.BFF = root.BFF || {};
  root.BFF.Art = {
    clamp: clamp, lerp: lerp, ell: ell, lin: lin, rad: rad, blob: blob,
    roundRect: roundRect, star: star, hexA: hexA,
    project: project, depthOf: depthOf, persp: persp,
    drawSky: drawSky, drawRuins: drawRuins, drawGround: drawGround,
    drawShadow: drawShadow, drawGroundGlow: drawGroundGlow,
    drawMarker: drawMarker, drawParticles: drawParticles,
    drawFloaters: drawFloaters, drawAfterimages: drawAfterimages,
    drawVignette: drawVignette,
    setCharacters: setCharacters,
  };
})(window);
