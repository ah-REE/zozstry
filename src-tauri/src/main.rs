#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::fs::File;
use std::env;
use tauri::Emitter;
use tauri_plugin_shell::ShellExt;

#[cfg(target_os = "windows")]
use tauri_plugin_shell::process::CommandEvent;

#[cfg(target_os = "linux")]
fn setup_linux_engine() -> Result<(std::path::PathBuf, Vec<String>), String> {
    // 1. Path Resolution & AppImage FUSE Bypass
    #[cfg(debug_assertions)]
    let sidecar_path = std::env::current_dir().unwrap().join("bin/zozstry-core-x86_64-unknown-linux-gnu");

    #[cfg(not(debug_assertions))]
    let sidecar_path = {
        let original_path = std::env::current_exe()
            .map_err(|e| e.to_string())?
            .parent()
            .ok_or("Failed to resolve binary directory")?
            .join("zozstry-core"); // FIX: Tauri strips the target triple in production builds

        if std::env::var("APPIMAGE").is_ok() {
            let temp_path = std::env::temp_dir().join("zozstry-core-linux");
            std::fs::copy(&original_path, &temp_path).map_err(|e| format!("Extraction failed: {}", e))?;

            use std::os::unix::fs::PermissionsExt;
            let mut perms = std::fs::metadata(&temp_path).map_err(|e| e.to_string())?.permissions();
            perms.set_mode(0o755);
            std::fs::set_permissions(&temp_path, perms).map_err(|e| e.to_string())?;

            temp_path
        } else {
            original_path
        }
    };

    let mut cmd_prefix = Vec::new();

    // 2. Primary Elevation: Graphical Polkit Agents
    let graphical_elevators = ["pkexec", "kdesu", "lxqt-sudo", "gksudo"];
    for elevator in graphical_elevators.iter() {
        if let Ok(output) = std::process::Command::new("which").arg(elevator).output() {
            if output.status.success() {
                cmd_prefix.push(elevator.to_string());
                return Ok((sidecar_path, cmd_prefix));
            }
        }
    }

    // 3. Ultimate Fallback: Native Terminal Emulators using sudo
    let terminal_emulators = [
        ("x-terminal-emulator", "-e"),
        ("gnome-terminal", "--"),
        ("konsole", "-e"),
        ("xfce4-terminal", "-x"),
        ("alacritty", "-e"),
        ("xterm", "-e"),
    ];

    for (term, flag) in terminal_emulators.iter() {
        if let Ok(output) = std::process::Command::new("which").arg(term).output() {
            if output.status.success() {
                cmd_prefix.push(term.to_string());
                cmd_prefix.push(flag.to_string());
                cmd_prefix.push("sudo".to_string());
                return Ok((sidecar_path, cmd_prefix));
            }
        }
    }

    Err("Critical failure: No graphical authorization agents or terminal emulators could be found on this system.".to_string())
}

#[tauri::command]
async fn get_usb_drives(app_handle: tauri::AppHandle) -> Result<String, String> {
    let sidecar_command = app_handle.shell().sidecar("zozstry-core").expect("Failed to initialize sidecar");
    let output = sidecar_command.output().await.map_err(|e| e.to_string())?;
    
    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).to_string())
    } else {
        Err(String::from_utf8_lossy(&output.stderr).to_string())
    }
}

#[tauri::command]
async fn flash_drive(
    app_handle: tauri::AppHandle,
    device_id: String,
    iso_path: String,
    verify: bool,
    force_gpt: bool,
    persistent_storage: u32,
) -> Result<(), String> {
    let mut args = vec!["--flash".to_string(), device_id, iso_path];

    if verify {
        args.push("--verify".to_string());
    }
    if force_gpt {
        args.push("--force-gpt".to_string());
    }
    if persistent_storage > 0 {
        let persistent_mb = persistent_storage * 1024;
        args.push("--persistent".to_string());
        args.push(persistent_mb.to_string());
    }

    #[cfg(target_os = "windows")]
    {
        let mut sidecar_cmd = app_handle.shell().sidecar("zozstry-core").map_err(|e| e.to_string())?;
        sidecar_cmd = sidecar_cmd.args(args);

        let (mut rx, mut _child) = sidecar_cmd.spawn().map_err(|e| e.to_string())?;

        tauri::async_runtime::spawn(async move {
            while let Some(event) = rx.recv().await {
                if let CommandEvent::Stdout(line) = event {
                    let line_str = String::from_utf8_lossy(&line).to_string();
                    let _ = app_handle.emit("flash-progress", line_str);
                }
            }
        });
    }

    #[cfg(target_os = "linux")]
    {
        use std::process::{Command, Stdio};
        use std::io::{BufRead, BufReader};

        let (sidecar_path, cmd_prefix) = setup_linux_engine()?;

        let mut child = Command::new(&cmd_prefix[0])
            .args(&cmd_prefix[1..])
            .arg(sidecar_path)
            .args(args)
            .stdout(Stdio::piped())
            .spawn()
            .map_err(|e| format!("Failed to prompt for admin or start engine: {}", e))?;

        let stdout = child.stdout.take().ok_or("Failed to capture stdout")?;

        std::thread::spawn(move || {
            let reader = BufReader::new(stdout);
            for line in reader.lines().flatten() {
                let _ = app_handle.emit("flash-progress", line);
            }
        });
    }

    Ok(())
}

#[tauri::command]
async fn restore_drive(app_handle: tauri::AppHandle, device_id: String) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        let sidecar_command = app_handle.shell().sidecar("zozstry-core").expect("Failed to initialize sidecar");
        let (mut rx, mut _child) = sidecar_command.args(["--restore", &device_id]).spawn().map_err(|e| e.to_string())?;

        tauri::async_runtime::spawn(async move {
            while let Some(event) = rx.recv().await {
                if let CommandEvent::Stdout(line) = event {
                    let line_str = String::from_utf8_lossy(&line).to_string();
                    let _ = app_handle.emit("flash-progress", line_str);
                }
            }
        });
    }

    #[cfg(target_os = "linux")]
    {
        use std::process::{Command, Stdio};
        use std::io::{BufRead, BufReader};

        let (sidecar_path, cmd_prefix) = setup_linux_engine()?;

        let mut child = Command::new(&cmd_prefix[0])
            .args(&cmd_prefix[1..])
            .arg(sidecar_path)
            .args(["--restore", &device_id])
            .stdout(Stdio::piped())
            .spawn()
            .map_err(|e| format!("Failed to prompt for admin or start engine: {}", e))?;

        let stdout = child.stdout.take().ok_or("Failed to capture stdout")?;

        std::thread::spawn(move || {
            let reader = BufReader::new(stdout);
            for line in reader.lines().flatten() {
                let _ = app_handle.emit("flash-progress", line);
            }
        });
    }

    Ok(())
}

#[tauri::command]
fn cancel_flash() -> Result<(), String> {
    let temp_dir = env::temp_dir();
    let flag_path = temp_dir.join("zozstry_cancel.flag");
    
    match File::create(&flag_path) {
        Ok(_) => Ok(()),
        Err(e) => Err(format!("Failed to execute cancel order: {}", e)),
    }
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            get_usb_drives,
            flash_drive,
            restore_drive,
            cancel_flash
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}