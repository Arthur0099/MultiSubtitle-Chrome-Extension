# MultiSubtitle

**[English](#english) · [中文](#中文)**

A Chrome MV3 extension for language learning on Netflix playback pages. It shows
a second official subtitle track on top of the native one, so you can watch with
two languages at the same time.

<p align="center">
  <img src="docs/screenshot.png" alt="Native Japanese subtitle on top, MultiSubtitle Chinese overlay below" width="640">
</p>

<p align="center">
  <em>Native Japanese subtitle (top) with the MultiSubtitle Chinese overlay (bottom).</em>
</p>

---

## English

The extension captures Netflix timed text metadata available to the current
playback session, parses TTML/DFXP/VTT subtitle documents, and renders a
selectable subtitle overlay synchronized with the page `<video>` current time.

This is a feasibility MVP, not a production browser extension.

### What It Does

```text
Netflix playback page
  -> page-world hook observes fetch / XMLHttpRequest / parsed manifest data
  -> extension identifies timed text tracks and subtitle document URLs
  -> background worker fetches subtitle documents with the current browser session
  -> parser converts TTML / DFXP / VTT into timed segments
  -> content script renders the selected subtitle language above the native subtitle area
```

The native Netflix subtitle can stay on one language, while the extension
overlay can display another available official subtitle track, such as English
or Chinese.

### Features

- Chrome MV3 unpacked extension.
- Captures timed text track candidates from Netflix playback data.
- Parses common TTML, DFXP, and VTT subtitle formats.
- Lets the popup select a target overlay subtitle language.
- Caches fetched subtitle segments per video and language during the page session.
- Clears video-scoped subtitle state when the Netflix watch id changes.
- Keeps runtime diagnostics inside the popup details panel instead of the video overlay.

### Install For Local Testing

1. Open Chrome `chrome://extensions`.
2. Enable Developer mode.
3. Click Load unpacked.
4. Select this project directory.
5. Open a Netflix playback page.
6. Open the extension popup and choose a target subtitle language.

If you update the source files, reload the extension in `chrome://extensions`
and refresh the Netflix tab.

### Development

Install optional development dependencies:

```bash
npm install
```

Run parser and syntax checks:

```bash
npm run check
```

Run parser tests only:

```bash
npm test
```

### Semi-Automated Netflix Smoke Test

The smoke test launches a separate Chrome profile and loads this extension. The
first run requires manual Netflix login in the opened browser. The profile is
saved under `.test-profile/`, which is ignored by Git.

```bash
npm run test:netflix
```

You can pass a playback URL:

```bash
npm run test:netflix -- "https://www.netflix.com/watch/81502828"
```

The script prints page state, popup state, and extension console logs every few
seconds.

### Safety And Scope

This project is intended for personal language learning and technical research.

It does not:

- bypass Netflix login, subscription, region, DRM, or playback authorization;
- decrypt media or subtitle payloads outside the browser session;
- download or persist subtitle files;
- redistribute Netflix content or subtitle text;
- provide any Netflix API compatibility guarantee.

Netflix is a trademark of Netflix, Inc. This project is not affiliated with,
endorsed by, or sponsored by Netflix.

### Known Limits

- Netflix playback internals are private and can change without notice.
- Track discovery depends on data visible to the active browser playback session.
- Subtitle availability depends on the selected title, region, account, and Netflix UI state.
- The parser covers the subtitle formats seen during this MVP; more adapters may be needed.
- The overlay is tuned for current Netflix desktop playback UI and may need layout adjustments.

### License

GNU Affero General Public License v3.0 or later (AGPL-3.0-or-later).

You are free to use, modify, and distribute this project, including for
commercial purposes. In return, any distributed or network-deployed derivative
must also be released under the AGPL-3.0 and make its complete source code
available to its users. See [LICENSE](LICENSE) for the full terms.

`SPDX-License-Identifier: AGPL-3.0-or-later`

---

## 中文

这是一个用于 Netflix 播放页**语言学习**的 Chrome MV3 扩展。它在原生字幕之上叠加
显示第二条官方字幕轨,让你可以同时用两种语言观看。

上方截图就是效果:Netflix 原生日文字幕保留在上方,MultiSubtitle 把中文字幕叠加
在下方。

扩展会读取当前播放会话可见的 Netflix 时间轴文本(timed text)元数据,解析
TTML/DFXP/VTT 字幕文档,并渲染一个与页面 `<video>` 当前时间同步的、可选择语言的
字幕叠加层。

这是一个**可行性验证版(MVP)**,而非生产级浏览器扩展。

### 工作原理

```text
Netflix 播放页
  -> 页面世界(page-world)钩子监听 fetch / XMLHttpRequest / 已解析的 manifest 数据
  -> 扩展识别时间轴文本轨道与字幕文档 URL
  -> 后台 worker 用当前浏览器会话拉取字幕文档
  -> 解析器把 TTML / DFXP / VTT 转换成带时间戳的字幕片段
  -> 内容脚本把所选语言的字幕渲染在原生字幕区域上方
```

Netflix 原生字幕可以保持一种语言,扩展叠加层则可显示另一条可用的官方字幕轨,
例如英文或中文。

### 功能特性

- Chrome MV3 未打包(unpacked)扩展。
- 从 Netflix 播放数据中捕获候选的时间轴文本轨道。
- 解析常见的 TTML、DFXP、VTT 字幕格式。
- 在弹窗(popup)中选择目标叠加字幕语言。
- 在页面会话期间,按视频和语言缓存已拉取的字幕片段。
- 当 Netflix watch id 变化时,清除该视频维度的字幕状态。
- 把运行时诊断信息放在弹窗的详情面板里,而不是叠加在视频上。

### 本地安装测试

1. 打开 Chrome 的 `chrome://extensions`。
2. 开启「开发者模式」。
3. 点击「加载已解压的扩展程序」。
4. 选择本项目目录。
5. 打开一个 Netflix 播放页。
6. 打开扩展弹窗,选择目标字幕语言。

如果你修改了源码,需要在 `chrome://extensions` 重新加载扩展,并刷新 Netflix 标签页。

### 开发

安装可选的开发依赖:

```bash
npm install
```

运行解析器与语法检查:

```bash
npm run check
```

仅运行解析器测试:

```bash
npm test
```

### 半自动 Netflix 冒烟测试

该测试会启动一个独立的 Chrome 配置目录并加载本扩展。首次运行需要在打开的浏览器里
手动登录 Netflix。配置目录保存在 `.test-profile/`,已被 Git 忽略。

```bash
npm run test:netflix
```

也可以传入一个播放页 URL:

```bash
npm run test:netflix -- "https://www.netflix.com/watch/81502828"
```

脚本会每隔几秒打印页面状态、弹窗状态和扩展控制台日志。

### 安全与边界

本项目仅用于**个人语言学习与技术研究**。

它**不会**:

- 绕过 Netflix 的登录、订阅、地区、DRM 或播放授权;
- 在浏览器会话之外解密媒体或字幕数据;
- 下载或持久化保存字幕文件;
- 转发 Netflix 内容或字幕文本;
- 提供任何 Netflix API 兼容性保证。

Netflix 是 Netflix, Inc. 的商标。本项目与 Netflix 无任何隶属、背书或赞助关系。

### 已知限制

- Netflix 播放内部机制是私有的,可能随时变更。
- 轨道发现依赖于当前浏览器播放会话可见的数据。
- 字幕可用性取决于所选片名、地区、账号以及 Netflix 界面状态。
- 解析器只覆盖本 MVP 期间见到的字幕格式,可能需要更多适配器。
- 叠加层针对当前 Netflix 桌面端播放界面调校,可能需要调整布局。

### 许可证

GNU Affero 通用公共许可证 v3.0 或更高版本(AGPL-3.0-or-later)。

你可以自由使用、修改和分发本项目,**包括商业用途**。作为交换,任何被分发或部署为
网络服务的衍生作品,也必须以 AGPL-3.0 发布,并向其用户提供完整源代码。完整条款见
[LICENSE](LICENSE)。

`SPDX-License-Identifier: AGPL-3.0-or-later`
