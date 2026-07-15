# 公卫研习室

一个为 Obsidian Markdown 笔记设计的轻量静态网站。

公开地址：<https://xinl-c137.github.io/public-health-notes/>

## 本地预览

在当前目录运行：

```powershell
python -m http.server 8000
```

然后在浏览器访问 `http://localhost:8000`。不要直接双击 `index.html`，浏览器会阻止网页读取笔记文件。

## 更新 Obsidian 笔记

笔记放在 `公卫课程`，附件放在 `attachments`。两者可以采用相同的课程目录结构。更新文件后运行：

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\update-content.ps1
```

脚本会自动扫描全部 Markdown 笔记、生成课程目录，并为图片等附件建立索引；`attachments` 中的 Markdown 副本不会被重复收录。

网站原生支持标题、列表、表格、引用、代码、粗体、斜体、高亮、普通链接、Obsidian `[[双链]]` 和 `![[附件嵌入]]`。发布前请移除私人信息，并避免把 Obsidian 的整个配置目录公开。

## 免费发布

整个目录可以直接发布到 GitHub Pages、Cloudflare Pages 或 Netlify，不需要构建命令。
