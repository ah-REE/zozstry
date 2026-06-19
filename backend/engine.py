import subprocess
import json
import sys
import os
import time
import ctypes
import hashlib
import socket
import shutil
from ctypes import wintypes

# Global IPC Socket
ipc_socket = None

# Kill-Switch Flag
CANCEL_FLAG = os.path.join(os.environ.get('TEMP', ''), 'zozstry_cancel.flag')

def emit(data):
    payload = json.dumps(data)
    if ipc_socket:
        try:
            ipc_socket.sendall((payload + "\n").encode('utf-8'))
        except:
            pass
    else:
        print(payload)
        sys.stdout.flush()

def check_cancel():
    if os.path.exists(CANCEL_FLAG):
        raise Exception("Process aborted by user. Drive may be in an incomplete state.")

def is_admin():
    try:
        return ctypes.windll.shell32.IsUserAnAdmin()
    except:
        return False


def get_usb_drives():
    try:
        ps_script = """
        Get-WmiObject Win32_DiskDrive -Filter "InterfaceType='USB'" | ForEach-Object {
            $disk = $_
            $partitions = Get-WmiObject -Query "ASSOCIATORS OF {Win32_DiskDrive.DeviceID='$($disk.DeviceID)'} WHERE AssocClass = Win32_DiskToPartition"
            $letters = foreach ($part in $partitions) {
                (Get-WmiObject -Query "ASSOCIATORS OF {Win32_Partition.DeviceID='$($part.DeviceID)'} WHERE AssocClass = Win32_LogicalDiskToPartition").DeviceID
            }
            [PSCustomObject]@{
                DeviceID     = $disk.DeviceID
                Model        = $disk.Model
                Size         = $disk.Size
                Letters      = ($letters -join ", ")
            }
        } | ConvertTo-Json
        """
        result = subprocess.run(
            ["powershell", "-Command", ps_script],
            capture_output=True, text=True, check=True
        )
        if not result.stdout.strip():
            return []
        data = json.loads(result.stdout)
        if isinstance(data, dict):
            data = [data]

        drives = []
        for disk in data:
            raw_size = disk.get("Size")
            size_gb = round(int(raw_size) / (1024 ** 3), 2) if raw_size else 0
            active_partitions = f" ({disk.get('Letters')})" if disk.get("Letters") else ""
            drives.append({
                "device_id": disk.get("DeviceID"),
                "label": f"{disk.get('Model')}{active_partitions}",
                "size": f"{size_gb} GB"
            })
        return drives

    except Exception as e:
        return [{"error": str(e)}]


def verify_safety(device_id):
    disk_num = device_id.replace(r"\\.\PHYSICALDRIVE", "")
    cmd = f"(Get-Disk -Number {disk_num}).BusType"
    result = subprocess.run(["powershell", "-Command", cmd], capture_output=True, text=True)
    if "USB" not in result.stdout:
        raise Exception(f"SAFETY ABORT: Target {device_id} is not a USB device (Bus: {result.stdout.strip()}).")


def restore_drive(device_id):
    try:
        verify_safety(device_id)
        emit({"progress": 0, "status": "Dropping volume locks..."})

        disk_num = device_id.replace(r"\\.\PHYSICALDRIVE", "")

        ps_drop = f"Clear-Disk -Number {disk_num} -RemoveData -RemoveOEM -Confirm:$false -ErrorAction SilentlyContinue"
        subprocess.run(["powershell", "-Command", ps_drop], capture_output=True)
        time.sleep(1)

        emit({"progress": 20, "status": "Executing raw hardware wipe..."})

        kernel32 = ctypes.windll.kernel32
        GENERIC_READ             = 0x80000000
        GENERIC_WRITE            = 0x40000000
        FILE_SHARE_READ          = 0x00000001
        FILE_SHARE_WRITE         = 0x00000002
        OPEN_EXISTING            = 3
        IOCTL_DISK_UPDATE_PROPERTIES = 0x00070140

        handle = kernel32.CreateFileW(
            device_id,
            GENERIC_READ | GENERIC_WRITE,
            FILE_SHARE_READ | FILE_SHARE_WRITE,
            None,
            OPEN_EXISTING,
            0,
            None
        )

        INVALID_HANDLE = ctypes.c_void_p(-1).value
        if handle == INVALID_HANDLE or handle == 0:
            raise Exception("Failed to seize raw hardware handle. Ensure app is run as Administrator.")

        try:
            buffer_size      = 1024 * 1024
            empty_buffer     = (ctypes.c_char * buffer_size)()
            bytes_written_dw = wintypes.DWORD()

            kernel32.SetFilePointer(handle, 0, None, 0)
            success = kernel32.WriteFile(
                handle, empty_buffer, buffer_size,
                ctypes.byref(bytes_written_dw), None
            )
            if not success:
                raise Exception("Hardware-level byte write failed.")

            bytes_returned = wintypes.DWORD()
            kernel32.DeviceIoControl(
                handle, IOCTL_DISK_UPDATE_PROPERTIES,
                None, 0, None, 0, ctypes.byref(bytes_returned), None
            )
        finally:
            kernel32.CloseHandle(handle)

        emit({"progress": 40, "status": "Analyzing hardware capacity..."})
        
        ps_size = f"(Get-Disk -Number {disk_num}).Size"
        size_res = subprocess.run(["powershell", "-Command", ps_size], capture_output=True, text=True)
        try:
            disk_bytes = int(size_res.stdout.strip())
            fs_type = "fat32" if disk_bytes <= 34359738368 else "exfat"
        except:
            fs_type = "exfat"

        cluster_size = "64K" if fs_type == "fat32" else "2048K"

        emit({"progress": 55, "status": f"Ghost-formatting as {fs_type.upper()} natively..."})
        
        dp_script = f"""select disk {disk_num}
rescan
clean
convert mbr
create partition primary
format fs={fs_type} unit={cluster_size} quick label="ZOZSTRY"
assign
exit
"""
        build_res = subprocess.run(["diskpart"], input=dp_script, capture_output=True, text=True)
        if build_res.returncode != 0 or ("successfully" not in build_res.stdout.lower() and "succeeded" not in build_res.stdout.lower()):
            raise Exception(f"Diskpart failed to build and format partition: {build_res.stdout.strip()}")
            
        time.sleep(2)

        emit({"progress": 85, "status": "Mounting volume to OS..."})

        ps_get_letter = f"""
        $letter = $null
        for ($i=0; $i -lt 10; $i++) {{
            Update-HostStorageCache
            $part = Get-Partition -DiskNumber {disk_num} -ErrorAction SilentlyContinue | Where-Object {{ $_.DriveLetter -match '[A-Z]' }} | Select-Object -First 1
            if ($part) {{
                $letter = $part.DriveLetter
                break
            }}
            Start-Sleep -Seconds 1
        }}
        Write-Output $letter
        """

        result = subprocess.run(
            ["powershell", "-Command", ps_get_letter],
            capture_output=True, text=True
        )
        if result.returncode != 0:
            raise Exception(result.stderr.strip() or result.stdout.strip())

        raw_letter = result.stdout.strip()
        alpha_chars = [c for c in raw_letter if c.isalpha()]
        if not alpha_chars:
            raise Exception("Failed to locate assigned drive letter from OS.")
        drive_letter = alpha_chars[-1].upper()

        emit({"progress": 100, "status": f"Restore complete! Drive {drive_letter}: is ready."})

    except Exception as e:
        emit({"error": f"Restore failed: {str(e)}"})


def flash_linux_dd(device_id, file_path, verify=False):
    """ The Block-by-Block Direct-To-Metal Writer for Linux ISOs """
    fd_out = None
    fd_in = None
    try:
        emit({"progress": 1, "status": "Dropping volume locks natively..."})
        disk_num = device_id.replace(r"\\.\PHYSICALDRIVE", "")
        dp_script = f"select disk {disk_num}\nclean\nexit\n"
        subprocess.run(["diskpart"], input=dp_script, capture_output=True, text=True)
        time.sleep(1.5)

        total_bytes_to_write = os.path.getsize(file_path)
        bytes_done  = 0
        chunk_size  = 1024 * 1024 * 4  

        emit({"progress": 2, "status": "Initializing direct-to-metal stream..."})

        flags_standard = os.O_RDWR | getattr(os, "O_BINARY", 0)
        FILE_FLAG_NO_BUFFERING = 0x20000000
        FILE_FLAG_WRITE_THROUGH = 0x80000000
        
        raw_flags = flags_standard | FILE_FLAG_NO_BUFFERING | FILE_FLAG_WRITE_THROUGH
        flags_fast = raw_flags if raw_flags < 0x80000000 else raw_flags - 0x100000000

        fast_mode_active = False
        try:
            fd_out = os.open(device_id, flags_fast)
            fast_mode_active = True
        except (OSError, OverflowError):
            fd_out = os.open(device_id, flags_standard)

        fd_in = open(file_path, "rb")
        start_time = time.time()
        last_reported = -1

        while True:
            check_cancel()
            chunk = fd_in.read(chunk_size)
            if not chunk: break

            if fast_mode_active and len(chunk) % 512 != 0:
                os.close(fd_out)
                fd_out = os.open(device_id, flags_standard)
                fast_mode_active = False

            try:
                os.write(fd_out, chunk)
            except OSError as e:
                if fast_mode_active:
                    os.close(fd_out)
                    fd_out = os.open(device_id, flags_standard)
                    fast_mode_active = False
                    os.write(fd_out, chunk)
                else:
                    raise e

            bytes_done += len(chunk)
            elapsed = time.time() - start_time
            speed = (bytes_done / 1048576) / max(0.001, elapsed)
            progress = 2 + int((bytes_done / total_bytes_to_write) * 96)

            if progress != last_reported:
                last_reported = progress
                emit({"progress": min(98, progress), "status": f"Writing... {progress}% @ {speed:.2f} MB/s"})

        fd_in.close()
        os.close(fd_out)
        fd_out = None

        if verify:
            emit({"progress": 99, "status": "Verifying data integrity..."})
            source_hash = hashlib.sha256()
            with open(file_path, "rb") as f:
                while v_chunk := f.read(chunk_size): 
                    check_cancel()
                    source_hash.update(v_chunk)
            
            usb_hash = hashlib.sha256()
            fd_read = os.open(device_id, os.O_RDONLY | getattr(os, "O_BINARY", 0))
            try:
                bytes_read = 0
                while bytes_read < total_bytes_to_write:
                    check_cancel()
                    read_size = min(chunk_size, total_bytes_to_write - bytes_read)
                    v_chunk = os.read(fd_read, read_size)
                    if not v_chunk: break
                    usb_hash.update(v_chunk)
                    bytes_read += len(v_chunk)
            finally:
                os.close(fd_read)

            if source_hash.hexdigest() != usb_hash.hexdigest():
                raise Exception("Verification failed: Data integrity error.")

        emit({"progress": 100, "status": "Deployment Successful. Safe to eject hardware."})

    except Exception as e:
        emit({"error": f"Deployment failed: {str(e)}"})
    finally:
        if fd_out is not None:
            try: os.close(fd_out)
            except OSError: pass
        if fd_in is not None and not fd_in.closed:
            fd_in.close()


def flash_windows_inverted_phantom(device_id, file_path, verify=False, force_gpt=False):
    """ The Inverted Phantom Architecture for Windows ISOs (NTFS USP) """
    iso_mounted = False
    try:
        disk_num = device_id.replace(r"\\.\PHYSICALDRIVE", "")
        partition_style = "gpt" if force_gpt else "mbr"
        
        emit({"progress": 1, "status": "Mounting Windows ISO..."})
        ps_mount = f'Mount-DiskImage -ImagePath "{file_path}" -PassThru | Get-Volume | Select-Object -ExpandProperty DriveLetter'
        res = subprocess.run(["powershell", "-Command", ps_mount], capture_output=True, text=True)
        iso_letter = res.stdout.strip()
        if not iso_letter:
            raise Exception("Failed to mount ISO. File may be corrupted.")
        iso_mounted = True
        iso_drive = f"{iso_letter}:\\"

        emit({"progress": 3, "status": "Calculating Inverted Partitions..."})
        ps_size = f"(Get-Disk -Number {disk_num}).Size"
        size_res = subprocess.run(["powershell", "-Command", ps_size], capture_output=True, text=True)
        try:
            total_bytes = int(size_res.stdout.strip())
            data_size_mb = (total_bytes // (1024 * 1024)) - 1500
            if data_size_mb < 1000:
                raise Exception("USB Drive capacity is too low to support Dual-Partition routing.")
        except Exception as e:
            raise Exception(f"Failed to calculate disk capacity: {str(e)}")

        emit({"progress": 5, "status": "Structuring Inverted Phantom Layout..."})
        
        # Only MBR disks support the active boot flag in diskpart
        active_cmd = "active" if partition_style == "mbr" else ""
        
        # INVERSION: Partition 1 is NTFS Payload. Partition 2 is FAT32 EFI Boot.
        dp_script = f"""select disk {disk_num}
clean
convert {partition_style}
create partition primary size={data_size_mb}
format fs=ntfs quick label="ZOZ_DATA"
assign
create partition primary
format fs=fat32 quick label="ZOZ_BOOT"
{active_cmd}
assign
exit
"""
        build_res = subprocess.run(["diskpart"], input=dp_script, capture_output=True, text=True)
        if build_res.returncode != 0:
            raise Exception("Diskpart failed to construct inverted partitions.")
        
        time.sleep(3)

        emit({"progress": 8, "status": "Mapping kernel volumes..."})
        fat32_guid = None
        fat32_letter = None
        ntfs_guid = None
        ntfs_letter = None
        
        ps_get_volumes = f"""
        Update-HostStorageCache
        $parts = Get-Partition -DiskNumber {disk_num} -ErrorAction SilentlyContinue
        foreach ($p in $parts) {{
            $vol = Get-Volume -Partition $p -ErrorAction SilentlyContinue
            if ($vol) {{
                $letter = if ($vol.DriveLetter) {{ $vol.DriveLetter }} else {{ "NONE" }}
                Write-Output "$($vol.FileSystemLabel)|$($vol.Path)|$letter"
            }}
        }}
        """
        
        for _ in range(15):
            res = subprocess.run(["powershell", "-Command", ps_get_volumes], capture_output=True, text=True)
            for line in res.stdout.strip().split('\n'):
                parts = line.split('|')
                if len(parts) == 3:
                    lbl, path, letter = parts[0].strip(), parts[1].strip(), parts[2].strip()
                    if lbl == 'ZOZ_BOOT':
                        fat32_guid = path
                        fat32_letter = letter if letter != "NONE" else None
                    elif lbl == 'ZOZ_DATA':
                        ntfs_guid = path
                        ntfs_letter = letter if letter != "NONE" else None
            
            if fat32_guid and ntfs_guid: 
                break
            time.sleep(1)
            
        if not fat32_guid or not ntfs_guid:
            raise Exception("Kernel failed to expose the hidden Volume GUIDs.")

        emit({"progress": 10, "status": "Calculating Phantom routes..."})
        files_to_copy = []
        total_copy_bytes = 0
        payload_src_path = None
        payload_dest_path = None
        
        for root, dirs, files in os.walk(iso_drive):
            for f in files:
                src_path = os.path.join(root, f)
                rel_path = os.path.relpath(src_path, iso_drive)
                rel_lower = rel_path.lower()
                size = os.path.getsize(src_path)
                
                # Rule 1: EVERYTHING clones to Partition 1 (NTFS) so WinPE finds it.
                dest_data = os.path.join(ntfs_guid, rel_path)
                files_to_copy.append((src_path, dest_data, size))
                total_copy_bytes += size
                
                if rel_lower in [r"sources\install.wim", r"sources\install.esd", r"sources\install.swm"]:
                    payload_src_path = src_path
                    payload_dest_path = dest_data

                # Rule 2: ONLY Boot-critical files go to Partition 2 (FAT32) for UEFI firmware.
                is_boot_critical = (
                    rel_lower.startswith("efi\\") or 
                    rel_lower.startswith("boot\\") or 
                    rel_lower == "bootmgr" or 
                    rel_lower == "bootmgr.efi" or 
                    rel_lower == "sources\\boot.wim"
                )
                
                if is_boot_critical:
                    dest_boot = os.path.join(fat32_guid, rel_path)
                    files_to_copy.append((src_path, dest_boot, size))
                    total_copy_bytes += size

        copied_bytes = 0
        start_time = time.time()
        last_reported = -1
        
        for src, dest, size in files_to_copy:
            target_dir = os.path.dirname(dest)
            if target_dir and not os.path.exists(target_dir):
                try:
                    os.makedirs(target_dir, exist_ok=True)
                except OSError:
                    pass 
            
            with open(src, 'rb') as fsrc, open(dest, 'wb') as fdst:
                while True:
                    check_cancel()
                    chunk = fsrc.read(1024 * 1024 * 4) 
                    if not chunk: break
                    fdst.write(chunk)
                    copied_bytes += len(chunk)
                    
                    elapsed = time.time() - start_time
                    speed = (copied_bytes / 1048576) / max(0.001, elapsed)
                    progress = 10 + int((copied_bytes / total_copy_bytes) * 88) 
                    
                    if progress != last_reported:
                        last_reported = progress
                        emit({"progress": min(98, progress), "status": f"Tunneling payload... {progress}% @ {speed:.2f} MB/s"})

        emit({"progress": 98, "status": "Injecting MBR boot attributes..."})
        bootsect_iso_path = os.path.join(iso_drive, "boot", "bootsect.exe")
        target_letter = fat32_letter or ntfs_letter
        
        if target_letter and os.path.exists(bootsect_iso_path):
            subprocess.run([bootsect_iso_path, "/nt60", f"{target_letter}:", "/mbr", "/force"], capture_output=True)

        if verify and payload_src_path and payload_dest_path:
            emit({"progress": 99, "status": "Executing cryptographic verification..."})
            src_hash = hashlib.sha256()
            with open(payload_src_path, "rb") as f:
                while chunk := f.read(1024 * 1024 * 4): 
                    check_cancel()
                    src_hash.update(chunk)
                
            dest_hash = hashlib.sha256()
            with open(payload_dest_path, "rb") as f:
                while chunk := f.read(1024 * 1024 * 4): 
                    check_cancel()
                    dest_hash.update(chunk)
                
            if src_hash.hexdigest() != dest_hash.hexdigest():
                raise Exception("Verification Failed: Corrupted payload detected on USB.")

        emit({"progress": 100, "status": "Deployment Successful. Safe to eject hardware."})

    except Exception as e:
        emit({"error": f"Deployment failed: {str(e)}"})
    finally:
        if iso_mounted:
            ps_unmount = f'Dismount-DiskImage -ImagePath "{file_path}"'
            subprocess.run(["powershell", "-Command", ps_unmount], capture_output=True)


def flash_drive(device_id, file_path, verify=False, force_gpt=False, persistent_mb=0):
    """ The Auto-Sense Engine Router """
    if os.path.exists(CANCEL_FLAG):
        try: os.remove(CANCEL_FLAG)
        except: pass

    try:
        verify_safety(device_id)
        
        emit({"progress": 0, "status": "Interrogating ISO payload..."})
        
        ps_mount = f'Mount-DiskImage -ImagePath "{file_path}" -PassThru | Get-Volume | Select-Object -ExpandProperty DriveLetter'
        res = subprocess.run(["powershell", "-Command", ps_mount], capture_output=True, text=True)
        iso_letter = res.stdout.strip()
        
        os_type = "LINUX"
        if iso_letter:
            iso_drive = f"{iso_letter}:\\"
            has_bootmgr = os.path.exists(os.path.join(iso_drive, "bootmgr"))
            has_bootwim = os.path.exists(os.path.join(iso_drive, "sources", "boot.wim"))
            
            if has_bootmgr or has_bootwim:
                os_type = "WINDOWS"
                
            ps_unmount = f'Dismount-DiskImage -ImagePath "{file_path}"'
            subprocess.run(["powershell", "-Command", ps_unmount], capture_output=True)

        if os_type == "WINDOWS":
            emit({"progress": 0, "status": "Windows OS detected. Initializing Inverted Phantom Router..."})
            flash_windows_inverted_phantom(device_id, file_path, verify, force_gpt)
        else:
            emit({"progress": 0, "status": "Linux OS detected. Initializing Direct Block Writer..."})
            # Persistent storage logic will eventually go here
            flash_linux_dd(device_id, file_path, verify)

    except PermissionError:
        emit({"error": "PERMISSION DENIED: Run as Administrator!"})
    except Exception as e:
        emit({"error": f"Flashing failed: {str(e)}"})


if __name__ == "__main__":
    if len(sys.argv) > 1:
        if "--ipc" in sys.argv:
            idx = sys.argv.index("--ipc")
            port = int(sys.argv[idx + 1])
            sys.argv.pop(idx)
            sys.argv.pop(idx)
            
            ipc_socket = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            ipc_socket.connect(("127.0.0.1", port))

        command = sys.argv[1]

        if command in ["--flash", "--restore"]:
            if not is_admin():
                server = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
                server.bind(("127.0.0.1", 0))
                server.listen(1)
                bridge_port = server.getsockname()[1]

                script = os.path.abspath(sys.argv[0])
                params = ' '.join([f'"{arg}"' for arg in sys.argv[1:]])
                params += f' --ipc {bridge_port}'
                
                ret = ctypes.windll.shell32.ShellExecuteW(None, "runas", sys.executable, f'"{script}" {params}', None, 0)
                
                if int(ret) <= 32:
                    print(json.dumps({"error": "Admin privileges required. UAC prompt was rejected."}))
                    sys.exit(1)
                
                server.settimeout(15.0)
                try:
                    conn, _ = server.accept()
                    with conn, conn.makefile('r', encoding='utf-8') as f:
                        for line in f:
                            print(line.strip())
                            sys.stdout.flush()
                except socket.timeout:
                    print(json.dumps({"error": "Failed to establish secure IPC bridge with elevated process."}))
                
                sys.exit(0)

            if command == "--flash":
                verify_flag = "--verify" in sys.argv
                force_gpt_flag = "--force-gpt" in sys.argv
                
                persistent_mb = 0
                if "--persistent" in sys.argv:
                    try:
                        p_idx = sys.argv.index("--persistent")
                        persistent_mb = int(sys.argv[p_idx + 1])
                    except:
                        pass
                
                flash_drive(sys.argv[2], sys.argv[3], verify=verify_flag, force_gpt=force_gpt_flag, persistent_mb=persistent_mb)
            elif command == "--restore":
                restore_drive(sys.argv[2])
                
    else:
        print(json.dumps(get_usb_drives(), indent=4))