<div align="center">
  <img src="src/assets/logo-readme.png" alt="Zozstry Logo" width="500">

  # 
  **The High-Performance USB Boot Utility.**

  [![Tauri](https://img.shields.io/badge/Tauri-Build-blue?logo=tauri&logoColor=white&style=for-the-badge)](#)
  [![React](https://img.shields.io/badge/React-UI-61dafb?logo=react&logoColor=black&style=for-the-badge)](#)
  [![Python](https://img.shields.io/badge/Python-Engine-3776AB?logo=python&logoColor=white&style=for-the-badge)](#)
  [![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg?style=for-the-badge)](#)

  *Format effortlessly. Bypass limits natively. Deploy rapidly.*
</div>

---

### 📖 Overview

**Zozstry** is an ultra-fast, open-source bootable USB creator. Engineered with a low-level Python core and a sleek React/Tauri interface, it solves deployment headaches caused by modern UEFI firmware. It seamlessly handles OS payloads that exceed the FAT32 size limit without requiring cumbersome file splitting or compromising Secure Boot.

---

### ✨ Signature Features

*   **Inverted Phantom Architecture:** Natively bypass the 4GB FAT32 limit for massive Windows `.wim` payloads using a highly compatible NTFS/FAT32 dual-partition layout.
*   **Direct-to-Metal Linux Flashing:** Automatically detect and deploy Linux ISOs utilizing raw, block-by-block hardware writes (`dd`-style) for flawless reliability.
*   **Active Hardware Protection:** Built-in WMI/BusType polling actively interrogates the target drive. If it isn't a verified removable USB, the engine physically aborts to protect your internal data.
*   **One-Click Drive Restoration:** Instantly wipe, reformat, and reset complex multi-partition bootable USBs back to a clean, single-partition state.
*   **Glassmorphic UI:** A responsive, modern interface built with React and Framer Motion for a premium user experience.

---

### ⚙️ Under the Hood

| Component | Technology | Purpose |
| :--- | :--- | :--- |
| **Frontend** | React, Tailwind, Framer Motion | Drives the beautiful, fluid Glassmorphic interface. |
| **Framework** | Tauri | Delivers a highly optimized, cross-platform desktop environment. |
| **Backend Core** | Python 3.x | Handles raw I/O (`\\.\PHYSICALDRIVE`), `diskpart` tunneling, and WMI polling. |

---

### 🛠️ Developer Setup

To build and test Zozstry locally, ensure **Node.js**, **Rustup**, and **Python 3.x** are installed on your system.

1. **Clone the Repository:**
```bash
   git clone [https://github.com/ah-REE/zozstry.git](https://github.com/ah-REE/zozstry.git)
   cd zozstry
   ```

2. **Install Dependencies:**
```bash
   npm install
   ```

3. **Add the Windows Target (Rust):**
```bash
   rustup target add x86_64-pc-windows-msvc
   ```

4. **Launch the Development Environment:**
```bash
   npm run tauri dev
   ```

> **⚠️ Critical Note on Permissions:** 
> Because Zozstry performs low-level partition manipulation, volume dropping, and direct disk writes, your terminal or IDE **must be launched as an Administrator** to function correctly.

---

### 📜 License & Links

*   **Repository:** [GitHub/ah-REE/zozstry](https://github.com/ah-REE/zozstry)
*   **Issue Tracker:** [Report a Bug or Request a Feature](https://github.com/ah-REE/zozstry/issues)
*   **License:** 100% Free Software under the **MIT License**.

<div align="center">
  <i>Engineered by <b>ah-REE</b>.</i>
</div>