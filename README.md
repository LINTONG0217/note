# 墨记 · GitHub Pages 部署

这个版本包括 Apple Pencil 书写优化、纸张裁边识别、拍摄时的实时裁剪框。

## 首次上线（只需浏览器）

1. 登录 GitHub，点击右上角“+ → New repository”，仓库名填写 `note`，选择 **Public（公开）**，创建仓库。
2. 解压 `note-github-pages.zip`。在仓库中选择“uploading an existing file”，已有文件的仓库则选择“Add file → Upload files”。上传解压文件夹内的所有文件和子文件夹，然后提交（Commit changes）。
3. 在仓库首页确认直接能看到 `index.html`、`js`、`css`、`icons`；不要只上传 ZIP，也不要把它们放在额外一层文件夹里。
4. 进入仓库“Settings → Pages”。在“Build and deployment”里，将“Source”设为“Deploy from a branch”。
5. “Branch”选择 `main` 和 `/(root)`，点击“Save”。如果你的默认分支叫别的名字，选择实际上传文件的分支。
6. 等 GitHub 完成发布，在 Pages 设置页刷新查看“Visit site”。站点地址通常为 `https://你的GitHub用户名.github.io/note/`。如可选，请保持“Enforce HTTPS”启用。
7. 在 iPad 的 Safari 打开该 HTTPS 地址，选择“新建 → 扫描 → 拍照”，允许相机权限，即可实时取景。识别到纸张会显示边框，稳定后变绿；拍照后仍可手动微调。

采用 GitHub Pages 内置的分支发布流程，无需自己编写 Actions、安装依赖、填写构建命令或持续开着电脑。后续将更新文件提交到同一分支，GitHub 会重新发布。

## 为什么选公开仓库

GitHub Free 的 Pages 通常使用公开仓库；私有仓库的 Pages 能力取决于账号套餐。公开仓库会展示本应用代码。这个包只有网页程序，不包含浏览器中保存的个人笔记、照片或备份；请不要把个人备份文件上传到仓库。

## 原来的笔记

新 HTTPS 地址与旧的 HTTP 地址分别保存浏览器数据。先在旧地址“⋯ → 导出全部备份”，再到新地址“⋯ → 从备份恢复”。各设备仍各自保存笔记，外网访问不等于自动云同步。不要通过清除网站数据来更新版本。

## 如果打不开

- 404：检查 Pages 的分支、目录，以及仓库根目录是否有 index.html；确认 Pages 的发布任务已完成。
- 相机不可用：确认是在 Safari 中直接打开 HTTPS 地址，并已允许该网站使用相机；不要通过其他应用的内嵌网页打开。
- GitHub Pages 在不同网络上的访问情况可能不同；如果加载不稳定，先用同一网址在另一网络验证。

当前交付状态：部署文件已准备并通过资源及脚本检查，但本会话没有连接你的 GitHub 账号，尚未创建仓库或发布网站。相机流程已通过模拟测试，iPad 真机仍需确认。
