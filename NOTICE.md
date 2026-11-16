# 游戏橱窗 · 使用说明

本仓库是 [penpenWeb](https://stdwang.github.io/penpenWeb/) 的游戏试玩专页，只发布**可直接运行的构建产物**，
不包含任何游戏工程源码。

## 源码状态

| 游戏 | 技术路线 | 源码 |
| --- | --- | --- |
| 雾林回环 MISTLOOP | Three.js / WebGL2 | 公开：[STDwang/mistloop](https://github.com/STDwang/mistloop) |
| 梦境废墟 Dreamscape | Godot 4.7 + Blender | 公开：[STDwang/Dreamscape](https://github.com/STDwang/Dreamscape) |
| 黑暗童话 DarkFairyTale | Godot 4.7 Web | **私有**，仅构建产物 |
| 喵饭家族争夺战 MeowMatch | Cocos Creator 3.8 | **私有**，仅构建产物 |
| 深海花园 Deep Sea Garden | WebGPU / WGSL | **私有归档**，仅构建产物；上游为 [Noniv/abyssal-garden](https://github.com/Noniv/abyssal-garden)（MIT） |

## 使用条款

- 允许：个人在浏览器中试玩、在作品集或简历中链接本页。
- 禁止：反编译 / 解包 `.pck` 与打包脚本、二次分发资源、用于商业用途、声称源码为自己所有。
- 浏览器必然下载全部客户端资源，因此「源码私有」不等于「代码不可见」；本仓库只保证不公开可编译的工程源码。
- 例外：深海花园的上游代码采用 MIT 许可（© 2026 Maksymilian Dendra），该部分允许再分发与商用；上述「禁止二次分发」条款不适用于其上游开源代码，但不得声称原作为自己所有或去除原作者署名。

## 维护

`games.json` 是唯一清单数据源，由 penpenWeb 仓库的 `code/src/content/games.json` 同步而来：

```bash
cd penpenWeb/code
npm run games:sync        # 可用 SHOWCASE_DIR 覆盖本仓库路径
```

之后提交本仓库即可更新橱窗卡片、试玩入口与声明文案。新增游戏时把构建产物放到同名目录，
封面放 `covers/`，并在清单里补一条记录。

`backupBase` 为空时页面不会显示备用入口；配置国内镜像后填入其根地址即可。
