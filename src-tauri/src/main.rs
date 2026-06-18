#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::process::{Command, Stdio};
use std::path::Path;
use std::io::{BufRead, BufReader};
use tauri::Emitter;

#[tauri::command]
fn get_usb_drives() -> Result<String, String> {
    let script_path = if Path::new("backend/engine.py").exists() { "backend/engine.py" } else { "../backend/engine.py" };
    let output = Command::new("python").arg(script_path).output().map_err(|e| e.to_string())?;
    if output.status.success() { Ok(String::from_utf8_lossy(&output.stdout).to_string()) } else { Err(String::from_utf8_lossy(&output.stderr).to_string()) }
}

#[tauri::command]
fn flash_drive(app_handle: tauri::AppHandle, device_id: String, iso_path: String) -> Result<(), String> {
    let script_path = if Path::new("backend/engine.py").exists() { "backend/engine.py" } else { "../backend/engine.py" };

    std::thread::spawn(move || {
        let mut child = Command::new("python").arg(script_path).arg("--flash").arg(&device_id).arg(&iso_path).stdout(Stdio::piped()).spawn().expect("Failed to start engine");
        let reader = BufReader::new(child.stdout.take().unwrap());
        for line in reader.lines() { if let Ok(l) = line { app_handle.emit("flash-progress", l).unwrap(); } }
    });
    Ok(())
}

#[tauri::command]
fn restore_drive(app_handle: tauri::AppHandle, device_id: String) -> Result<(), String> {
    let script_path = if Path::new("backend/engine.py").exists() { "backend/engine.py" } else { "../backend/engine.py" };

    std::thread::spawn(move || {
        let mut child = Command::new("python").arg(script_path).arg("--restore").arg(&device_id).stdout(Stdio::piped()).spawn().expect("Failed to start engine");
        let reader = BufReader::new(child.stdout.take().unwrap());
        for line in reader.lines() { if let Ok(l) = line { app_handle.emit("flash-progress", l).unwrap(); } }
    });
    Ok(())
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![get_usb_drives, flash_drive, restore_drive])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}