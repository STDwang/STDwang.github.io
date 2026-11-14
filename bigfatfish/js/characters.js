/* =============================================================================
 * characters.js — 程序化矢量角色（分层部件 = 2D 骨骼绑定）
 *
 * 相对原版 3D 模型的改动：
 *  · 原模型 fish 39,770 / phoebe 27,682 顶点，全部椭球拼装、无贴图、平铺色，
 *    在实机里发灰、五官被头发吃掉、没有表情与动作。
 *  · 这里把角色拆成「尾 / 后发 / 裙 / 身体 / 脸 / 五官 / 刘海 / 帽 / 手」等
 *    可独立变换的部件，每层带渐变 + 描边 + 高光，等价于一套 2D 骨架：
 *    呼吸、摆动、翻滚、攻击前倾、抬手预警、失衡跪地都能实时驱动。
 *
 * 局部坐标：脚底为 (0,0)，头顶约 y=-120，左右约 ±58。
 * 调用方负责 translate 到屏幕脚底位置并 scale（基准高度 120）。
 * ========================================================================== */
(function (root) {
  'use strict';
  var A = root.BFF.Art;
  var ell = A.ell, lin = A.lin, rad = A.rad, blob = A.blob, star = A.star;
  var clamp = A.clamp, lerp = A.lerp;

  var INK = '#10203a';          // 统一描边色（深蓝而非纯黑，画面更通透）
  var INK_SOFT = 'rgba(16,32,58,0.55)';

  function outline(g, w) { g.strokeStyle = INK; g.lineWidth = w || 2.2; g.stroke(); }

  /* 蝴蝶结：两片三角软翼 + 中心结 */
  function bow(g, x, y, size, color, edge, tilt) {
    g.save();
    g.translate(x, y);
    g.rotate(tilt || 0);
    var s = size;
    blob(g, [[-s, -s * 0.6], [-s * 0.15, -s * 0.75], [0, 0], [-s * 0.15, s * 0.75], [-s, s * 0.6], [-s * 0.55, 0]]);
    g.fillStyle = color; g.fill(); outline(g, 1.8);
    blob(g, [[s, -s * 0.6], [s * 0.15, -s * 0.75], [0, 0], [s * 0.15, s * 0.75], [s, s * 0.6], [s * 0.55, 0]]);
    g.fillStyle = color; g.fill(); outline(g, 1.8);
    // 高光
    g.fillStyle = 'rgba(255,255,255,0.32)';
    g.beginPath(); g.ellipse(-s * 0.55, -s * 0.28, s * 0.28, s * 0.10, -0.3, 0, Math.PI * 2); g.fill();
    ell(g, 0, 0, s * 0.24, s * 0.24, edge || '#e9c86a', INK, 1.6);
    g.restore();
  }

  /* 大眼睛 */
  function eye(g, x, y, rx, ry, iris, glow) {
    ell(g, x, y, rx + 1.4, ry + 1.4, '#ffffff', INK, 2.2);
    ell(g, x, y + ry * 0.08, rx * 0.76, ry * 0.82, iris, null);
    ell(g, x, y + ry * 0.18, rx * 0.40, ry * 0.48, '#141d3a', null);
    ell(g, x - rx * 0.34, y - ry * 0.36, rx * 0.28, ry * 0.30, '#ffffff', null);
    ell(g, x + rx * 0.36, y + ry * 0.34, rx * 0.13, ry * 0.14, 'rgba(255,255,255,0.75)', null);
    if (glow) {
      g.save(); g.globalCompositeOperation = 'lighter';
      star(g, x, y, rx * 0.45, 4, 0.28, 'rgba(255,255,255,0.55)');
      g.restore();
    }
    // 上睫毛
    g.strokeStyle = INK; g.lineWidth = 2.6; g.lineCap = 'round';
    g.beginPath();
    g.moveTo(x - rx - 1.5, y - ry * 0.62);
    g.quadraticCurveTo(x, y - ry * 1.55, x + rx + 1.5, y - ry * 0.62);
    g.stroke();
    g.beginPath();
    g.moveTo(x + rx + 1.0, y - ry * 0.68); g.lineTo(x + rx + 5.0, y - ry * 1.10);
    g.stroke();
  }

  /* =========================================================================
   * 大肥鱼（玩家）
   * ======================================================================= */
  function fish(g, p) {
    var t = p.t || 0;
    var state = p.state || 'idle';
    var moving = !!p.moving;
    var breathe = Math.sin(t * 2.6) * 1.3;
    var sway = Math.sin(t * (moving ? 11 : 2.2)) * (moving ? 0.055 : 0.018);
    var act = clamp(p.actionT / Math.max(0.001, p.actionDur || 1), 0, 1);
    var facing = p.facing || 1;

    g.save();

    /* 翻滚：整条鱼团起来滚一圈 */
    if (state === 'dodge') {
      var roll = act;
      g.translate(0, -46 + Math.sin(roll * Math.PI) * -12);
      g.rotate(-facing * roll * Math.PI * 2);
      g.scale(0.86, 0.86);
      g.translate(0, 46);
    }

    /* 攻击前倾 / 喝药 */
    var lean = 0;
    if (state === 'attack') lean = Math.sin(act * Math.PI) * 0.20 * facing;
    else if (state === 'hurt') lean = -0.18 * facing * Math.sin(clamp(act, 0, 1) * Math.PI);
    else if (state === 'drink') lean = 0.05 * facing;
    g.translate(0, breathe);
    g.rotate(sway + lean);

    var tailSwing = Math.sin(t * 3.2) * 0.18 + (state === 'attack' ? Math.sin(act * Math.PI) * 0.5 : 0);
    // 海豚尾放到前景绘制（函数末尾），否则会被裙摆和后发完全吃掉，鱼就不像鱼了。

    /* --- 2. 背后大白蝴蝶结 --- */
    g.save();
    g.translate(-3, -58);
    bow(g, 0, 0, 16, '#f7fbff', '#cfe4f5', Math.sin(t * 2) * 0.04);
    g.restore();

    /* --- 3. 后发（大波浪长发，深蓝→亮蓝） --- */
    var hairBack = lin(g, -44, -112, 44, -8, [
      [0, '#173a86'], [0.34, '#2457b8'], [0.66, '#3f92e6'], [1, '#8fd6ff'],
    ]);
    g.save();
    g.translate(0, Math.sin(t * 2.1) * 1.1);
    blob(g, [
      [-36, -100], [-45, -78], [-43, -54], [-47, -30], [-40, -14], [-26, -18],
      [-16, -10], [-14, -28], [-18, -52], [-10, -92], [0, -108],
      [12, -92], [18, -52], [14, -28], [16, -10], [28, -18],
      [40, -14], [47, -30], [43, -54], [45, -78], [36, -100],
    ]);
    g.fillStyle = hairBack; g.fill(); outline(g, 2.4);
    // 发丝高光（波浪）
    g.strokeStyle = 'rgba(150,215,255,0.42)'; g.lineWidth = 2; g.lineCap = 'round';
    for (var hs = 0; hs < 3; hs++) {
      var hx = -34 + hs * 30;
      g.beginPath();
      g.moveTo(hx, -92);
      g.bezierCurveTo(hx - 8, -68, hx + 8, -50, hx - 2, -24);
      g.stroke();
    }
    g.restore();

    /* --- 4. 裙 / 身体 --- */
    // 裙摆（荷叶边）
    var skirt = lin(g, 0, -56, 0, -8, [[0, '#ffffff'], [0.55, '#eaf4ff'], [1, '#a9c8e8']]);
    g.save();
    g.translate(0, Math.sin(t * 2.6) * 0.8);
    blob(g, [
      [-18, -52], [-26, -40], [-33, -16], [-25, -8], [-16, -13], [-8, -7],
      [0, -13], [8, -7], [16, -13], [25, -8], [33, -16], [26, -40], [18, -52],
    ]);
    g.fillStyle = skirt; g.fill(); outline(g, 2.3);
    // 深蓝裙片
    g.fillStyle = lin(g, 0, -48, 0, -12, [[0, '#2a5fae'], [1, '#17346e']]);
    g.beginPath();
    g.moveTo(-18, -48); g.lineTo(18, -48); g.lineTo(27, -14);
    g.quadraticCurveTo(0, -24, -27, -14); g.closePath();
    g.fill();
    // 荷叶边底缘
    g.fillStyle = '#ffffff';
    for (var f = -3; f <= 3; f++) {
      ell(g, f * 8.6, -12 + Math.abs(f) * 1.0, 5.4, 3.6, '#ffffff', INK_SOFT, 1);
    }
    // 白围裙
    g.fillStyle = '#f8fcff';
    g.beginPath();
    g.moveTo(-11, -48); g.lineTo(11, -48); g.lineTo(15, -22);
    g.quadraticCurveTo(0, -17, -15, -22); g.closePath();
    g.fill(); outline(g, 1.8);
    // 鲸鱼徽章
    g.save(); g.translate(0, -33); g.scale(0.62, 0.62);
    g.fillStyle = '#2e7ac6';
    g.beginPath();
    g.moveTo(-11, 2); g.quadraticCurveTo(-4, -9, 7, -7);
    g.quadraticCurveTo(13, -6, 13, 0); g.quadraticCurveTo(8, 5, 0, 4);
    g.quadraticCurveTo(-7, 4, -11, 2); g.closePath(); g.fill();
    g.fillStyle = '#2e7ac6';
    g.beginPath(); g.moveTo(-10, 1); g.lineTo(-17, -5); g.lineTo(-15, 5); g.closePath(); g.fill();
    ell(g, 6, -3, 1.3, 1.3, '#ffffff');
    g.restore();
    // 金蝴蝶结（腰侧）
    bow(g, 19, -43, 8, '#ffd76a', '#e8a93d', 0.16);
    g.restore();

    /* --- 5. 手臂（攻击时前伸） --- */
    var reach = (state === 'attack') ? Math.sin(act * Math.PI) * 15 : 0;
    if (state === 'drink') reach = 7;
    [-1, 1].forEach(function (sgn) {
      g.save();
      g.translate(sgn * 21, -52);
      g.rotate(sgn * (0.25 + (reach > 0 ? 0.4 : 0)));
      ell(g, sgn * (4 + reach * 0.5), -6, 9, 13, '#f3d9c4', INK, 1.8, -sgn * 0.25);
      ell(g, sgn * (5 + reach), -15, 6.5, 6.5, '#f7e2d0', INK, 1.6);
      g.restore();
    });
    // 喝药时手上的小瓶
    if (state === 'drink') {
      g.save(); g.translate(facing * 30, -64); g.rotate(-0.2);
      g.fillStyle = '#ff8899'; A.roundRect(g, -5, -8, 10, 14, 3); g.fill(); outline(g, 1.6);
      g.fillStyle = '#ffe9a8'; g.fillRect(-3, -12, 6, 4);
      g.fillStyle = 'rgba(255,255,255,0.55)'; g.fillRect(-3, -6, 2, 8);
      g.restore();
    }

    /* --- 6. 头 / 脸 --- */
    var faceY = -84;
    // 鳍耳
    [-1, 1].forEach(function (sgn) {
      g.save(); g.translate(sgn * 31, faceY + 2); g.rotate(sgn * 0.3 + Math.sin(t * 3) * 0.06);
      blob(g, [[0, -9], [sgn * 13, -12], [sgn * 16, 0], [sgn * 9, 9], [0, 7]]);
      g.fillStyle = lin(g, 0, -10, 0, 9, [[0, '#7fd0f5'], [1, '#2d70c4']]);
      g.fill(); outline(g, 1.8);
      g.strokeStyle = 'rgba(220,245,255,0.6)'; g.lineWidth = 1.2;
      g.beginPath(); g.moveTo(sgn * 3, -5); g.lineTo(sgn * 11, -3); g.stroke();
      g.restore();
    });

    var skin = rad(g, -8, faceY - 10, 4, 46, [[0, '#fff6ea'], [0.7, '#ffe6cf'], [1, '#efc4a6']]);
    ell(g, 0, faceY, 31, 29, skin, INK, 2.3);
    // 腮红
    ell(g, -20, faceY + 8, 6.4, 3.6, 'rgba(255,130,150,0.45)');
    ell(g, 20, faceY + 8, 6.4, 3.6, 'rgba(255,130,150,0.45)');
    // 眼
    if (state === 'hurt' || state === 'dead') {
      g.strokeStyle = INK; g.lineWidth = 2.6; g.lineCap = 'round';
      [-12, 12].forEach(function (ex) {
        g.beginPath(); g.moveTo(ex - 5, faceY - 3); g.lineTo(ex + 5, faceY + 4);
        g.moveTo(ex + 5, faceY - 3); g.lineTo(ex - 5, faceY + 4); g.stroke();
      });
    } else {
      eye(g, -12, faceY - 1, 8.2, 10.2, '#3d92e8', p.focus > 0);
      eye(g, 12, faceY - 1, 8.2, 10.2, '#3d92e8', p.focus > 0);
    }
    // 嘴（表情随状态）
    g.strokeStyle = '#b7555c'; g.lineWidth = 1.8; g.lineCap = 'round';
    g.beginPath();
    if (state === 'attack') { g.arc(0, faceY + 12, 4.4, 0.1, Math.PI - 0.1); }
    else if (state === 'hurt') { g.moveTo(-4, faceY + 15); g.lineTo(4, faceY + 12); }
    else { g.moveTo(-3.5, faceY + 12); g.quadraticCurveTo(0, faceY + 16, 3.5, faceY + 12); }
    g.stroke();

    /* --- 7. 刘海（波浪，露出眼睛） --- */
    var fringe = lin(g, -32, -112, 32, -84, [[0, '#17418e'], [0.5, '#2c72cf'], [1, '#74c4f5']]);
    g.save();
    blob(g, [
      [-31, -98], [-33, -110], [-20, -118], [0, -120], [20, -118], [33, -110], [31, -98],
      [24, -100], [20, -92], [13, -99], [6, -91], [0, -100], [-7, -91], [-14, -99], [-22, -92], [-26, -100],
    ]);
    g.fillStyle = fringe; g.fill(); outline(g, 2.2);
    g.strokeStyle = 'rgba(160,220,255,0.45)'; g.lineWidth = 1.8;
    g.beginPath(); g.moveTo(-24, -110); g.quadraticCurveTo(-12, -104, -6, -96); g.stroke();
    g.beginPath(); g.moveTo(10, -112); g.quadraticCurveTo(20, -106, 24, -98); g.stroke();
    g.restore();

    /* --- 8. 白荷叶头带 --- */
    g.save();
    g.translate(0, -108 + Math.sin(t * 2.2) * 0.8);
    g.fillStyle = '#ffffff';
    g.beginPath();
    g.moveTo(-30, 3); g.quadraticCurveTo(0, -7, 30, 3);
    g.lineTo(30, 8); g.quadraticCurveTo(0, -1, -30, 8); g.closePath();
    g.fill(); outline(g, 1.6);
    for (var fr = -4; fr <= 4; fr++) ell(g, fr * 7, 6, 4.4, 3.4, '#ffffff', INK_SOFT, 0.9);
    g.restore();

    /* --- 9. 呆毛 --- */
    g.save();
    g.translate(2, -119);
    g.rotate(Math.sin(t * 3.1) * 0.14);
    g.strokeStyle = '#2b6ec6'; g.lineWidth = 3.4; g.lineCap = 'round';
    g.beginPath();
    g.moveTo(0, 0); g.bezierCurveTo(-4, -10, 8, -13, 4, -22);
    g.stroke();
    ell(g, 4, -23, 2.6, 2.6, '#7fd0f5');
    g.restore();

    /* --- 10. 领结 + 金扣 --- */
    g.save(); g.translate(0, -57);
    bow(g, 0, 0, 9, '#1d4b9c', '#f5cf63', 0);
    g.restore();

    /* --- 11. 前景海豚尾：从裙侧甩出，让「鱼」一眼可辨 --- */
    g.save();
    g.translate(19, -27);
    g.rotate(-0.12 + tailSwing * 0.9 + (state === 'dodge' ? act * 1.2 : 0));
    var finGrad = lin(g, 0, -30, 34, 8, [
      [0, '#8fdcff'], [0.38, '#4ba7e8'], [0.72, '#2b6fc8'], [1, '#1a3d80'],
    ]);
    // 尾柄
    blob(g, [[-8, 8], [2, 4], [12, -2], [16, -10], [8, -12], [0, -6], [-6, 0]]);
    g.fillStyle = '#2f76cc'; g.fill(); outline(g, 1.8);
    // 上下两片尾叶
    blob(g, [[12, -6], [24, -18], [40, -27], [38, -14], [30, -4], [18, 0]]);
    g.fillStyle = finGrad; g.fill(); outline(g, 2.1);
    blob(g, [[12, -2], [26, 2], [40, 12], [32, 18], [20, 12], [14, 6]]);
    g.fillStyle = lin(g, 0, 0, 36, 18, [[0, '#3a86d8'], [1, '#17407f']]);
    g.fill(); outline(g, 2.1);
    // 尾鳍纹路 + 高光
    g.strokeStyle = 'rgba(200,238,255,0.5)'; g.lineWidth = 1.5; g.lineCap = 'round';
    g.beginPath(); g.moveTo(16, -5); g.lineTo(34, -22); g.stroke();
    g.beginPath(); g.moveTo(18, -3); g.lineTo(33, -14); g.stroke();
    g.beginPath(); g.moveTo(16, 3); g.lineTo(34, 12); g.stroke();
    g.restore();

    /* --- 状态叠加：无敌 / focus / 闪白 --- */
    if (p.invuln > 0) {
      g.save(); g.globalCompositeOperation = 'lighter';
      g.strokeStyle = 'rgba(150,225,255,' + (0.22 + Math.sin(t * 22) * 0.10) + ')';
      g.lineWidth = 4;
      g.beginPath(); g.ellipse(0, -58, 42, 64, 0, 0, Math.PI * 2); g.stroke();
      g.restore();
    }
    if (p.focus > 0) {
      g.save(); g.globalCompositeOperation = 'lighter';
      g.fillStyle = rad(g, 0, -58, 8, 76, [
        [0, 'rgba(110,220,255,0.20)'], [1, 'rgba(110,220,255,0)'],
      ]);
      g.beginPath(); g.arc(0, -58, 76, 0, Math.PI * 2); g.fill();
      g.restore();
    }
    if (p.flash > 0) {
      g.save(); g.globalCompositeOperation = 'lighter';
      g.fillStyle = 'rgba(255,255,255,' + (p.flash * 0.55) + ')';
      g.beginPath(); g.ellipse(0, -58, 42, 62, 0, 0, Math.PI * 2); g.fill();
      g.restore();
    }

    g.restore();
  }

  /* =========================================================================
   * 菲比（Boss）
   * ======================================================================= */
  function phoebe(g, p) {
    var t = p.t || 0;
    var state = p.state || 'idle';
    var phase = p.phase || 0;
    var act = clamp(p.actionT / Math.max(0.001, p.actionDur || 1), 0, 1);
    var wp = clamp(p.windupProg || 0, 0, 1);
    var breathe = Math.sin(t * 1.7) * 1.6;
    var broken = state === 'broken';
    var dead = state === 'dead';

    g.save();
    if (dead) { g.translate(0, 12); g.rotate(-0.9); g.scale(1.02, 0.72); }
    else if (broken) { g.translate(0, 16); g.rotate(-0.13); g.scale(1.05, 0.82); }
    else g.translate(0, breathe + (state === 'windup' ? Math.sin(wp * Math.PI) * -3 : 0));

    /* --- 1. 奶油金长直发（背后，垂到脚踝） --- */
    var hair = lin(g, -44, -116, 44, 0, [
      [0, '#fff2c8'], [0.35, '#f6dfa3'], [0.72, '#e2bf7d'], [1, '#bc955c'],
    ]);
    g.save();
    g.translate(0, Math.sin(t * 1.5) * 1.2);
    blob(g, [
      [-34, -100], [-43, -80], [-44, -46], [-42, -12], [-34, -2], [-22, -8],
      [-16, -4], [-14, -30], [-12, -78], [0, -110], [12, -78], [14, -30],
      [16, -4], [22, -8], [34, -2], [42, -12], [44, -46], [43, -80], [34, -100],
    ]);
    g.fillStyle = hair; g.fill(); outline(g, 2.4);
    g.strokeStyle = 'rgba(255,250,220,0.55)'; g.lineWidth = 2; g.lineCap = 'round';
    [-32, -20, 20, 32].forEach(function (hx) {
      g.beginPath(); g.moveTo(hx, -92);
      g.bezierCurveTo(hx - 4, -60, hx + 4, -30, hx, -8); g.stroke();
    });
    g.restore();

    /* --- 2. 身体：白外套 + 蓝领带 + 背带 --- */
    var coat = lin(g, 0, -58, 0, -14, [[0, '#ffffff'], [0.6, '#eef4fa'], [1, '#c9d8e8']]);
    g.save();
    blob(g, [[-19, -57], [-25, -44], [-27, -18], [-18, -12], [0, -15], [18, -12], [27, -18], [25, -44], [19, -57]]);
    g.fillStyle = coat; g.fill(); outline(g, 2.3);
    // 背带
    g.fillStyle = '#264a86';
    g.save(); g.translate(-10, -36); g.rotate(0.10); g.fillRect(-3.2, -20, 6.4, 40); g.restore();
    g.save(); g.translate(10, -36); g.rotate(-0.10); g.fillRect(-3.2, -20, 6.4, 40); g.restore();
    // 金扣
    [-10, 10].forEach(function (bx) {
      ell(g, bx, -22, 3.4, 3.4, '#f4cf6b', INK, 1.3);
    });
    // 蓝领带
    g.fillStyle = '#3d7fd0';
    g.beginPath();
    g.moveTo(-5, -56); g.lineTo(5, -56); g.lineTo(3, -48); g.lineTo(6, -32);
    g.lineTo(0, -27); g.lineTo(-6, -32); g.lineTo(-3, -48); g.closePath();
    g.fill(); outline(g, 1.4);
    // 衣襟线
    g.strokeStyle = 'rgba(60,90,130,0.32)'; g.lineWidth = 1.4;
    g.beginPath(); g.moveTo(0, -48); g.lineTo(0, -14); g.stroke();
    // 黑短裙
    g.fillStyle = lin(g, 0, -22, 0, -6, [[0, '#2b2f3f'], [1, '#171a26']]);
    g.beginPath();
    g.moveTo(-20, -22); g.lineTo(20, -22); g.lineTo(27, -7);
    g.quadraticCurveTo(0, -13, -27, -7); g.closePath();
    g.fill(); outline(g, 1.8);
    g.restore();

    /* --- 3. 条纹袜 + 鞋 --- */
    [-9, 9].forEach(function (lx) {
      g.save(); g.translate(lx, 0);
      g.fillStyle = '#f3e7d2';
      A.roundRect(g, -5, -13, 10, 13, 3); g.fill(); outline(g, 1.5);
      g.strokeStyle = '#2b3c60'; g.lineWidth = 2;
      for (var st = 0; st < 2; st++) {
        g.beginPath(); g.moveTo(-5, -10 + st * 5); g.lineTo(5, -10 + st * 5); g.stroke();
      }
      ell(g, 0, -1, 9, 5.5, '#20222e', INK, 1.6);
      g.restore();
    });

    /* --- 4. 黑手套双手（预警时抬起） --- */
    var raise = (state === 'windup') ? wp : (state === 'strike' ? 1 - act * 0.6 : 0);
    [-1, 1].forEach(function (sgn) {
      g.save();
      g.translate(sgn * 24, -50);
      g.rotate(sgn * lerp(0.10, -1.15, raise));
      g.fillStyle = '#f2f6fb';
      A.roundRect(g, -5, -2, 10, 23, 4); g.fill(); outline(g, 1.6);
      ell(g, 0, 22, 7.6, 7.6, lin(g, 0, 14, 0, 30, [[0, '#3b4054'], [1, '#171a26']]), INK, 1.7);
      // 袖口金线
      g.strokeStyle = 'rgba(217,181,106,.65)'; g.lineWidth = 1.2;
      g.beginPath(); g.moveTo(-5, 16); g.lineTo(5, 16); g.stroke();
      g.restore();
    });

    /* --- 5. 头 / 脸 --- */
    var faceY = -86;
    var skin = rad(g, -8, faceY - 12, 4, 48, [[0, '#fff8ee'], [0.7, '#ffeacf'], [1, '#eec5a4']]);
    ell(g, 0, faceY, 32, 30, skin, INK, 2.4);
    ell(g, -21, faceY + 9, 6.6, 3.6, 'rgba(245,130,150,0.42)');
    ell(g, 21, faceY + 9, 6.6, 3.6, 'rgba(245,130,150,0.42)');

    if (broken || dead) {
      g.strokeStyle = INK; g.lineWidth = 2.8; g.lineCap = 'round';
      [-13, 13].forEach(function (ex) {
        g.beginPath(); g.moveTo(ex - 6, faceY - 3); g.lineTo(ex + 6, faceY + 5);
        g.moveTo(ex + 6, faceY - 3); g.lineTo(ex - 6, faceY + 5); g.stroke();
      });
    } else {
      eye(g, -13, faceY - 1, 9.0, 11.0, phase >= 2 ? '#c765ff' : '#9a6fd6', phase >= 2);
      eye(g, 13, faceY - 1, 9.0, 11.0, phase >= 2 ? '#c765ff' : '#9a6fd6', phase >= 2);
    }
    g.strokeStyle = '#b7606a'; g.lineWidth = 1.8; g.lineCap = 'round';
    g.beginPath();
    if (state === 'windup' || state === 'strike') g.arc(0, faceY + 11, 4.6, 0.08, Math.PI - 0.08);
    else if (broken) { g.moveTo(-5, faceY + 14); g.quadraticCurveTo(0, faceY + 10, 5, faceY + 14); }
    else { g.moveTo(-3.4, faceY + 12); g.quadraticCurveTo(0, faceY + 16, 3.4, faceY + 12); }
    g.stroke();

    /* --- 6. 奶油金齐刘海 --- */
    var fringe = lin(g, -34, -116, 34, -88, [[0, '#fff4cf'], [0.55, '#f4dda2'], [1, '#dcb677']]);
    blob(g, [
      [-32, -98], [-34, -110], [-20, -118], [0, -121], [20, -118], [34, -110], [32, -98],
      [26, -101], [21, -93], [14, -100], [7, -92], [0, -101], [-8, -92], [-15, -100], [-23, -93], [-27, -101],
    ]);
    g.fillStyle = fringe; g.fill(); outline(g, 2.2);
    // 蓝十字发夹
    g.save(); g.translate(-24, -100); g.rotate(-0.3);
    g.fillStyle = '#4d93e0';
    A.roundRect(g, -2, -7, 4, 14, 1.5); g.fill();
    A.roundRect(g, -7, -2, 14, 4, 1.5); g.fill();
    g.strokeStyle = '#d8ecff'; g.lineWidth = 1; g.strokeRect(-2, -7, 4, 14);
    g.restore();

    /* --- 7. 帽子：白檐 + 黑顶 + 紫波纹带 --- */
    g.save();
    g.translate(0, -112 + Math.sin(t * 1.7) * 0.7);
    // 帽檐
    ell(g, 0, 0, 55, 11, lin(g, 0, -10, 0, 10, [[0, '#ffffff'], [1, '#c9d6e6']]), INK, 2.3);
    ell(g, 0, -2, 52, 8, '#f8fbff', null);
    g.strokeStyle = 'rgba(150,180,215,0.55)'; g.lineWidth = 1.2;
    g.beginPath(); g.ellipse(0, 1, 48, 7, 0, 0, Math.PI * 2); g.stroke();
    // 黑顶
    g.fillStyle = lin(g, 0, -34, 0, -3, [[0, '#3a3f52'], [0.55, '#242838'], [1, '#171a26']]);
    g.beginPath();
    g.moveTo(-31, -4);
    g.bezierCurveTo(-31, -28, -18, -40, 0, -40);
    g.bezierCurveTo(18, -40, 31, -28, 31, -4);
    g.quadraticCurveTo(0, 4, -31, -4);
    g.closePath(); g.fill(); outline(g, 2.2);
    // 紫波纹带
    g.save();
    g.beginPath(); g.rect(-31, -14, 62, 9); g.clip();
    g.fillStyle = '#8a63c8'; g.fillRect(-31, -14, 62, 9);
    g.strokeStyle = 'rgba(220,190,255,0.55)'; g.lineWidth = 2;
    for (var wv = -3; wv <= 3; wv++) {
      g.beginPath();
      g.moveTo(wv * 10 - 6, -5);
      g.quadraticCurveTo(wv * 10, -14, wv * 10 + 6, -5);
      g.stroke();
    }
    g.restore();
    // 高光
    g.fillStyle = 'rgba(255,255,255,0.12)';
    g.beginPath(); g.ellipse(-14, -26, 8, 12, -0.4, 0, Math.PI * 2); g.fill();
    g.restore();

    /* --- 8. 阶段光环 / 符文 --- */
    if (phase >= 2 && !dead) {
      g.save();
      g.globalCompositeOperation = 'lighter';
      var haloCol = phase >= 2 ? '#c46bff' : '#ff9b5c';
      g.fillStyle = rad(g, 0, -66, 20, 96, [
        [0, A.hexA(haloCol, 0.14)], [1, A.hexA(haloCol, 0)],
      ]);
      g.beginPath(); g.arc(0, -66, 96, 0, Math.PI * 2); g.fill();
      // 头顶旋转符文
      g.translate(0, -152);
      g.rotate(t * 0.7);
      g.strokeStyle = A.hexA(haloCol, 0.55); g.lineWidth = 2;
      for (var ri = 0; ri < 3; ri++) {
        var rr = 9 + ri * 6;
        g.beginPath();
        g.arc(0, 0, rr, ri * 0.6, ri * 0.6 + Math.PI * 1.2);
        g.stroke();
      }
      g.restore();
    }
    if (state === 'windup' && !dead) {
      g.save();
      g.globalCompositeOperation = 'lighter';
      g.translate(0, -150);
      g.rotate(t * 1.6);
      g.strokeStyle = A.hexA((root.BFF.CONFIG.BOSS_SKILLS[p.skill] || {}).color || '#ff8a8a', 0.75);
      g.lineWidth = 2.6;
      star(g, 0, 0, 15 + wp * 8, 6, 0.55, null);
      g.stroke();
      g.restore();
    }
    if (broken) {
      g.save(); g.globalCompositeOperation = 'lighter';
      for (var si = 0; si < 3; si++) {
        var sa = t * 2.2 + si * 2.1;
        star(g, Math.cos(sa) * 34, -130 + Math.sin(sa * 1.4) * 9, 5, 4, 0.35, 'rgba(255,225,120,0.8)');
      }
      g.restore();
    }
    if (p.flash > 0) {
      g.save(); g.globalCompositeOperation = 'lighter';
      g.fillStyle = 'rgba(255,255,255,' + (p.flash * 0.5) + ')';
      g.beginPath(); g.ellipse(0, -62, 46, 68, 0, 0, Math.PI * 2); g.fill();
      g.restore();
    }

    g.restore();
  }

  root.BFF = root.BFF || {};
  root.BFF.Characters = { fish: fish, phoebe: phoebe };
  A.setCharacters({ fish: fish, phoebe: phoebe });
})(window);
