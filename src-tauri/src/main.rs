#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::fs::File;
use std::env;
use tauri::Emitter;
use tauri_plugin_shell::ShellExt;
use tauri_plugin_shell::process::CommandEvent;

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
    let mut sidecar_cmd = app_handle.shell().sidecar("zozstry-core").map_err(|e| e.to_string())?;
    sidecar_cmd = sidecar_cmd.args(["--flash", &device_id, &iso_path]);

    if verify {
        sidecar_cmd = sidecar_cmd.arg("--verify");
    }
    if force_gpt {
        sidecar_cmd = sidecar_cmd.arg("--force-gpt");
    }
    if persistent_storage > 0 {
        let persistent_mb = persistent_storage * 1024;
        sidecar_cmd = sidecar_cmd.args(["--persistent", &persistent_mb.to_string()]);
    }

    let (mut rx, mut _child) = sidecar_cmd.spawn().map_err(|e| e.to_string())?;

    tauri::async_runtime::spawn(async move {
        while let Some(event) = rx.recv().await {
            if let CommandEvent::Stdout(line) = event {
                let line_str = String::from_utf8_lossy(&line).to_string();
                app_handle.emit("flash-progress", line_str).unwrap();
            }
        }
    });

    Ok(())
}

#[tauri::command]
async fn restore_drive(app_handle: tauri::AppHandle, device_id: String) -> Result<(), String> {
    let sidecar_command = app_handle.shell().sidecar("zozstry-core").expect("Failed to initialize sidecar");
    let (mut rx, mut _child) = sidecar_command.args(["--restore", &device_id]).spawn().map_err(|e| e.to_string())?;

    tauri::async_runtime::spawn(async move {
        while let Some(event) = rx.recv().await {
            if let CommandEvent::Stdout(line) = event {
                let line_str = String::from_utf8_lossy(&line).to_string();
                app_handle.emit("flash-progress", line_str).unwrap();
            }
        }
    });

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