doda 0.1.0：持续聊天，聊清功能和视觉感觉，确认后生成微信原生小程序。

- Windows：下载 `doda-0.1.0-windows-x64-setup.exe`，运行安装程序，再从开始菜单打开 doda。支持 Windows 11 x64，安装程序会在缺少 WebView2 时准备运行环境。
- Mac：下载 `doda-0.1.0-macos-universal.dmg`，将 doda 拖入 Applications。支持 macOS 14 及以上的 M 系列和 Intel Mac。应用使用本地签名，尚未获得 Apple 公证；系统首次打开时可能要求在“系统设置 → 隐私与安全性”允许打开。

两个包均内置 Node、原生预览引擎、Chromium 截图引擎与 SenseVoice 语音识别模型。首次使用请在设置中填写自己的 DeepSeek 和 MiMo key，按需允许麦克风。发布包不包含开发者的 API key、聊天记录或本机作品。

Windows 使用当前用户 DPAPI 保存密钥，作品与设置位于 `%LOCALAPPDATA%\doda`。Mac 使用系统钥匙串保存密钥，作品与设置位于 `~/Library/Application Support/local.doda.desktop`。升级替换应用保留这些数据。

Open Design 的 Apple、Duolingo、Atelier Zero 设计包用于聊天、工作台和生成作品。预览使用官方 glass-easel 编译与运行时，支持手机型号切换和制作中的实时更新。生成工程可以导入微信开发者工具；微信真机与正式上架需要配置自己的 AppID、开发者工具和上传密钥。

发布检查覆盖原生启动器、独立数据目录、内置依赖、预览截图、语音识别模型、DSH 启动、密钥保存和关闭后的进程清理。检查不等同于实体麦克风、原生窗口交互、真实 DeepSeek 联网或微信真机验收。代码及第三方资源的许可证和附加条款随包保留，见 LICENSE、LICENSE.details 和第三方声明。
