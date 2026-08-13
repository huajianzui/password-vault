# CipherVault (暗盒密码管家) 🔐

> 零知识、零服务器开销、高颜值、支持 PC/移动端 PWA 离线运行与 WebDAV / GitHub Gist 免费云同步的开源密码管理应用。

---

## 🌟 核心特性

- 🛡️ **端到端零知识加密 (Zero-Knowledge Architecture)**：
  - 核心加密算法基于现代浏览器原生 `Web Crypto API`（`PBKDF2` 100,000 次迭代密钥派生 + `AES-GCM 256-bit` 加密）。
  - 主密码仅存留于您的脑海中，不上传、不落盘。密码库离开浏览器前已完成重重加密。
- 📱 **PC & 移动端全平台互通 (PWA 支持)**：
  - 支持手机端（iOS / Android）浏览器打开后“添加到主屏幕”，作为独立全屏 App 运行，离线可用。
- ☁️ **零服务器成本无缝同步 (Zero-Server Cost Sync)**：
  - **WebDAV 云盘**：一键绑定坚果云、OneDrive、iCloud、Nextcloud 等 WebDAV 接口。
  - **GitHub Gist**：支持利用私有 Gist API 自动同步加密 JSON。
- 🚀 **极速数据迁移 (Import & Export Wizard)**：
  - 一键导入从 **Chrome / Edge / Firefox 导出的 CSV 密码文件** 或 **Bitwarden JSON 导出备份**。
- 🔑 **内置强密码生成器 & 2FA TOTP 动态口令**：
  - 支持 RFC 6238 标准的 30 秒 2FA 动态验证码实时计算。
  - 密码复制后 **15 秒自动清空系统剪贴板**，防止隐私偷窥。
- 📊 **密码健康度诊断 (Vault Audit)**：
  - 自动检测弱密码、重复使用密码并提示风险。

---

## 📖 GitHub Gist 私有云同步详细操作步骤

使用 GitHub Gist 同步不仅**完全免费、零服务器开销**，而且数据以私有密文的形式保存在您自己的 GitHub 账号中。

### 第一步：获取 GitHub Personal Access Token (PAT)

1. 登录您的 GitHub 账号，点击右上角个人头像 ➡️ **`Settings`**。
2. 滚动到最下方左侧菜单，点击 **`Developer settings`**。
3. 选择 **`Personal access tokens`** ➡️ 点击 **`Tokens (classic)`**。
4. 点击右上角 **`Generate new token`** -> **`Generate new token (classic)`**。
5. 在 `Note` 中填入名称（如 `CipherVault-Sync`）。
6. 在权限列表中，**勾选 `gist`**（创建和管理私有 Gists 的权限）。
7. 滚动到页面底部点击 **`Generate token`**，**复制生成的 Token 字符串**（格式如 `ghp_xxxxxxxxxxxx`，注意只显示一次，请先保存好）。

### 第二步：在第一台设备中配置 CipherVault Gist 同步

1. 打开 CipherVault 应用，点击左侧边栏顶部的 **“云同步 / WebDAV 设置”** 图标。
2. 将【同步模式】切换为 **`GitHub Gist 私有同步`**。
3. 在【GitHub Token】框中粘贴上面获取的 Token。
4. **【Gist ID】保持留空**（首次配置留空，系统会自动为您在 GitHub 下建一个私有 Gist 并自动生成 ID）。
5. 点击 **`保存并测试同步`**。页面提示成功后，即可自动推送到 GitHub Gist！

### 第三步：在手机/第二台设备中拉取同步数据

1. 在手机或第二台电脑上打开 CipherVault，点击“云同步”图标。
2. 同步模式选择 **`GitHub Gist 私有同步`**。
3. 填入相同的 **`GitHub Token`**，以及第一台设备生成的 **`Gist ID`**。
4. 点击保存，新设备即可无缝解密同步所有最新的账号密码数据！

---

## 🚀 极速开源部署指南（他人如何 1 分钟开箱即用）

### 方式 1：GitHub Pages 一键 Fork 即用（推荐，0 门槛）

1. 点击本仓库右上角的 **Fork** 按钮，将项目 Fork 到您自己的 GitHub 账号下。
2. 在您 Fork 后的仓库中，进入 `Settings` -> `Pages`。
3. Source 选择 `Deploy from a branch`，分支选择 `master` 并保存。
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

## 🔒 隐私与安全性保障

- **主密码不可逆验证**：系统使用派生密钥对特定标记加密，只有解密成功才代表主密码正确，避免明文或 Hash 校验泄漏。
- **自动锁定防护**：闲置 15 分钟（可自定义）自动擦除内存中的密钥并返回锁屏状态。
- **剪贴板自动清理**：单击复制密码后，倒计时 15 秒自动清空剪贴板。

---

## 📄 开源许可证

[MIT License](LICENSE)
