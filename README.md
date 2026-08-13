# CipherVault (暗盒密码管家) 🔐

> 零知识、零服务器开销、高颜值、支持 PC/移动端 PWA 离线运行与 WebDAV 免费云同步的开源密码管理应用。

---

## 🌟 核心特性

- 🛡️ **端到端零知识加密 (Zero-Knowledge Architecture)**：
  - 核心加密算法基于现代浏览器原生 `Web Crypto API`（`PBKDF2` 100,000 次迭代密钥派生 + `AES-GCM 256-bit` 加密）。
  - 主密码仅存留于您的脑海中，不上传、不落盘。密码库离开浏览器前已完成重重加密。
- 📱 **PC & 移动端全平台互通 (PWA 支持)**：
  - 支持手机端（iOS / Android）浏览器打开后“添加到主屏幕”，作为独立全屏 App 运行，离线可用。
- ☁️ **零服务器成本无缝同步 (Zero-Server Cost Sync)**：
  - ** WebDAV 云盘**：一键绑定坚果云、OneDrive、iCloud、Nextcloud 等 WebDAV 接口。
  - ** GitHub Gist**：支持利用私有 Gist API 自动同步加密 JSON。
- 🚀 **极速数据迁移 (Import & Export Wizard)**：
  - 一键导入从 **Chrome / Edge / Firefox 导出的 CSV 密码文件** 或 **Bitwarden JSON 导出备份**。
- 🔑 **内置强密码生成器 & 2FA TOTP 动态口令**：
  - 支持 RFC 6238 标准的 30 秒 2FA 动态验证码实时计算。
  - 密码复制后 **15 秒自动清空系统剪贴板**，防止隐私偷窥。
- 📊 **密码健康度诊断 (Vault Audit)**：
  - 自动检测弱密码、重复使用密码并提示风险。

---

## 🚀 极速开源部署指南（他人如何 1 分钟开箱即用）

### 方式 1：GitHub Pages 一键 Fork 即用（推荐，0 门槛）

1. 点击本仓库右上角的 **Fork** 按钮，将项目 Fork 到您自己的 GitHub 账号下。
2. 在您 Fork 后的仓库中，进入 `Settings` -> `Pages`。
3. Source 选择 `Deploy from a branch`，分支选择 `main` / `root` 并保存。
4. 30 秒后即可访问您专属的密码管家链接（如 `https://yourname.github.io/password-vault`）。

---

### 方式 2：Docker 一条命令极速运行 (适合 NAS / 服务器玩家)

```bash
docker run -d \
  --name password-vault \
  -p 8080:80 \
  --restart always \
  ghcr.io/yourname/password-vault:latest
```
运行后访问 `http://localhost:8080` 即可使用。

---

### 方式 3：纯本地免安装双击运行

1. 下载或 Clone 本项目代码包到本地。
2. 直接双击 `index.html` 即可在本地浏览器中安全离线使用！

---

## 🛠️ 本地开发与测试

因为应用采用纯原生 HTML5 / ES6 Module 架构，本地预览建议使用任何轻量静态 Web 服务器：

```bash
# 使用 npx http-server 启动本地服务器
npx http-server D:/code/password-vault -p 8080
```

打开浏览器访问 `http://localhost:8080`。

---

## 🔒 隐私与安全性保障

- **主密码不可逆验证**：系统使用派生密钥对特定标记加密，只有解密成功才代表主密码正确，避免明文或 Hash 校验泄漏。
- **自动锁定防护**：闲置 15 分钟（可自定义）自动擦除内存中的密钥并返回锁屏状态。
- **剪贴板自动清理**：单击复制密码后，倒计时 15 秒自动清空剪贴板。

---

## 📄 开源许可证

[MIT License](LICENSE)
